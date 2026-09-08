import { randomBytes } from 'node:crypto';

import { AgentEnrollment } from '@prisma/client';

import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';

import { TypedConfigService } from '@common/config/app-config';
import { PrismaService } from '@common/database/prisma.service';
import { fail, ok, TResult } from '@common/types';
import { ERRORS } from '@libs/contracts/constants/errors';

import { KeygenService } from '@modules/keygen/keygen.service';

import {
    AGENT_ENROLLMENT_STATUS,
    AGENT_ENROLLMENT_TTL_MS,
    TAgentEnrollmentStatus,
} from './agent-enrollments.constants';
import { buildAgentInstallCommand, renderAgentInstallScript } from './install-script';
import { AgentEnrollmentResponseModel } from './models/agent-enrollment.response.model';

const PLACEHOLDER_PANEL_DOMAINS = new Set(['panel.domain.com', 'localhost', '127.0.0.1']);

export interface ICreateAgentEnrollmentInput {
    countryCode?: string;
    name: string;
    nodePort?: number;
}

export interface IPublicAgentEnrollmentPayload {
    expiresAt: Date;
    name: string;
    nodePort: number;
    secretKey: string;
    status: TAgentEnrollmentStatus;
    token: string;
}

@Injectable()
export class AgentEnrollmentsService {
    private readonly logger = new Logger(AgentEnrollmentsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly keygenService: KeygenService,
        private readonly configService: TypedConfigService,
    ) {}

    public async createEnrollment(
        body: ICreateAgentEnrollmentInput,
        req: Request,
    ): Promise<TResult<AgentEnrollmentResponseModel>> {
        try {
            const name = body.name.trim();
            if (!name) {
                return fail(ERRORS.CREATE_AGENT_ENROLLMENT_ERROR);
            }

            const secretKeyResult = await this.keygenService.generateKey();
            if (!secretKeyResult.isOk) {
                return fail(ERRORS.GET_PUBLIC_KEY_ERROR);
            }

            const token = randomBytes(24).toString('base64url');
            const now = new Date();

            const entity = await this.prisma.agentEnrollment.create({
                data: {
                    token,
                    name,
                    countryCode: (body.countryCode || 'XX').toUpperCase(),
                    nodePort: body.nodePort && body.nodePort > 0 ? body.nodePort : 2222,
                    status: AGENT_ENROLLMENT_STATUS.PENDING,
                    secretKey: secretKeyResult.response.payload,
                    expiresAt: new Date(now.getTime() + AGENT_ENROLLMENT_TTL_MS),
                },
            });

            return ok(this.toAdminModel(entity, req));
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.CREATE_AGENT_ENROLLMENT_ERROR);
        }
    }

    public async listEnrollments(
        req: Request,
    ): Promise<TResult<AgentEnrollmentResponseModel[]>> {
        try {
            const rows = await this.prisma.agentEnrollment.findMany({
                orderBy: { createdAt: 'desc' },
                take: 100,
            });

            return ok(rows.map((row) => this.toAdminModel(this.withFreshStatus(row), req)));
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.CREATE_AGENT_ENROLLMENT_ERROR);
        }
    }

    public async getEnrollment(
        uuid: string,
        req: Request,
    ): Promise<TResult<AgentEnrollmentResponseModel>> {
        const entity = await this.prisma.agentEnrollment.findUnique({ where: { uuid } });
        if (!entity) {
            return fail(ERRORS.AGENT_ENROLLMENT_NOT_FOUND);
        }

        return ok(this.toAdminModel(this.withFreshStatus(entity), req));
    }

    public async revokeEnrollment(uuid: string): Promise<TResult<{ uuid: string }>> {
        const entity = await this.prisma.agentEnrollment.findUnique({ where: { uuid } });
        if (!entity) {
            return fail(ERRORS.AGENT_ENROLLMENT_NOT_FOUND);
        }

        if (entity.status === AGENT_ENROLLMENT_STATUS.INSTALLED) {
            return fail(ERRORS.AGENT_ENROLLMENT_ALREADY_USED);
        }

        await this.prisma.agentEnrollment.update({
            where: { uuid },
            data: { status: AGENT_ENROLLMENT_STATUS.REVOKED },
        });

        return ok({ uuid });
    }

    public async getPublicPayload(token: string): Promise<TResult<IPublicAgentEnrollmentPayload>> {
        const resolved = await this.resolveUsableEnrollment(token);
        if (!resolved.isOk) {
            return resolved;
        }

        return ok({
            token: resolved.response.token,
            name: resolved.response.name,
            nodePort: resolved.response.nodePort,
            secretKey: resolved.response.secretKey,
            status: resolved.response.status as TAgentEnrollmentStatus,
            expiresAt: resolved.response.expiresAt,
        });
    }

    public async getInstallScript(token: string, req: Request): Promise<TResult<string>> {
        const resolved = await this.resolveUsableEnrollment(token);
        if (!resolved.isOk) {
            return resolved;
        }

        return ok(
            renderAgentInstallScript({
                secretKey: resolved.response.secretKey,
                nodePort: resolved.response.nodePort,
                completeUrl: this.buildPublicUrl(req, token, 'complete'),
            }),
        );
    }

    public async completeEnrollment(
        token: string,
        address: string,
    ): Promise<TResult<{ address: string; status: TAgentEnrollmentStatus }>> {
        try {
            const normalizedAddress = this.normalizeAddress(address);
            if (!normalizedAddress) {
                return fail(ERRORS.AGENT_ENROLLMENT_INVALID_ADDRESS);
            }

            const resolved = await this.resolveUsableEnrollment(token);
            if (!resolved.isOk) {
                return resolved;
            }

            const entity = resolved.response;
            if (entity.status === AGENT_ENROLLMENT_STATUS.INSTALLED) {
                return ok({
                    status: AGENT_ENROLLMENT_STATUS.INSTALLED,
                    address: entity.reportedAddress ?? normalizedAddress,
                });
            }

            await this.prisma.agentEnrollment.update({
                where: { uuid: entity.uuid },
                data: {
                    status: AGENT_ENROLLMENT_STATUS.INSTALLED,
                    reportedAddress: normalizedAddress,
                    usedAt: new Date(),
                },
            });

            return ok({
                status: AGENT_ENROLLMENT_STATUS.INSTALLED,
                address: normalizedAddress,
            });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.COMPLETE_AGENT_ENROLLMENT_ERROR);
        }
    }

    public resolvePanelBaseUrl(req: Request): string {
        const panelDomain = this.configService.get('PANEL_DOMAIN');
        if (panelDomain) {
            const trimmed = panelDomain.replace(/\/+$/, '');
            const host = trimmed.replace(/^https?:\/\//, '').split('/')[0];
            if (host && !PLACEHOLDER_PANEL_DOMAINS.has(host)) {
                return trimmed.includes('://') ? trimmed : `https://${trimmed}`;
            }
        }

        const protoHeader = req.headers['x-forwarded-proto'];
        const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader)
            ?.split(',')[0]
            ?.trim();
        const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader)?.split(',')[0]?.trim();

        return `${proto || req.protocol || 'http'}://${host || '127.0.0.1'}`;
    }

    private async resolveUsableEnrollment(token: string): Promise<TResult<AgentEnrollment>> {
        const entity = await this.prisma.agentEnrollment.findUnique({ where: { token } });
        if (!entity) {
            return fail(ERRORS.AGENT_ENROLLMENT_NOT_FOUND);
        }

        const current = this.withFreshStatus(entity);
        if (current.status === AGENT_ENROLLMENT_STATUS.REVOKED) {
            return fail(ERRORS.AGENT_ENROLLMENT_REVOKED);
        }
        if (current.status === AGENT_ENROLLMENT_STATUS.EXPIRED) {
            return fail(ERRORS.AGENT_ENROLLMENT_EXPIRED);
        }

        return ok(current);
    }

    private withFreshStatus(entity: AgentEnrollment): AgentEnrollment {
        if (
            entity.status === AGENT_ENROLLMENT_STATUS.PENDING &&
            entity.expiresAt.getTime() <= Date.now()
        ) {
            return { ...entity, status: AGENT_ENROLLMENT_STATUS.EXPIRED };
        }

        return entity;
    }

    private toAdminModel(entity: AgentEnrollment, req: Request): AgentEnrollmentResponseModel {
        const installUrl = this.buildPublicUrl(req, entity.token, 'install');
        return new AgentEnrollmentResponseModel(entity, {
            installUrl,
            installCommand: buildAgentInstallCommand(installUrl),
        });
    }

    private buildPublicUrl(
        req: Request,
        token: string,
        action: 'install' | 'complete',
    ): string {
        return `${this.resolvePanelBaseUrl(req)}/api/public/agent-enrollments/${token}/${action}`;
    }

    private normalizeAddress(address: string): string | null {
        const value = address.trim();
        if (!value || value.length > 255) {
            return null;
        }

        if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
            return null;
        }

        return value;
    }
}
