import 'dotenv/config';
import type { PrismaConfig } from 'prisma';

import path from 'node:path';

import {
    DEFAULT_SQLITE_URL,
    absolutizeSqliteUrl,
    ensureSqliteFile,
} from './src/common/database/sqlite-path';

process.env.DATABASE_URL = absolutizeSqliteUrl(process.env.DATABASE_URL || DEFAULT_SQLITE_URL);
ensureSqliteFile();

export default {
    schema: path.join('prisma', 'schema.prisma'),
    migrations: {
        path: path.join('prisma', 'migrations'),
        seed: 'node dist/seed.js',
    },
} satisfies PrismaConfig;
