// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// fetchAssignedRooms() が watchedRoomFilter() と同じ条件で部屋を拾えているかを検証する。
// 「監視対象の条件」はこの関数と Worker(getMyRooms)で二重に持たないことが前提なので、
// Streamer / AgencyWatch / monitorUntil の3条件をそれぞれ単独で確認する。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { fetchAdminRoomList, fetchAssignedRooms } from "./worker-status";
import { makeTiktokUid } from "./__fixtures__/gift";

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const roomIds: string[] = [];
const principalIds: string[] = [];
const agencyIds: string[] = [];

// TikTok IDとして通る文字だけで一意な値を作る(ハイフンは許可されていない)。
function tiktokHandle(tag: string) {
  return `itestws${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom(data: {
  tag: string;
  workerId?: number | null;
  monitorUntil?: Date | null;
  listenerStatus?: string | null;
  monitoringSuspended?: boolean;
}) {
  const handle = tiktokHandle(data.tag);
  const room = await prisma.tiktokRoom.create({
    data: {
      tiktokHandle: handle,
      // @unique(NOT NULL)。部屋ごとに一意な数値文字列にする。
      hostTiktokUid: makeTiktokUid(handle),
      workerId: data.workerId ?? null,
      monitorUntil: data.monitorUntil ?? null,
      listenerStatus: data.listenerStatus ?? null,
      monitoringSuspended: data.monitoringSuspended ?? false,
    },
    select: { id: true, tiktokHandle: true },
  });
  roomIds.push(room.id);
  return room;
}

async function attachStreamer(roomId: string) {
  const user = await prisma.principal.create({
    data: { email: `itest-ws-${suffix()}@local.test`, name: "itest" },
    select: { id: true },
  });
  principalIds.push(user.id);
  const streamerHandle = tiktokHandle("s");
  await prisma.streamer.create({
    data: {
      principalId: user.id,
      tiktokUid: makeTiktokUid(streamerHandle),
      tiktokHandle: streamerHandle,
      roomId,
      verificationCode: `itest-${suffix()}`,
    },
  });
}

async function attachWatch(roomId: string, watchedTiktokHandle: string) {
  const agency = await prisma.agency.create({
    data: { email: `itest-ws-agency-${suffix()}@local.test`, name: "itest事務所" },
    select: { id: true },
  });
  agencyIds.push(agency.id);
  await prisma.agencyWatch.create({
    data: {
      agencyId: agency.id,
      roomId,
      tiktokUid: makeTiktokUid(watchedTiktokHandle),
      tiktokHandle: watchedTiktokHandle,
    },
  });
}

let streamerRoom: { id: string; tiktokHandle: string };
let watchRoom: { id: string; tiktokHandle: string };
let eventRoom: { id: string; tiktokHandle: string };
let idleRoom: { id: string; tiktokHandle: string };

beforeAll(async () => {
  streamerRoom = await makeRoom({ tag: "str", workerId: 0, listenerStatus: "connected" });
  await attachStreamer(streamerRoom.id);

  watchRoom = await makeRoom({ tag: "wat", workerId: 1 });
  await attachWatch(watchRoom.id, watchRoom.tiktokHandle);

  // イベントの期限付き監視だけがある部屋(Streamer も AgencyWatch も無い)。
  // monitoringSuspended:true にしておくことで、「monitorUntil が唯一の監視理由」に
  // なる(そうしないと新仕様ではStreamer/AgencyWatch無しでも既定で監視対象になり、
  // monitorUntil を過去にずらした後も別の理由で拾われ続けてしまう)。
  eventRoom = await makeRoom({
    tag: "evt",
    workerId: null,
    monitorUntil: new Date(Date.now() + 60 * 60 * 1000),
    monitoringSuspended: true,
  });

  // どの条件も満たさない部屋(明示的にmonitoringSuspended)。監視対象外なので拾われてはいけない。
  idleRoom = await makeRoom({
    tag: "idl",
    workerId: 0,
    monitorUntil: new Date(Date.now() - 60 * 60 * 1000),
    monitoringSuspended: true,
  });
});

afterAll(async () => {
  await prisma.eulerSignUsage.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.agencyWatch.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.agency.deleteMany({ where: { id: { in: agencyIds } } });
  await prisma.streamer.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.principal.deleteMany({ where: { id: { in: principalIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("fetchAssignedRooms", () => {
  it("Streamer が登録された部屋を拾い、担当workerIdと購読者数を返す", async () => {
    const rooms = await fetchAssignedRooms();
    const found = rooms.find((r) => r.roomId === streamerRoom.id);
    expect(found).toBeDefined();
    expect(found!.workerId).toBe(0);
    expect(found!.streamerCount).toBe(1);
    expect(found!.listenerStatus).toBe("connected");
    expect(found!.eventMonitored).toBe(false);
  });

  it("事務所の監視対象(AgencyWatch)だけの部屋も拾う", async () => {
    const rooms = await fetchAssignedRooms();
    const found = rooms.find((r) => r.roomId === watchRoom.id);
    expect(found).toBeDefined();
    expect(found!.watchCount).toBe(1);
    expect(found!.streamerCount).toBe(0);
  });

  it("イベントの期限付き監視(monitorUntil が未来)だけの部屋も拾い、eventMonitored を立てる", async () => {
    const rooms = await fetchAssignedRooms();
    const found = rooms.find((r) => r.roomId === eventRoom.id);
    expect(found).toBeDefined();
    expect(found!.eventMonitored).toBe(true);
    expect(found!.workerId).toBeNull();
  });

  it("monitoringSuspendedされ他の条件も満たさない部屋(監視期限切れ・登録なし)は拾わない", async () => {
    const rooms = await fetchAssignedRooms();
    expect(rooms.find((r) => r.roomId === idleRoom.id)).toBeUndefined();
  });

  it("AgencyWatchがある部屋はmonitoringSuspended:trueでも一覧に残る(監視解除が事務所監視で無効化される既存仕様)", async () => {
    const room = await makeRoom({ tag: "susw", workerId: 0, monitoringSuspended: true });
    await attachWatch(room.id, room.tiktokHandle);
    const rooms = await fetchAssignedRooms();
    expect(rooms.find((r) => r.roomId === room.id)).toBeDefined();
  });

  it("now を渡せば、その時刻基準で monitorUntil を判定する", async () => {
    // eventRoom の監視期限より後の時刻で見れば、監視対象から外れる。
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const rooms = await fetchAssignedRooms(future);
    expect(rooms.find((r) => r.roomId === eventRoom.id)).toBeUndefined();
    // Streamer がいる部屋は時刻に関係なく対象のまま。
    expect(rooms.find((r) => r.roomId === streamerRoom.id)).toBeDefined();
  });

  it("オプション未指定時は weeklyEulerSignUsageCount が null(既存呼び出し元の無改修動作)", async () => {
    const rooms = await fetchAssignedRooms();
    const found = rooms.find((r) => r.roomId === streamerRoom.id);
    expect(found!.weeklyEulerSignUsageCount).toBeNull();
  });
});

describe("fetchAdminRoomList", () => {
  it("watchedRoomFilter()を通さないため、monitoringSuspended:trueでAgencyWatch/monitorUntilも無い部屋(idleRoom)も一覧に含まれる", async () => {
    const rooms = await fetchAdminRoomList();
    const found = rooms.find((r) => r.roomId === idleRoom.id);
    expect(found).toBeDefined();
    expect(found!.monitoringSuspended).toBe(true);
  });

  it("workerId未割当の部屋(eventRoom、workerId:null)は含まれない(where: workerId not null)", async () => {
    const rooms = await fetchAdminRoomList();
    expect(rooms.find((r) => r.roomId === eventRoom.id)).toBeUndefined();
  });

  it("includeWeeklyEulerUsage未指定時はweeklyEulerSignUsageCountがnull", async () => {
    const rooms = await fetchAdminRoomList();
    const found = rooms.find((r) => r.roomId === streamerRoom.id);
    expect(found!.weeklyEulerSignUsageCount).toBeNull();
  });

  it("includeWeeklyEulerUsage:trueかつ署名消費0件ならweeklyEulerSignUsageCountは0(nullでない)", async () => {
    const rooms = await fetchAdminRoomList(new Date(), { includeWeeklyEulerUsage: true });
    const found = rooms.find((r) => r.roomId === streamerRoom.id);
    expect(found!.weeklyEulerSignUsageCount).toBe(0);
  });

  it("includeWeeklyEulerUsage:trueで直近7日以内(ちょうど7日前を含む)の署名消費を成功/失敗問わず数え、8日前の消費は含めない", async () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const within = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const exactlySevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const outside = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const base = {
      roomId: streamerRoom.id,
      tiktokHandle: streamerRoom.tiktokHandle,
      trigger: "start" as const,
      reason: null,
      role: "worker" as const,
      workerIndex: 0,
      listenerEpoch: null,
      credentialMode: "anonymous" as const,
      streamerPrincipalIds: [] as string[],
      agencyIds: [] as string[],
      eventIds: [] as string[],
    };
    await prisma.eulerSignUsage.createMany({
      data: [
        { ...base, requestedAt: within, createdAt: within, outcome: "success" },
        { ...base, requestedAt: within, createdAt: within, outcome: "failed" },
        { ...base, requestedAt: exactlySevenDaysAgo, createdAt: exactlySevenDaysAgo, outcome: "success" },
        { ...base, requestedAt: outside, createdAt: outside, outcome: "success" },
      ],
    });

    const rooms = await fetchAdminRoomList(now, { includeWeeklyEulerUsage: true });
    const found = rooms.find((r) => r.roomId === streamerRoom.id);
    // 直近7日以内(ちょうど7日前含む)の3件(success2+failed1)を数え、8日前の1件は含めない。
    expect(found!.weeklyEulerSignUsageCount).toBe(3);
  });

  it("listenerUpdatedAtの降順で並び、nullの部屋は末尾に来る", async () => {
    const older = await makeRoom({ tag: "ordold", workerId: 0 });
    const newer = await makeRoom({ tag: "ordnew", workerId: 0 });
    const nullRoom = await makeRoom({ tag: "ordnull", workerId: 0 });
    await prisma.tiktokRoom.update({
      where: { id: older.id },
      data: { listenerUpdatedAt: new Date("2026-08-01T00:00:00.000Z") },
    });
    await prisma.tiktokRoom.update({
      where: { id: newer.id },
      data: { listenerUpdatedAt: new Date("2026-08-20T00:00:00.000Z") },
    });

    const rooms = await fetchAdminRoomList();
    const indexOf = (id: string) => rooms.findIndex((r) => r.roomId === id);
    expect(indexOf(newer.id)).toBeGreaterThanOrEqual(0);
    expect(indexOf(newer.id)).toBeLessThan(indexOf(older.id));
    expect(indexOf(older.id)).toBeLessThan(indexOf(nullRoom.id));
  });

  it("includeSignatureUsage24h未指定時はsignatureUsage24hCountがnull", async () => {
    const rooms = await fetchAdminRoomList();
    const found = rooms.find((r) => r.roomId === streamerRoom.id);
    expect(found!.signatureUsage24hCount).toBeNull();
  });

  it("includeSignatureUsage24h:trueかつ署名消費0件ならsignatureUsage24hCountは0(nullでない)", async () => {
    const rooms = await fetchAdminRoomList(new Date(), { includeSignatureUsage24h: true });
    const found = rooms.find((r) => r.roomId === streamerRoom.id);
    expect(found!.signatureUsage24hCount).toBe(0);
  });

  it("includeSignatureUsage24h:trueで直近24時間以内(ちょうど24時間前を含む)の署名消費を成功/失敗問わず数え、25時間前の消費は含めない", async () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const within = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const exactlyOneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const outside = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const base = {
      roomId: streamerRoom.id,
      tiktokHandle: streamerRoom.tiktokHandle,
      trigger: "start" as const,
      reason: null,
      role: "worker" as const,
      workerIndex: 0,
      listenerEpoch: null,
      credentialMode: "anonymous" as const,
      streamerPrincipalIds: [] as string[],
      agencyIds: [] as string[],
      eventIds: [] as string[],
    };
    await prisma.eulerSignUsage.createMany({
      data: [
        { ...base, requestedAt: within, createdAt: within, outcome: "success" },
        { ...base, requestedAt: within, createdAt: within, outcome: "failed" },
        { ...base, requestedAt: exactlyOneDayAgo, createdAt: exactlyOneDayAgo, outcome: "success" },
        { ...base, requestedAt: outside, createdAt: outside, outcome: "success" },
      ],
    });

    const rooms = await fetchAdminRoomList(now, { includeSignatureUsage24h: true });
    const found = rooms.find((r) => r.roomId === streamerRoom.id);
    // 直近24時間以内(ちょうど24時間前含む)の3件(success2+failed1)を数え、25時間前の1件は含めない。
    expect(found!.signatureUsage24hCount).toBe(3);
  });

  it("includeSignatureUsage24h未指定時はcollabSignatureUsage24hCountがnull", async () => {
    const sourceRoom = await makeRoom({ tag: "collabsrc1", workerId: 0 });
    const rooms = await fetchAdminRoomList();
    const found = rooms.find((r) => r.roomId === sourceRoom.id);
    expect(found!.collabSignatureUsage24hCount).toBeNull();
  });

  it("includeSignatureUsage24h:trueかつコラボ署名消費0件ならcollabSignatureUsage24hCountは0(nullでない)", async () => {
    const sourceRoom = await makeRoom({ tag: "collabsrc2", workerId: 0 });
    const rooms = await fetchAdminRoomList(new Date(), { includeSignatureUsage24h: true });
    const found = rooms.find((r) => r.roomId === sourceRoom.id);
    expect(found!.collabSignatureUsage24hCount).toBe(0);
  });

  it("includeSignatureUsage24h:trueで、lastCollabSourceRoomIdが発見元roomとして記録されたroomのコラボ署名消費を集計する", async () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const sourceRoom = await makeRoom({ tag: "collabsrc3", workerId: 0 });
    const discoveredRoom = await makeRoom({ tag: "collabdisc1", workerId: 0 });

    // discoveredRoom の lastCollabSourceRoomId を sourceRoom に設定
    await prisma.tiktokRoom.update({
      where: { id: discoveredRoom.id },
      data: { lastCollabSourceRoomId: sourceRoom.id, lastCollabSourceAt: now },
    });

    // discoveredRoom での署名消費(非購読時点の消費)を記録
    const baseUsage = {
      roomId: discoveredRoom.id,
      tiktokHandle: discoveredRoom.tiktokHandle,
      trigger: "start" as const,
      reason: null,
      role: "worker" as const,
      workerIndex: 0,
      listenerEpoch: null,
      credentialMode: "anonymous" as const,
      streamerPrincipalIds: [] as string[],
      agencyIds: [] as string[],
      eventIds: [] as string[],
      roomMonitorUntil: null,
    };
    const within = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    await prisma.eulerSignUsage.createMany({
      data: [
        { ...baseUsage, requestedAt: within, createdAt: within, outcome: "success" },
        { ...baseUsage, requestedAt: within, createdAt: within, outcome: "failed" },
      ],
    });

    const rooms = await fetchAdminRoomList(now, { includeSignatureUsage24h: true });
    const found = rooms.find((r) => r.roomId === sourceRoom.id);
    // 非購読時点の消費2件を数える
    expect(found!.collabSignatureUsage24hCount).toBe(2);
  });

  it("includeSignatureUsage24h:trueで、記録時点で購読状態(Streamer登録あり)の消費はコラボ署名消費に含めない", async () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const sourceRoom = await makeRoom({ tag: "collabsrc4", workerId: 0 });
    const discoveredRoom = await makeRoom({ tag: "collabdisc2", workerId: 0 });

    // discoveredRoom の lastCollabSourceRoomId を sourceRoom に設定
    await prisma.tiktokRoom.update({
      where: { id: discoveredRoom.id },
      data: { lastCollabSourceRoomId: sourceRoom.id, lastCollabSourceAt: now },
    });

    // Streamer を作成してシリアライズする
    const user = await prisma.principal.create({
      data: { email: `itest-ws-collab-${suffix()}@local.test`, name: "itest" },
      select: { id: true },
    });
    principalIds.push(user.id);
    const streamerHandle = tiktokHandle("collab_s");
    await prisma.streamer.create({
      data: {
        principalId: user.id,
        tiktokUid: makeTiktokUid(streamerHandle),
        tiktokHandle: streamerHandle,
        roomId: discoveredRoom.id,
        verificationCode: `itest-${suffix()}`,
      },
    });

    // 購読状態での署名消費を記録
    const within = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    await prisma.eulerSignUsage.create({
      data: {
        roomId: discoveredRoom.id,
        tiktokHandle: discoveredRoom.tiktokHandle,
        trigger: "start",
        reason: null,
        role: "worker",
        workerIndex: 0,
        listenerEpoch: null,
        credentialMode: "anonymous",
        streamerPrincipalIds: [user.id], // 購読状態
        agencyIds: [],
        eventIds: [],
        roomMonitorUntil: null,
        requestedAt: within,
        createdAt: within,
        outcome: "success",
      },
    });

    const rooms = await fetchAdminRoomList(now, { includeSignatureUsage24h: true });
    const found = rooms.find((r) => r.roomId === sourceRoom.id);
    // 購読状態での消費は含めないので0
    expect(found!.collabSignatureUsage24hCount).toBe(0);
  });

  it("includeSignatureUsage24h:trueで、記録時点でイベント監視中(roomMonitorUntilが有効)の消費はコラボ署名消費に含めない", async () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const sourceRoom = await makeRoom({ tag: "collabsrc5", workerId: 0 });
    const discoveredRoom = await makeRoom({ tag: "collabdisc3", workerId: 0 });

    // discoveredRoom の lastCollabSourceRoomId を sourceRoom に設定
    await prisma.tiktokRoom.update({
      where: { id: discoveredRoom.id },
      data: { lastCollabSourceRoomId: sourceRoom.id, lastCollabSourceAt: now },
    });

    // イベント監視中での署名消費を記録
    const within = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const futureMonitorUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await prisma.eulerSignUsage.create({
      data: {
        roomId: discoveredRoom.id,
        tiktokHandle: discoveredRoom.tiktokHandle,
        trigger: "start",
        reason: null,
        role: "worker",
        workerIndex: 0,
        listenerEpoch: null,
        credentialMode: "anonymous",
        streamerPrincipalIds: [],
        agencyIds: [],
        eventIds: [],
        roomMonitorUntil: futureMonitorUntil, // イベント監視中
        requestedAt: within,
        createdAt: within,
        outcome: "success",
      },
    });

    const rooms = await fetchAdminRoomList(now, { includeSignatureUsage24h: true });
    const found = rooms.find((r) => r.roomId === sourceRoom.id);
    // イベント監視中の消費は含めないので0
    expect(found!.collabSignatureUsage24hCount).toBe(0);
  });

  it("includeSignatureUsage24h:trueで、直近24時間以外のコラボ署名消費は含めない", async () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const sourceRoom = await makeRoom({ tag: "collabsrc6", workerId: 0 });
    const discoveredRoom = await makeRoom({ tag: "collabdisc4", workerId: 0 });

    // discoveredRoom の lastCollabSourceRoomId を sourceRoom に設定
    await prisma.tiktokRoom.update({
      where: { id: discoveredRoom.id },
      data: { lastCollabSourceRoomId: sourceRoom.id, lastCollabSourceAt: now },
    });

    // 24時間以内と以外の消費を記録
    const within = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const outside = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const baseUsage = {
      roomId: discoveredRoom.id,
      tiktokHandle: discoveredRoom.tiktokHandle,
      trigger: "start" as const,
      reason: null,
      role: "worker" as const,
      workerIndex: 0,
      listenerEpoch: null,
      credentialMode: "anonymous" as const,
      streamerPrincipalIds: [] as string[],
      agencyIds: [] as string[],
      eventIds: [] as string[],
      roomMonitorUntil: null,
    };
    await prisma.eulerSignUsage.createMany({
      data: [
        { ...baseUsage, requestedAt: within, createdAt: within, outcome: "success" },
        { ...baseUsage, requestedAt: outside, createdAt: outside, outcome: "success" },
      ],
    });

    const rooms = await fetchAdminRoomList(now, { includeSignatureUsage24h: true });
    const found = rooms.find((r) => r.roomId === sourceRoom.id);
    // 24時間以内の1件だけを数える
    expect(found!.collabSignatureUsage24hCount).toBe(1);
  });
});
