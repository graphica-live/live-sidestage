// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// migrate-tiktok-userid-reset.ts は**全テーブルを TRUNCATE する**ので、他のテストと
// 同じDBでは絶対に走らせられない。このファイルは実行のたびに**専用の一時データベース**を
// `CREATE DATABASE` し、そこへ `prisma db push` でスキーマを流してから検証する。
// 終了時に `DROP DATABASE` する。
//
// 検証するのは plan §10 が要求する6ケース:
//  (a) 空DB(テーブル未作成)で例外を投げない
//  (b) データありDBで対象が空になる(`event."Event"` が0件)
//  (c) 実施済みDB(旧形の列が1つも無い)で何もしない
//  (d) marker があっても、旧形の列が1つでもあれば再実行される(旧形検出型)
//  (e) 旧スキーマ(新形の列が無い)に対して例外を投げない
//  (f) 手動確定(winnerDecidedBy IN ('MANUAL','DRAW'))が AppSetting へ退避される
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import {
  runReset,
  detectLegacyColumns,
  detectMissingNewColumns,
  REQUIRED_NEW_COLUMNS,
} from "./migrate-tiktok-userid-reset";

const TEST_DB_NAME = "itest_tiktok_uid_reset";

/** `postgresql://user:pass@host:port/dbname?params` の dbname だけ差し替える。 */
function withDatabase(url: string, dbName: string): string {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

let adminClient: PrismaClient;
let targetUrl: string;
let client: PrismaClient;

async function createFreshDatabase() {
  // CREATE/DROP DATABASE はトランザクション内で実行できないので $executeRawUnsafe を直に使う。
  await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}" WITH (FORCE)`);
  await adminClient.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
}

function pushSchema() {
  // Windows では .cmd を execFileSync で直接起動できない(Node 20 以降 EINVAL)ので、
  // prisma の CLI エントリを node で直に叩く。
  const prismaCli = require.resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: targetUrl },
    stdio: "pipe",
  });
}

async function existingColumns(c: PrismaClient): Promise<Set<string>> {
  const rows = await c.$queryRaw<{ table_schema: string; table_name: string; column_name: string }[]>`
    SELECT table_schema, table_name, column_name
      FROM information_schema.columns
     WHERE table_schema IN ('public', 'event')`;
  return new Set(rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));
}

/** cutover 前の状態を模す。旧形の列を1つ足すだけで「旧形検出型」の判定は成立する。 */
async function addLegacyColumn(c: PrismaClient) {
  await c.$executeRawUnsafe(`ALTER TABLE public.gifts ADD COLUMN IF NOT EXISTS "uniqueId" text`);
}

async function seedData(c: PrismaClient) {
  const user = await c.principal.create({ data: { email: `reset-${Date.now()}@local.test` } });
  const room = await c.tiktokRoom.create({
    data: { hostTiktokUid: "7000000000000000111", tiktokHandle: "itest_reset_host" },
  });
  await c.gift.create({
    data: {
      roomId: room.id,
      tiktokUid: "7000000000000000222",
      giftId: 1,
      giftName: "Rose",
      dayKey: "2026-09-08",
    },
  });
  const event = await c.event.create({
    data: {
      slug: `itest-reset-${Date.now()}`,
      title: "reset test",
      ownerPrincipalId: user.id,
      format: "TOURNAMENT",
      entryMode: "SOLO",
      startAt: new Date("2026-09-01T00:00:00Z"),
      endAt: new Date("2026-09-02T00:00:00Z"),
      sessions: {
        create: {
          startAt: new Date("2026-09-01T00:00:00Z"),
          endAt: new Date("2026-09-02T00:00:00Z"),
        },
      },
    },
    include: { sessions: true },
  });
  await c.eventMatch.create({
    data: {
      eventId: event.id,
      sessionId: event.sessions[0].id,
      status: "FINISHED",
      winnerDecidedBy: "MANUAL",
      decidedAt: new Date(),
    },
  });
  return { user, room, event };
}

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL が無い。npm run test:integration 経由で実行すること。");
  targetUrl = withDatabase(url, TEST_DB_NAME);
  adminClient = new PrismaClient({ datasources: { db: { url } } });
  await createFreshDatabase();
  client = new PrismaClient({ datasources: { db: { url: targetUrl } } });
}, 120_000);

afterAll(async () => {
  await client?.$disconnect();
  if (adminClient) {
    await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}" WITH (FORCE)`);
    await adminClient.$disconnect();
  }
}, 60_000);

describe("migrate-tiktok-userid-reset", () => {
  it("(a) テーブルが1つも無い空DBでも例外を投げず、何もしない", async () => {
    // db push 前。information_schema は空なので旧形も新形も見つからない。
    await expect(runReset(client)).resolves.toBeUndefined();
    const legacy = detectLegacyColumns(await existingColumns(client));
    expect(legacy).toHaveLength(0);
  }, 60_000);

  it("(c) 新形のみ(db push 直後)のDBでは何も消さない", async () => {
    pushSchema();
    const { event } = await seedData(client);

    await runReset(client);

    // 旧形の列が1つも無いので skip される。データは残る。
    expect(await client.gift.count()).toBe(1);
    expect(await client.event.count()).toBe(1);
    expect(await client.appSetting.findUnique({ where: { key: "tiktok-userid-reset:done" } })).toBeNull();
    expect(event.id).toBeTruthy();
  }, 180_000);

  it("新形の必須列が db push 後のスキーマに1つも欠けていない(指紋の綴りが実スキーマと一致する)", async () => {
    const missing = detectMissingNewColumns(await existingColumns(client));
    expect(missing).toEqual([]);
    expect(REQUIRED_NEW_COLUMNS.length).toBeGreaterThan(0);
  }, 60_000);

  it("(b)(f) 旧形の列があれば全 TRUNCATE し、手動確定を AppSetting へ退避する", async () => {
    await addLegacyColumn(client);
    expect(await client.gift.count()).toBe(1);
    expect(await client.eventMatch.count()).toBe(1);

    await runReset(client);

    expect(await client.gift.count()).toBe(0);
    expect(await client.event.count()).toBe(0);
    expect(await client.eventMatch.count()).toBe(0);
    expect(await client.tiktokRoom.count()).toBe(0);
    expect(await client.principal.count()).toBe(0);

    // 実行記録は残る(判定には使わない)。
    expect(
      await client.appSetting.findUnique({ where: { key: "tiktok-userid-reset:done" } })
    ).not.toBeNull();

    // 手動確定のバックアップは追記専用キー。TRUNCATE より前に採取されている。
    const backups = await client.appSetting.findMany({
      where: { key: { startsWith: "tiktok-userid-reset:manual-decisions-backup" } },
    });
    expect(backups).toHaveLength(1);
    // AppSetting.value は nullable。空で保存しない規律(§3 手順6.4)もここで固定する。
    const rawBackup = backups[0].value;
    expect(rawBackup).not.toBeNull();
    const decisions = JSON.parse(rawBackup as string) as { winnerDecidedBy: string }[];
    expect(decisions).toHaveLength(1);
    expect(decisions[0].winnerDecidedBy).toBe("MANUAL");
  }, 180_000);

  it("(d) marker があっても旧形の列が残っていれば再実行される", async () => {
    // 前ケースで marker は立っている。旧形の列(gifts.uniqueId)もまだ残っている。
    expect(
      await client.appSetting.findUnique({ where: { key: "tiktok-userid-reset:done" } })
    ).not.toBeNull();
    expect(detectLegacyColumns(await existingColumns(client)).length).toBeGreaterThan(0);

    await seedData(client);
    expect(await client.gift.count()).toBe(1);

    await runReset(client);

    expect(await client.gift.count()).toBe(0);
    expect(await client.event.count()).toBe(0);
  }, 180_000);

  it("(e) 新形の列が無い旧スキーマに対しても例外を投げない", async () => {
    // 新形の必須列を落として「旧スキーマ」を模す。Prisma アクセサを使っていれば
    // ここで P2022 になる — raw SQL 原則が守られていることの検証でもある。
    await client.$executeRawUnsafe(`ALTER TABLE public.gifts DROP COLUMN "tiktokUid"`);
    const missing = detectMissingNewColumns(await existingColumns(client));
    expect(missing.some((c) => c.table === "gifts" && c.column === "tiktokUid")).toBe(true);

    await expect(runReset(client)).resolves.toBeUndefined();
  }, 180_000);
});
