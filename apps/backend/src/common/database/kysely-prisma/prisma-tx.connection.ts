import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import {
    CompiledQuery,
    DatabaseConnection,
    DeleteQueryNode,
    InsertQueryNode,
    QueryResult,
    UpdateQueryNode,
} from 'kysely';

export class PrismaTxConnection implements DatabaseConnection {
    constructor(private readonly prisma: TransactionHost<TransactionalAdapterPrisma>) {}

    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        const { sql, parameters, query } = compiledQuery;

        const supportsReturning =
            DeleteQueryNode.is(query) || UpdateQueryNode.is(query) || InsertQueryNode.is(query);
        const shouldReturnAffectedRows = supportsReturning && !query.returning;

        if (shouldReturnAffectedRows) {
            const numAffectedRows = BigInt(
                await this.prisma.tx.$executeRawUnsafe(sql, ...parameters),
            );
            return {
                rows: [],
                numAffectedRows,
            };
        }

        const rows = await this.prisma.tx.$queryRawUnsafe<R[]>(sql, ...parameters);
        return { rows };
    }

    streamQuery<R>(
        _compiledQuery: CompiledQuery,
        _chunkSize?: number,
    ): AsyncIterableIterator<QueryResult<R>> {
        throw new Error('prisma-tx-driver does not support streaming queries');
    }
}
