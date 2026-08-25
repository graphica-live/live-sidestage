// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// ステータス遷移の API ゲート。純粋関数(readiness.test.ts / status-transition.test.ts)では
// 押さえられない「認可・DBが実際に変わったか・finalizedAt・レスポンス契約」をここで固定する。
import { describe, it, expect, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const auth = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next-auth", () => ({
  getServerSession: async () => (auth.userId ? { user: { id: auth.userId } } : null),
}));

// next-auth をモックしてから読む(authz.ts が import 時に束縛するため)。
const { PATCH } = await import("./route");

const PREFIX = "itest_status";
const OWNER = `${PREFIX}_owner`;
const OTHER = `${PREFIX}_other`;
const START = new Date("2026-09-01T00:00:00.000Z");
const END = new Date("2026-09-08T00:00:00.000Z");

let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const createdEventIds: string[] = [];

async function newEvent(overrides: {
  format?: string;
  entryMode?: string;
  status?: string;
  finalizedAt?: Date | null;
  withSession?: boolean;
} = {}) {
  const withSession = overrides.withSession ?? true;
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 遷移テスト`,
      ownerUserId: OWNER,
      format: overrides.format ?? "DIAMOND_RACE",
      entryMode: overrides.entryMode ?? "SOLO",
      status: overrides.status ?? "SCHEDULED",
      finalizedAt: overrides.finalizedAt ?? null,
      startAt: START,
      endAt: END,
      ...(withSession ? { sessions: { create: [{ startAt: START, endAt: END }] } } : {}),
    },
    select: { id: true, slug: true },
  });
  createdEventIds.push(event.id);
  return event;
}

async function addParticipant(eventId: string, teamId?: string) {
  const tiktokId = `${PREFIX}_${uniqueSuffix()}`;
  await prisma.eventParticipant.create({
    data: {
      eventId,
      tiktokId,
      // roomId は TiktokRoom.id の論理参照(FKなし)。ここでは実在させなくてよい。
      roomId: `${PREFIX}_room_${uniqueSuffix()}`,
      displayName: tiktokId,
      teamId: teamId ?? null,
    },
  });
}

async function addTeam(eventId: string) {
  const team = await prisma.eventTeam.create({
    data: { eventId, name: `${PREFIX}_team_${uniqueSuffix()}` },
    select: { id: true },
  });
  return team.id;
}

/** 検知の対象にならないダミーの対戦。「表があるか」だけを見るゲートの検証用。 */
async function addMatch(eventId: string) {
  const session = await prisma.eventSession.findFirstOrThrow({
    where: { eventId },
    select: { id: true },
  });
  await prisma.eventMatch.create({
    data: { eventId, sessionId: session.id, round: 1, bracketPosition: 0, matchType: "1V1" },
  });
}

async function patchStatus(eventId: string, status: string) {
  const req = new NextRequest(`http://localhost/api/events/${eventId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const res = await PATCH(req, { params: { id: eventId } });
  return { res, body: await res.json().catch(() => null) };
}

async function statusOf(eventId: string) {
  const row = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { status: true, finalizedAt: true },
  });
  return row;
}

afterAll(async () => {
  for (const id of createdEventIds) {
    await prisma.eventMatch.deleteMany({ where: { eventId: id } }).catch(() => {});
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe("PATCH /api/events/[id] (ステータス)", () => {
  it("主催者以外には404を返し、状態も変えない", async () => {
    auth.userId = OWNER;
    const event = await newEvent({ status: "SCHEDULED" });
    await addParticipant(event.id);

    auth.userId = OTHER;
    const { res } = await patchStatus(event.id, "RUNNING");
    expect(res.status).toBe(404);
    expect((await statusOf(event.id)).status).toBe("SCHEDULED");

    auth.userId = null;
    expect((await patchStatus(event.id, "RUNNING")).res.status).toBe(404);
  });

  it("準備が整っていれば開催中にでき、応答は { id, slug, status } のまま", async () => {
    auth.userId = OWNER;
    const event = await newEvent();
    await addParticipant(event.id);

    const { res, body } = await patchStatus(event.id, "RUNNING");
    expect(res.status).toBe(200);
    expect(body).toEqual({ id: event.id, slug: event.slug, status: "RUNNING" });
    expect((await statusOf(event.id)).status).toBe("RUNNING");
  });

  it("トーナメント表が無いトーナメントは409 NOT_READYで弾き、状態を変えない", async () => {
    auth.userId = OWNER;
    const event = await newEvent({ format: "TOURNAMENT" });
    await addParticipant(event.id);
    await addParticipant(event.id);

    const { res, body } = await patchStatus(event.id, "RUNNING");
    expect(res.status).toBe(409);
    expect(body.code).toBe("NOT_READY");
    expect(body.tasks.map((t: { key: string }) => t.key)).toEqual(["BRACKET"]);
    expect(body.errors.length).toBeGreaterThan(0);
    expect((await statusOf(event.id)).status).toBe("SCHEDULED");
  });

  it("参加者が足りないトーナメントも弾く", async () => {
    auth.userId = OWNER;
    const event = await newEvent({ format: "TOURNAMENT" });
    await addParticipant(event.id);
    await addMatch(event.id);

    const { res, body } = await patchStatus(event.id, "RUNNING");
    expect(res.status).toBe(409);
    expect(body.tasks.map((t: { key: string }) => t.key)).toEqual(["ENTRANTS"]);
  });

  it("メンバーのいないチームは出場者に数えない", async () => {
    auth.userId = OWNER;
    const event = await newEvent({ format: "TOURNAMENT", entryMode: "TEAM" });
    const withMember = await addTeam(event.id);
    await addTeam(event.id); // 空のチーム
    await addParticipant(event.id, withMember);
    await addMatch(event.id);

    const first = await patchStatus(event.id, "RUNNING");
    expect(first.res.status).toBe(409);
    expect(first.body.tasks.map((t: { key: string }) => t.key)).toEqual(["ENTRANTS"]);

    // 2組目にメンバーを入れれば通る(空のチームが残っていても止めない)。
    const second = await addTeam(event.id);
    await addParticipant(event.id, second);
    expect((await patchStatus(event.id, "RUNNING")).res.status).toBe(200);
  });

  it("デスマッチは対戦カードが無くても開催できる", async () => {
    auth.userId = OWNER;
    const event = await newEvent({ format: "DEATHMATCH" });
    await addParticipant(event.id);
    await addParticipant(event.id);

    expect((await patchStatus(event.id, "RUNNING")).res.status).toBe(200);
  });

  it("日程を1件も持たない旧イベントでも開催できる", async () => {
    // resolveEventWindows() が外枠を1日程として扱うので、集計も検知も動く。
    auth.userId = OWNER;
    const event = await newEvent({ withSession: false });
    await addParticipant(event.id);

    expect((await patchStatus(event.id, "RUNNING")).res.status).toBe(200);
  });

  it("開催中から開催準備中へ戻せる", async () => {
    auth.userId = OWNER;
    const event = await newEvent({ status: "RUNNING" });
    await addParticipant(event.id);

    const { res } = await patchStatus(event.id, "SCHEDULED");
    expect(res.status).toBe(200);
    expect((await statusOf(event.id)).status).toBe("SCHEDULED");
  });

  it("表に無い遷移は409 INVALID_STATUS_TRANSITION", async () => {
    auth.userId = OWNER;
    const event = await newEvent({ status: "SCHEDULED" });

    const { res, body } = await patchStatus(event.id, "ARCHIVED");
    expect(res.status).toBe(409);
    expect(body.code).toBe("INVALID_STATUS_TRANSITION");
    expect((await statusOf(event.id)).status).toBe("SCHEDULED");
  });

  it("最終集計済みでも開催中へ戻せば再集計が再開する(finalizedAtをnullへ)", async () => {
    // これが無いと、締切後に最終集計を終えたイベントは開催中へ戻しても
    // aggregationWindow() から外れたままで二度と集計されない。
    auth.userId = OWNER;
    const event = await newEvent({ status: "SCHEDULED", finalizedAt: new Date() });
    await addParticipant(event.id);

    expect((await patchStatus(event.id, "RUNNING")).res.status).toBe(200);
    expect((await statusOf(event.id)).finalizedAt).toBeNull();
  });

  it("終了から開催中へ戻すときも同じ準備チェックを課す", async () => {
    auth.userId = OWNER;
    const event = await newEvent({ format: "TOURNAMENT", status: "FINISHED" });
    await addParticipant(event.id);
    await addParticipant(event.id);

    const { res, body } = await patchStatus(event.id, "RUNNING");
    expect(res.status).toBe(409);
    expect(body.code).toBe("NOT_READY");
    expect((await statusOf(event.id)).status).toBe("FINISHED");
  });

  it("同じステータスへの変更は冪等に成功し、副作用を起こさない", async () => {
    auth.userId = OWNER;
    const finalizedAt = new Date();
    const event = await newEvent({ status: "RUNNING", finalizedAt });

    const { res, body } = await patchStatus(event.id, "RUNNING");
    expect(res.status).toBe(200);
    expect(body.status).toBe("RUNNING");
    // 準備チェックも reopenAggregation も走らない(参加者0人でも通り、finalizedAt は残る)。
    expect((await statusOf(event.id)).finalizedAt).not.toBeNull();
  });

  it("未知のステータスは400", async () => {
    auth.userId = OWNER;
    const event = await newEvent();

    const { res } = await patchStatus(event.id, "SOMETHING_NEW");
    expect(res.status).toBe(400);
  });
});
