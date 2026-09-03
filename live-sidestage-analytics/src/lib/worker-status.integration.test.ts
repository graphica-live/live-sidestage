// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// fetchAssignedRooms() が watchedRoomFilter() と同じ条件で部屋を拾えているかを検証する。
// 「監視対象の条件」はこの関数と Worker(getMyRooms)で二重に持たないことが前提なので、
// Streamer / AgencyWatch / monitorUntil の3条件をそれぞれ単独で確認する。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { fetchAssignedRooms } from "./worker-status";

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const roomIds: string[] = [];
const userIds: string[] = [];
const agencyIds: string[] = [];

// TikTok IDとして通る文字だけで一意な値を作る(ハイフンは許可されていない)。
function tiktokId(tag: string) {
  return `itestws${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom(data: {
  tag: string;
  workerId?: number | null;
  monitorUntil?: Date | null;
  listenerStatus?: string | null;
  monitoringSuspended?: boolean;
}) {
  const room = await prisma.tiktokRoom.create({
    data: {
      tiktokId: tiktokId(data.tag),
      workerId: data.workerId ?? null,
      monitorUntil: data.monitorUntil ?? null,
      listenerStatus: data.listenerStatus ?? null,
      monitoringSuspended: data.monitoringSuspended ?? false,
    },
    select: { id: true, tiktokId: true },
  });
  roomIds.push(room.id);
  return room;
}

async function attachStreamer(roomId: string) {
  const user = await prisma.user.create({
    data: { email: `itest-ws-${suffix()}@local.test`, name: "itest" },
    select: { id: true },
  });
  userIds.push(user.id);
  await prisma.streamer.create({
    data: {
      userId: user.id,
      tiktokId: tiktokId("s"),
      roomId,
      verificationCode: `itest-${suffix()}`,
    },
  });
}

async function attachWatch(roomId: string, watchedTiktokId: string) {
  const agency = await prisma.agency.create({
    data: { email: `itest-ws-agency-${suffix()}@local.test`, name: "itest事務所" },
    select: { id: true },
  });
  agencyIds.push(agency.id);
  await prisma.agencyWatch.create({
    data: { agencyId: agency.id, roomId, tiktokId: watchedTiktokId },
  });
}

let streamerRoom: { id: string; tiktokId: string };
let watchRoom: { id: string; tiktokId: string };
let eventRoom: { id: string; tiktokId: string };
let idleRoom: { id: string; tiktokId: string };

beforeAll(async () => {
  streamerRoom = await makeRoom({ tag: "str", workerId: 0, listenerStatus: "connected" });
  await attachStreamer(streamerRoom.id);

  watchRoom = await makeRoom({ tag: "wat", workerId: 1 });
  await attachWatch(watchRoom.id, watchRoom.tiktokId);

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
  await prisma.agencyWatch.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.agency.deleteMany({ where: { id: { in: agencyIds } } });
  await prisma.streamer.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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

  it("now を渡せば、その時刻基準で monitorUntil を判定する", async () => {
    // eventRoom の監視期限より後の時刻で見れば、監視対象から外れる。
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const rooms = await fetchAssignedRooms(future);
    expect(rooms.find((r) => r.roomId === eventRoom.id)).toBeUndefined();
    // Streamer がいる部屋は時刻に関係なく対象のまま。
    expect(rooms.find((r) => r.roomId === streamerRoom.id)).toBeDefined();
  });
});
