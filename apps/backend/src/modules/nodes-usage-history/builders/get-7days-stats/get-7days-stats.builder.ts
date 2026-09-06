import { Prisma } from '@prisma/client';

export class Get7DaysStatsBuilder {
    public query: Prisma.Sql;

    constructor() {
        this.query = this.getQuery();
        return this;
    }

    public getQuery(): Prisma.Sql {
        const query = `
            SELECT
                n.name as "nodeName",
                COALESCE(SUM(nu.total_bytes), 0) AS "totalBytes",
                date(nu.created_at) AS "date"
            FROM
                nodes_usage_history AS nu
            JOIN
                nodes AS n ON nu.node_uuid = n.uuid
            WHERE
                nu.created_at >= datetime('now', '-7 days')
            GROUP BY
                n.name, date(nu.created_at)
            ORDER BY
                "date" ASC
        `;

        return Prisma.raw(query);
    }
}
