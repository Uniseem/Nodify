import { Prisma } from '@prisma/client';

export class BulkUpdateUserUsedTrafficBuilder {
    public query: Prisma.Sql;

    constructor(list: { u: string; b: string; n: string }[]) {
        this.query = this.getQuery(list);
        return this;
    }

    public getQuery(list: { u: string; b: string; n: string }[]): Prisma.Sql {
        if (list.length === 0) {
            return Prisma.sql`SELECT NULL AS "id" WHERE 0`;
        }

        const values = Prisma.join(
            list.map((h) => Prisma.sql`(${h.b}, ${h.u}, ${h.n})`),
        );

        return Prisma.sql`
        UPDATE "user_traffic" AS u
        SET
            "used_traffic_bytes"          = u."used_traffic_bytes" + d."inc_used",
            "lifetime_used_traffic_bytes" = u."lifetime_used_traffic_bytes" + d."inc_used",
            "online_at"                   = datetime('now'),
            "first_connected_at"          = COALESCE(u."first_connected_at", datetime('now')),
            "last_connected_node_uuid"    = d."last_connected_node_uuid"
        FROM (
          VALUES ${values}
        ) AS d("inc_used","id","last_connected_node_uuid")
        WHERE d."id" = u."id"
        RETURNING
            u."id" AS "id",
            (u."first_connected_at" = u."online_at") AS "isFirstConnection"
        `;
    }
}
