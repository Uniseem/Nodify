import { DynamicModule, Global, Module } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import {
    Kysely,
    KyselyPlugin,
    SqliteAdapter,
    SqliteIntrospector,
    SqliteQueryCompiler,
} from 'kysely';

import { KYSELY } from './constants';
import { PrismaTxDriver } from './prisma-tx.driver';

export interface SqliteKyselyModuleOptions {
    transactionHostToken?: unknown;
    plugins?: KyselyPlugin[];
    log?: 'query' | 'error';
}

@Global()
@Module({})
export class SqliteKyselyModule {
    static forRoot(options: SqliteKyselyModuleOptions): DynamicModule {
        const {
            transactionHostToken = TransactionHost,
            plugins,
            log,
        } = options;

        return {
            module: SqliteKyselyModule,
            providers: [
                {
                    provide: KYSELY,
                    useFactory: (prisma: TransactionHost<TransactionalAdapterPrisma>) => {
                        return new Kysely({
                            log: log ? [log] : undefined,
                            dialect: {
                                createDriver: () => new PrismaTxDriver(prisma),
                                createAdapter: () => new SqliteAdapter(),
                                createIntrospector: (db) => new SqliteIntrospector(db),
                                createQueryCompiler: () => new SqliteQueryCompiler(),
                            },
                            plugins,
                        });
                    },
                    inject: [transactionHostToken as never],
                },
            ],
            exports: [KYSELY],
        };
    }
}
