// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// 事務所まわりの認可境界(他事務所のデータに触れない)と、発行・上限・重複の扱いを検証する。
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { ExistenceChecker } from "@/lib/tiktok-existence";
import type { AccountExistence } from "@/lib/tiktok-profile";
import {
  addWatch,
  createAgency,
  deleteAgency,
  getAgencyByEmail,
  hashApiKey,
  issueAgencyApiKey,
  listWatchedRooms,
  listWatches,
  removeWatch,
} from "./agency";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";

// resolveWorkerForRoom() はWORKER_COUNTを要求する。接続そのものはWorkerプロセスの仕事なので、
// ここではWorker数だけ与えて割当が走ることを許す。
vi.stubEnv("WORKER_COUNT", "1");

// addWatch は実在確認(requireExistingTiktokAccount)を通す。テスト用の合成IDは
// TikTok上に実在しないので、実際のAPIを叩かせず決め打ちの checker を注入する。
// addWatch は「所有の根拠」として実在確認応答の tiktokUid を room の hostTiktokUid に保存する
// (uid が取れない応答は unverified で弾かれる)ので、stub もハンドルから決定的な uid を返す。
// 同じハンドルからは必ず同じ uid が出るため、別事務所が同じライバーを追加しても room は共有される。
function stubChecker(verdict: AccountExistence = "EXISTS"): ExistenceChecker {
  return {
    async check(tiktokHandle: string) {
      return {
        verdict,
        nickname: null,
        tiktokUid: verdict === "EXISTS" ? makeTiktokUid(tiktokHandle) : null,
      };
    },
    size: () => 0,
  };
}
const existsChecker = { checker: stubChecker("EXISTS") };

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const agencyIds: string[] = [];
const roomTiktokHandles: string[] = [];

async function makeAgency(name: string) {
  const email = `itest-agency-${suffix()}@local.test`;
  const result = await createAgency(email, name);
  if (!result.ok) throw new Error(`createAgency failed: ${result.error}`);
  agencyIds.push(result.agency.id);
  return { email, agencyId: result.agency.id };
}

// TikTok IDとして通る文字だけで一意な値を作る(ハイフンは許可されていない)。
function trackRoom(tag: string) {
  const tiktokHandle = `itest${tag}${Math.random().toString(36).slice(2, 10)}`;
  roomTiktokHandles.push(tiktokHandle.toLowerCase());
  return tiktokHandle;
}

let agencyA: { email: string; agencyId: string };
let agencyB: { email: string; agencyId: string };

beforeAll(async () => {
  agencyA = await makeAgency("事務所A");
  agencyB = await makeAgency("事務所B");
});

afterAll(async () => {
  await prisma.agency.deleteMany({ where: { id: { in: agencyIds } } });
  // tiktokHandle は @unique ではなくなったので deleteMany で消す。
  await prisma.tiktokRoom
    .deleteMany({ where: { tiktokHandle: { in: roomTiktokHandles } } })
    .catch(() => {});
  await prisma.$disconnect();
});

describe("createAgency", () => {
  it("登録したメールアドレスでそのまま引ける(承認待ちを挟まない)", async () => {
    const email = `itest-lookup-${suffix()}@local.test`;
    const created = await createAgency(email, "引き当てテスト");
    expect(created.ok).toBe(true);
    if (created.ok) agencyIds.push(created.agency.id);

    const found = await getAgencyByEmail(email);
    expect(found).toMatchObject({ name: "引き当てテスト", email, watchCount: 0 });
  });

  it("大文字混じりで登録しても小文字で引ける", async () => {
    const local = `itest-Case-${suffix()}`;
    const created = await createAgency(`  ${local}@Local.TEST  `, "大文字テスト");
    expect(created.ok).toBe(true);
    if (created.ok) agencyIds.push(created.agency.id);

    expect(await getAgencyByEmail(`${local}@local.test`.toUpperCase())).not.toBeNull();
    expect(await getAgencyByEmail(`${local}@local.test`)).not.toBeNull();
  });

  it("登録されていないアドレスはnull", async () => {
    expect(await getAgencyByEmail("nobody@local.test")).toBeNull();
    expect(await getAgencyByEmail(null)).toBeNull();
    expect(await getAgencyByEmail(undefined)).toBeNull();
  });

  it("同じアドレスの二重登録は拒否する", async () => {
    const email = `itest-dup-${suffix()}@local.test`;
    const first = await createAgency(email, "1つめ");
    if (first.ok) agencyIds.push(first.agency.id);

    expect(await createAgency(email, "2つめ")).toMatchObject({ ok: false, code: "duplicate" });
  });

  it("不正な入力を弾く", async () => {
    expect(await createAgency("not-an-email", "名前あり")).toMatchObject({ ok: false, code: "invalid" });
    expect(await createAgency(`ok-${suffix()}@local.test`, "  ")).toMatchObject({ ok: false, code: "invalid" });
    expect(await createAgency(`ok2-${suffix()}@local.test`, "名前", 5000)).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("addWatch", () => {
  it("監視対象を追加するとTiktokRoomが作られ、担当Workerが割り当たる", async () => {
    const tiktokHandle = trackRoom("add");
    const result = await addWatch(agencyA.agencyId, tiktokHandle, "Aチーム", existsChecker);

    expect(result.ok).toBe(true);

    const room = await prisma.tiktokRoom.findFirst({ where: { tiktokHandle: tiktokHandle.toLowerCase() } });
    expect(room).not.toBeNull();
    expect(room!.workerId).toBe(0);
    // room の同一性は hostTiktokUid(実在確認が返した不変ID)で定義される。
    expect(room!.hostTiktokUid).toBe(makeTiktokUid(tiktokHandle.toLowerCase()));
  });

  it("同じIDの重複追加はduplicateで拒否する", async () => {
    const tiktokHandle = trackRoom("dup");
    await addWatch(agencyA.agencyId, tiktokHandle, null, existsChecker);

    const again = await addWatch(agencyA.agencyId, `@${tiktokHandle.toUpperCase()}`, null, existsChecker);
    expect(again).toMatchObject({ ok: false, code: "duplicate" });
  });

  it("別事務所は同じライバーを独立して監視でき、部屋は共有される", async () => {
    const tiktokHandle = trackRoom("shared");
    expect((await addWatch(agencyA.agencyId, tiktokHandle, null, existsChecker)).ok).toBe(true);
    expect((await addWatch(agencyB.agencyId, tiktokHandle, null, existsChecker)).ok).toBe(true);

    const rooms = await prisma.tiktokRoom.findMany({ where: { tiktokHandle: tiktokHandle.toLowerCase() } });
    expect(rooms).toHaveLength(1);
  });

  it("形式が不正なIDは部屋を作らずに弾く", async () => {
    const bads = ["@", "https://www.tiktok.com/@someone", "some liver", "a"];

    for (const bad of bads) {
      expect(await addWatch(agencyA.agencyId, bad, null)).toMatchObject({ ok: false, code: "invalid" });
    }

    // 全体件数は他のテストファイルと並行実行されるため、この入力に対応する部屋の不在で判定する。
    const normalized = bads.map((b) => b.trim().replace(/^@/, "").toLowerCase());
    const created = await prisma.tiktokRoom.findMany({
      where: { tiktokHandle: { in: normalized } },
      select: { tiktokHandle: true },
    });
    expect(created).toEqual([]);
  });

  it("TikTok上に実在しないIDはnot_foundで拒否し、部屋を作らない", async () => {
    const tiktokHandle = trackRoom("missing");
    const result = await addWatch(agencyA.agencyId, tiktokHandle, null, {
      checker: stubChecker("MISSING"),
    });

    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(await prisma.tiktokRoom.findFirst({ where: { tiktokHandle: tiktokHandle.toLowerCase() } })).toBeNull();
  });

  it("実在確認が判定できないときはunverifiedで拒否する(fail-closed)", async () => {
    const tiktokHandle = trackRoom("unverified");
    const result = await addWatch(agencyA.agencyId, tiktokHandle, null, {
      checker: stubChecker("UNVERIFIED"),
    });

    expect(result).toMatchObject({ ok: false, code: "unverified" });
    expect(await prisma.tiktokRoom.findFirst({ where: { tiktokHandle: tiktokHandle.toLowerCase() } })).toBeNull();
  });

  it("maxWatchTargetsを超える追加はlimitで拒否する", async () => {
    const limited = await makeAgency("上限テスト事務所");
    await prisma.agency.update({ where: { id: limited.agencyId }, data: { maxWatchTargets: 1 } });

    expect((await addWatch(limited.agencyId, trackRoom("lim1"), null, existsChecker)).ok).toBe(true);
    expect(await addWatch(limited.agencyId, trackRoom("lim2"), null, existsChecker)).toMatchObject({
      ok: false,
      code: "limit",
    });
  });
});

describe("認可境界", () => {
  it("listWatches/listWatchedRoomsは自分の監視対象しか返さない", async () => {
    const onlyA = trackRoom("onlya");
    await addWatch(agencyA.agencyId, onlyA, null, existsChecker);

    const bWatches = await listWatches(agencyB.agencyId);
    expect(bWatches.some((w) => w.tiktokHandle === onlyA)).toBe(false);

    const bRooms = await listWatchedRooms(agencyB.agencyId);
    expect(bRooms.some((r) => r.normalizedTiktokHandle === onlyA.toLowerCase())).toBe(false);
  });

  it("他事務所のwatchは削除できない", async () => {
    const added = await addWatch(agencyA.agencyId, trackRoom("idor"), null, existsChecker);
    expect(added.ok).toBe(true);
    const watchId = added.ok ? added.watch.id : "";

    expect(await removeWatch(agencyB.agencyId, watchId)).toBe(false);
    expect(await removeWatch(agencyA.agencyId, watchId)).toBe(true);
  });
});

describe("deleteAgency", () => {
  it("削除すると監視対象も消え、そのアカウントからは引けなくなる", async () => {
    const doomed = await makeAgency("削除される事務所");
    await addWatch(doomed.agencyId, trackRoom("del"), null, existsChecker);
    expect(await prisma.agencyWatch.count({ where: { agencyId: doomed.agencyId } })).toBe(1);

    expect(await deleteAgency(doomed.agencyId)).toBe(true);

    expect(await getAgencyByEmail(doomed.email)).toBeNull();
    expect(await prisma.agencyWatch.count({ where: { agencyId: doomed.agencyId } })).toBe(0);
  });

  it("存在しないidの削除はfalse", async () => {
    expect(await deleteAgency("no-such-id")).toBe(false);
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
    expect((await prisma.agency.findUnique({ where: { apiKeyHash: hashApiKey(newKey) } }))!.id).toBe(
      agencyA.agencyId
    );
  });

  it("getAgencyByEmailは平文キーを返さない", async () => {
    const record = await getAgencyByEmail(agencyA.email);
    expect(record!.hasApiKey).toBe(true);
    expect(JSON.stringify(record)).not.toContain('apiKey":"');
  });
});
