import { PrismaClient } from '@prisma/client';

import { ensureSqliteFile, resolveDatabaseUrl } from './sqlite-path';

export { DEFAULT_SQLITE_URL, ensureSqliteFile, resolveDatabaseUrl } from './sqlite-path';

export async function applySqlitePragmas(prisma: PrismaClient): Promise<void> {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000');
    await prisma.$queryRawUnsafe('PRAGMA foreign_keys=ON');
    await prisma.$queryRawUnsafe('PRAGMA synchronous=NORMAL');
}
