import { Prisma } from '@prisma/client';
import { Expression, RawBuilder, sql } from 'kysely';

export function ilike(
    column: Expression<unknown> | string,
    pattern: string,
): RawBuilder<boolean> {
    const col = typeof column === 'string' ? sql.ref(column) : column;
    return sql<boolean>`lower(${col}) like ${pattern.toLowerCase()}`;
}

export function jsonTreeContains(
    column: Expression<unknown> | string,
    value: string,
): RawBuilder<boolean> {
    const col = typeof column === 'string' ? sql.ref(column) : column;
    return sql<boolean>`exists (select 1 from json_tree(${col}) where json_tree.value = ${value})`;
}

export function jsonArrayContains(
    column: Expression<unknown> | string,
    value: string,
): RawBuilder<boolean> {
    const col = typeof column === 'string' ? sql.ref(column) : column;
    return sql<boolean>`exists (select 1 from json_each(${col}) where value = ${value})`;
}

export function jsonArrayRemove(
    column: Expression<unknown> | string,
    value: string,
): RawBuilder<string> {
    const col = typeof column === 'string' ? sql.ref(column) : column;
    return sql<string>`(select coalesce(json_group_array(value), json('[]')) from json_each(${col}) where value != ${value})`;
}

export function parseSqlJsonArray<T>(value: T[] | string | null | undefined): T[] {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value) as T[];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
}

export function sqliteDateSeries(dates: string[]): Prisma.Sql {
    if (dates.length === 0) {
        return Prisma.sql`(SELECT NULL AS date, 0 AS ord WHERE 0)`;
    }

    return Prisma.sql`(${Prisma.join(
        dates.map((date, index) => Prisma.sql`SELECT ${date} AS date, ${index + 1} AS ord`),
        ' UNION ALL ',
    )})`;
}

export async function findDistinctJsonTags(
    prisma: { $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown> },
    table: string,
): Promise<string[]> {
    const result = (await prisma.$queryRawUnsafe(
        `SELECT DISTINCT j.value AS tag FROM "${table}", json_each("${table}".tags) AS j WHERE "${table}".tags IS NOT NULL ORDER BY tag`,
    )) as Array<{ tag: string }>;

    return result.map((row) => row.tag);
}

export function monthRollingAnniversarySql() {
    return {
        matured: sql<boolean>`date(created_at, '+1 month') <= date('now')`,
        dayMatches: sql<boolean>`min(
            cast(strftime('%d', created_at) as integer),
            cast(strftime('%d', date('now', 'start of month', '+1 month', '-1 day')) as integer)
        ) = cast(strftime('%d', 'now') as integer)`,
    };
}
