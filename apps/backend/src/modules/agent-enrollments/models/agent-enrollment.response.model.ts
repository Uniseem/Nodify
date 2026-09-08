import { AgentEnrollment } from '@prisma/client';

import { TAgentEnrollmentStatus } from '../agent-enrollments.constants';

export class AgentEnrollmentResponseModel {
    uuid: string;
    name: string;
    countryCode: string;
    nodePort: number;
    status: TAgentEnrollmentStatus;
    nodeUuid: string | null;
    reportedAddress: string | null;
    installUrl: string;
    installCommand: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;

    constructor(
        entity: AgentEnrollment,
        links: {
            installCommand: string;
            installUrl: string;
        },
    ) {
        this.uuid = entity.uuid;
        this.name = entity.name;
        this.countryCode = entity.countryCode;
        this.nodePort = entity.nodePort;
        this.status = entity.status as TAgentEnrollmentStatus;
        this.nodeUuid = entity.nodeUuid;
        this.reportedAddress = entity.reportedAddress;
        this.installUrl = links.installUrl;
        this.installCommand = links.installCommand;
        this.expiresAt = entity.expiresAt;
        this.usedAt = entity.usedAt;
        this.createdAt = entity.createdAt;
        this.updatedAt = entity.updatedAt;
    }
}
