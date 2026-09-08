import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { ruleFixture } from "./rule-fixture.mjs";

const require = createRequire(import.meta.url);
require("./loader.cjs");
const {
  SqliteKyselyModule,
} = require("../apps/backend/src/common/database/kysely-prisma/kysely.module.ts");
const {
  CustomCamelCasePlugin,
  JSON_COLUMNS,
} = require("../apps/backend/src/common/database/camel-case.plugin.ts");
const {
  InternalSquadRepository,
} = require("../apps/backend/src/modules/internal-squads/repositories/internal-squad.repository.ts");
const {
  ConfigProfileRepository,
} = require("../apps/backend/src/modules/config-profiles/repositories/config-profile.repository.ts");

test("SQLite squad and profile list/detail queries return nested inbounds, preserve raw JSON and handle empty relations", async () => {
  const { db, directory, user } = await ruleFixture();
  const host = { tx: db };
  const module = SqliteKyselyModule.forRoot({
    plugins: [new CustomCamelCasePlugin({ excludeColumns: JSON_COLUMNS })],
  });
  const kysely = module.providers[0].useFactory(host);
  const squads = new InternalSquadRepository(host, { kysely }, undefined);
  const profiles = new ConfigProfileRepository(host, { kysely }, undefined);
  try {
    const rawInbound = {
      tag: "sqlite-inbound",
      protocol: "vless",
      streamSettings: {
        network: "xhttp",
        xhttpSettings: { extra: { keep_snake_case: true } },
      },
      settings: {
        clients: [{ id: randomUUID(), email: "member@example.test" }],
      },
    };
    const profile = await db.configProfiles.create({
      data: {
        name: "SQLite nested profile",
        config: { inbounds: [rawInbound] },
        tags: ["profile-tag"],
        configProfileInbounds: {
          create: [
            {
              tag: "sqlite-inbound",
              type: "vless",
              port: 443,
              network: "xhttp",
              security: "tls",
              rawInbound,
            },
            { tag: "sqlite-null-inbound", type: "trojan" },
          ],
        },
      },
      include: { configProfileInbounds: true },
    });
    const inbound = profile.configProfileInbounds.find(
      (item) => item.tag === "sqlite-inbound",
    );
    const squad = await db.internalSquads.create({
      data: {
        name: "SQLite nested squad",
        tags: ["squad-tag"],
        internalSquadInbounds: { create: { inboundUuid: inbound.uuid } },
        internalSquadMembers: { create: { userId: user.id } },
      },
    });
    const emptySquad = await db.internalSquads.create({
      data: { name: "SQLite empty squad" },
    });
    const emptyProfile = await db.configProfiles.create({
      data: { name: "SQLite empty profile", config: {} },
    });
    for (const result of [
      (await squads.getInternalSquads()).find(
        (item) => item.uuid === squad.uuid,
      ),
      await squads.getInternalSquadsByUuid(squad.uuid),
    ]) {
      assert.equal(result.membersCount, 1);
      assert.equal(result.inboundsCount, 1);
      assert.deepEqual(result.tags, ["squad-tag"]);
      assert.deepEqual(result.inbounds, [inbound]);
    }
    for (const result of [
      (await profiles.getAllConfigProfiles()).find(
        (item) => item.uuid === profile.uuid,
      ),
      await profiles.getConfigProfileByUUID(profile.uuid),
    ]) {
      assert.deepEqual(result.tags, ["profile-tag"]);
      assert.deepEqual(result.config, profile.config);
      assert.deepEqual(
        result.inbounds.sort((a, b) => a.tag.localeCompare(b.tag)),
        profile.configProfileInbounds.sort((a, b) =>
          a.tag.localeCompare(b.tag),
        ),
      );
      assert.deepEqual(result.nodes, []);
    }
    assert.deepEqual(
      (await squads.getInternalSquadsByUuid(emptySquad.uuid)).inbounds,
      [],
    );
    assert.deepEqual(
      (await profiles.getConfigProfileByUUID(emptyProfile.uuid)).inbounds,
      [],
    );
    assert.equal(await squads.getInternalSquadsByUuid(randomUUID()), null);
    assert.equal(await profiles.getConfigProfileByUUID(randomUUID()), null);
  } finally {
    await kysely.destroy();
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
