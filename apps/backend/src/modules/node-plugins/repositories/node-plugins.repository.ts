import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { sql } from 'kysely';

import { Injectable } from '@nestjs/common';

import { TxKyselyService } from '@common/database';
import { findDistinctJsonTags, jsonTreeContains } from '@common/helpers/kysely';
import { values } from '@common/helpers/kysely/values';
import { ICrud } from '@common/types/crud-port';

import { NodePluginEntity } from '../entities/node-plugin.entity';
import { NodePluginConverter } from '../node-plugins.converter';

@Injectable()
export class NodePluginRepository implements ICrud<NodePluginEntity> {
    constructor(
        private readonly prisma: TransactionHost<TransactionalAdapterPrisma>,
        private readonly qb: TxKyselyService,
        private readonly converter: NodePluginConverter,
    ) {}

    public async create(entity: NodePluginEntity): Promise<NodePluginEntity> {
        const model = this.converter.fromEntityToPrismaModel(entity);
        const result = await this.prisma.tx.nodePlugin.create({
            data: {
                ...model,
            },
        });

        return this.converter.fromPrismaModelToEntity(result);
    }

    public async findByUUID(uuid: string): Promise<null | NodePluginEntity> {
        const result = await this.prisma.tx.nodePlugin.findUnique({
            where: { uuid },
        });
        if (!result) {
            return null;
        }
        return this.converter.fromPrismaModelToEntity(result);
    }

    public async update({ uuid, ...data }: Partial<NodePluginEntity>): Promise<NodePluginEntity> {
        const model = this.converter.fromEntityToPrismaModel({
            uuid,
            ...data,
        } as NodePluginEntity);
        const result = await this.prisma.tx.nodePlugin.update({
            where: { uuid },
            data: {
                ...model,
            },
        });

        return this.converter.fromPrismaModelToEntity(result);
    }

    public async findByCriteria(
        dto: Partial<Omit<NodePluginEntity, 'pluginConfig'>>,
    ): Promise<NodePluginEntity[]> {
        const model = this.converter.fromEntityToPrismaModel(dto as NodePluginEntity);
        /* eslint-disable @typescript-eslint/no-unused-vars */
        const { pluginConfig, tags, ...rest } = model;
        const list = await this.prisma.tx.nodePlugin.findMany({
            where: {
                ...rest,
            },
        });
        return this.converter.fromPrismaModelsToEntities(list);
    }

    public async findFirst(): Promise<null | NodePluginEntity> {
        const result = await this.prisma.tx.nodePlugin.findFirst();
        if (!result) {
            return null;
        }
        return this.converter.fromPrismaModelToEntity(result);
    }

    public async findFirstByName(name: string): Promise<null | NodePluginEntity> {
        const result = await this.prisma.tx.nodePlugin.findFirst({
            where: {
                name,
            },
        });
        if (!result) {
            return null;
        }
        return this.converter.fromPrismaModelToEntity(result);
    }

    public async deleteByUUID(uuid: string): Promise<boolean> {
        const result = await this.prisma.tx.nodePlugin.delete({ where: { uuid } });
        return !!result;
    }

    public async getAllNodePlugins(withContent: boolean = true): Promise<NodePluginEntity[]> {
        const result = await this.prisma.tx.nodePlugin.findMany({
            select: {
                viewPosition: true,
                name: true,
                uuid: true,
                tags: true,
                ...(withContent
                    ? {
                          pluginConfig: true,
                      }
                    : {
                          pluginConfig: false,
                      }),
            },
            orderBy: {
                viewPosition: 'asc',
            },
        });
        return result.map((item) => new NodePluginEntity(item));
    }

    public async getUuidsBySharedListName(name: string): Promise<string[]> {
        const result = await this.qb.kysely
            .selectFrom('nodePlugin')
            .select('uuid')
            .where(jsonTreeContains(sql.ref('node_plugin.plugin_config'), `ext:${name}`))
            .execute();

        return result.map((row) => row.uuid);
    }

    public async reorderMany(
        dto: {
            uuid: string;
            viewPosition: number;
        }[],
    ): Promise<boolean> {
        if (dto.length === 0) return true;

        const v = values(
            dto.map(({ uuid, viewPosition }) => ({
                uuid,
                viewPosition,
            })),
            'v',
        );

        await this.qb.kysely
            .updateTable('nodePlugin')
            .from(v)
            .set((eb) => ({ viewPosition: eb.ref('v.viewPosition') }))
            .whereRef('nodePlugin.uuid', '=', 'v.uuid')
            .execute();

        return true;
    }

    public async findAllTags(): Promise<string[]> {
        return findDistinctJsonTags(this.prisma.tx, 'node_plugin');
    }

    public async setTags(uuid: string, tags: string[]): Promise<string[]> {
        const result = await this.prisma.tx.nodePlugin.update({
            where: { uuid },
            data: { tags },
            select: { tags: true },
        });

        return result.tags;
    }
}
