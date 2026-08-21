// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// 事務所まわりの認可境界(他事務所のデータに触れない)と、承認・上限・重複の扱いを検証する。
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  addWatch,
  createAgency,
  getAgencyByUserId,
  hashApiKey,
  issueAgencyApiKey,
  listWatchedRooms,
  listWatches,
  removeWatch,
} from "./agency";

// resolveWorkerForRoom() はWORKER_COUNTを要求する。接続そのものはWorkerプロセスの仕事なので、
// ここではWorker数だけ与えて割当が走ることを許す。
vi.stubEnv("WORKER_COUNT", "1");

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const userIds: string[] = [];
const roomTiktokIds: string[] = [];

async function makeAgency(name: string, approved: boolean) {
  const user = await prisma.user.create({ data: { email: `itest-agency-${suffix()}@local.test` } });
  userIds.push(user.id);
  const agency = await createAgency(user.id, name);
  if (approved) {
    await prisma.agency.update({
      where: { id: agency.id },
      data: { approved: true, approvedAt: new Date() },
    });
  }
  return { userId: user.id, agencyId: agency.id };
}

// TikTok IDとして通る文字だけで一意な値を作る(ハイフンは許可されていない)。
function trackRoom(tag: string) {
  const tiktokId = `itest${tag}${Math.random().toString(36).slice(2, 10)}`;
  roomTiktokIds.push(tiktokId.toLowerCase());
  return tiktokId;
}

let agencyA: { userId: string; agencyId: string };
let agencyB: { userId: string; agencyId: string };

beforeAll(async () => {
  agencyA = await makeAgency("事務所A", true);
  agencyB = await makeAgency("事務所B", true);
});

afterAll(async () => {
  await Promise.all(userIds.map((id) => prisma.user.delete({ where: { id } }).catch(() => {})));
  await Promise.all(
    roomTiktokIds.map((tiktokId) =>
      prisma.tiktokRoom.delete({ where: { tiktokId } }).catch(() => {})
    )
  );
  await prisma.$disconnect();
});

describe("addWatch", () => {
  it("監視対象を追加するとTiktokRoomが作られ、担当Workerが割り当たる", async () => {
    const tiktokId = trackRoom("add");
    const result = await addWatch(agencyA.agencyId, tiktokId, "Aチーム");

    expect(result.ok).toBe(true);

    const room = await prisma.tiktokRoom.findUnique({ where: { tiktokId: tiktokId.toLowerCase() } });
    expect(room).not.toBeNull();
    expect(room!.workerId).toBe(0);
  });

  it("同じIDの重複追加はduplicateで拒否する", async () => {
    const tiktokId = trackRoom("dup");
    await addWatch(agencyA.agencyId, tiktokId, null);

    const again = await addWatch(agencyA.agencyId, `@${tiktokId.toUpperCase()}`, null);
    expect(again).toMatchObject({ ok: false, code: "duplicate" });
  });

  it("別事務所は同じライバーを独立して監視でき、部屋は共有される", async () => {
    const tiktokId = trackRoom("shared");
    const a = await addWatch(agencyA.agencyId, tiktokId, null);
    const b = await addWatch(agencyB.agencyId, tiktokId, null);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const rooms = await prisma.tiktokRoom.findMany({ where: { tiktokId: tiktokId.toLowerCase() } });
    expect(rooms).toHaveLength(1);
  });

  it("形式が不正なIDは部屋を作らずに弾く", async () => {
    const bads = ["@", "https://www.tiktok.com/@someone", "some liver", "a"];

    for (const bad of bads) {
      const result = await addWatch(agencyA.agencyId, bad, null);
      expect(result).toMatchObject({ ok: false, code: "invalid" });
    }

    // 全体件数は他のテストファイルと並行実行されるため、この入力に対応する部屋の不在で判定する。
    const normalized = bads.map((b) => b.trim().replace(/^@/, "").toLowerCase());
    const created = await prisma.tiktokRoom.findMany({
      where: { tiktokId: { in: normalized } },
      select: { tiktokId: true },
    });
    expect(created).toEqual([]);
  });

  it("未承認の事務所は監視対象を追加できない", async () => {
    const pending = await makeAgency("未承認事務所", false);
    const result = await addWatch(pending.agencyId, "someliver", null);
    expect(result).toMatchObject({ ok: false, code: "unapproved" });
  });

  it("maxWatchTargetsを超える追加はlimitで拒否する", async () => {
    const limited = await makeAgency("上限テスト事務所", true);
    await prisma.agency.update({ where: { id: limited.agencyId }, data: { maxWatchTargets: 1 } });

    const first = trackRoom("lim1");
    const second = trackRoom("lim2");

    expect((await addWatch(limited.agencyId, first, null)).ok).toBe(true);
    expect(await addWatch(limited.agencyId, second, null)).toMatchObject({
      ok: false,
      code: "limit",
    });
  });
});

describe("認可境界", () => {
  it("listWatches/listWatchedRoomsは自分の監視対象しか返さない", async () => {
    const onlyA = trackRoom("onlya");
    await addWatch(agencyA.agencyId, onlyA, null);

    const bWatches = await listWatches(agencyB.agencyId);
    expect(bWatches.some((w) => w.tiktokId === onlyA)).toBe(false);

    const bRooms = await listWatchedRooms(agencyB.agencyId);
    expect(bRooms.some((r) => r.normalizedTiktokId === onlyA.toLowerCase())).toBe(false);
  });

  it("他事務所のwatchは削除できない", async () => {
    const tiktokId = trackRoom("idor");
    const added = await addWatch(agencyA.agencyId, tiktokId, null);
    expect(added.ok).toBe(true);
    const watchId = added.ok ? added.watch.id : "";

    // 事務所Bが事務所Aのwatch idを指定しても削除されない。
    expect(await removeWatch(agencyB.agencyId, watchId)).toBe(false);
    expect(await removeWatch(agencyA.agencyId, watchId)).toBe(true);
  });
});

describe("APIキー", () => {
  it("平文は保存せず、ハッシュで引き当てられる", async () => {
    const apiKey = await issueAgencyApiKey(agencyA.agencyId);

    const row = await prisma.agency.findUnique({
      where: { id: agencyA.agencyId },
      select: { apiKeyHash: true },
    });
    expect(row!.apiKeyHash).toBe(hashApiKey(apiKey));
    expect(row!.apiKeyHash).not.toBe(apiKey);

    const found = await prisma.agency.findUnique({ where: { apiKeyHash: hashApiKey(apiKey) } });
    expect(found!.id).toBe(agencyA.agencyId);
  });

  it("再発行すると旧キーでは引けなくなる", async () => {
    const oldKey = await issueAgencyApiKey(agencyA.agencyId);
    const newKey = await issueAgencyApiKey(agencyA.agencyId);
    expect(newKey).not.toBe(oldKey);

    expect(await prisma.agency.findUnique({ where: { apiKeyHash: hashApiKey(oldKey) } })).toBeNull();
    expect(
      (await prisma.agency.findUnique({ where: { apiKeyHash: hashApiKey(newKey) } }))!.id
    ).toBe(agencyA.agencyId);
  });

  it("getAgencyByUserIdは平文キーを返さない", async () => {
    const record = await getAgencyByUserId(agencyA.userId);
    expect(record!.hasApiKey).toBe(true);
    expect(JSON.stringify(record)).not.toContain("apiKey\":\"");
  });
});
