import { PrismaClient } from '@prisma/client';

import { Injectable, OnModuleInit } from '@nestjs/common';

import { applySqlitePragmas, ensureSqliteFile, resolveDatabaseUrl } from './sqlite';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
    constructor() {
        process.env.DATABASE_URL = resolveDatabaseUrl();
        ensureSqliteFile();
        super();
    }

    async onModuleInit() {
        await this.$connect();
        await applySqlitePragmas(this);
    }

    /**
     * @see https://github.com/eoin-obrien/prisma-extension-kysely
     * @see https://github.com/eoin-obrien/prisma-extension-kysely/issues/71
     */
    // static withKysely(config: ConfigService) {
    //     return new PrismaService(config).$extends(
    //         kyselyExtension({
    //             kysely: () => {
    //                 return new Kysely<DB>({
    //                     log: ['query'],
    //                     dialect: {
    //                         createDriver: () => new DummyDriver(),
    //                         createAdapter: () => new PostgresAdapter(),
    //                         createIntrospector: (db) => new PostgresIntrospector(db),
    //                         createQueryCompiler: () => new PostgresQueryCompiler(),
    //                     },
    //                     plugins: [new CamelCasePlugin()],
    //                 });
    //             },
    //         }),
    //     ) as unknown as PrismaService;
    // }

    /** Don't forget it */
    // declare $kysely: Kysely<DB>;
}
