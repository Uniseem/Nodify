import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { DatabaseConnection, Driver, TransactionSettings } from 'kysely';

import { PrismaTxConnection } from './prisma-tx.connection';

export class PrismaTxDriver implements Driver {
    constructor(private readonly prisma: TransactionHost<TransactionalAdapterPrisma>) {}

    async init(): Promise<void> {}

    async acquireConnection(): Promise<DatabaseConnection> {
        return new PrismaTxConnection(this.prisma);
    }

    async beginTransaction(
        _connection: DatabaseConnection,
        _settings: TransactionSettings,
    ): Promise<void> {
        throw new Error('prisma-tx-driver does not support transactions');
    }

    async commitTransaction(_connection: DatabaseConnection): Promise<void> {
        throw new Error('prisma-tx-driver does not support transactions');
    }

    async rollbackTransaction(_connection: DatabaseConnection): Promise<void> {
        throw new Error('prisma-tx-driver does not support transactions');
    }

    async releaseConnection(_connection: DatabaseConnection): Promise<void> {}

    async destroy(): Promise<void> {}
}
