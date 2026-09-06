import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_SQLITE_URL = 'file:./data/nodify.db';

export function resolveDatabaseUrl(): string {
    return absolutizeSqliteUrl(process.env.DATABASE_URL || DEFAULT_SQLITE_URL);
}

export function absolutizeSqliteUrl(databaseUrl: string): string {
    if (!databaseUrl.startsWith('file:')) {
        return databaseUrl;
    }

    let filePath = databaseUrl.slice('file:'.length);
    if (filePath.startsWith('///')) {
        filePath = filePath.slice(2);
    }

    if (!path.isAbsolute(filePath)) {
        filePath = path.resolve(process.cwd(), filePath);
    }

    return `file:${filePath.replace(/\\/g, '/')}`;
}

export function sqliteFilePath(databaseUrl = resolveDatabaseUrl()): string | null {
    if (!databaseUrl.startsWith('file:')) {
        return null;
    }

    return databaseUrl.slice('file:'.length);
}

export function ensureSqliteFile(databaseUrl = resolveDatabaseUrl()): void {
    const filePath = sqliteFilePath(absolutizeSqliteUrl(databaseUrl));
    if (!filePath) {
        return;
    }

    mkdirSync(path.dirname(filePath), { recursive: true });
}
