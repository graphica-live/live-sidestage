// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// Wave1-A: resolveRoomForStreamerInTx() のatomicity検証。
// 修正前は「Streamer.tiktokUid/tiktokHandle更新」と「TiktokRoomのupsert + Streamer.roomId更新」が
// 別トランザクションで、中間でクラッシュすると tiktokUid=新 / roomId=旧room という不整合が
// 残りえた。修正後はresolveRoomForStreamerInTx()を呼び出し元の同一tx内で実行することで、
// この2段が原子的になる(全部コミットされるか、全部ロールバックされるかのどちらかしかない)。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveRoomForStreamer, resolveRoomForStreamerInTx, upsertRoomInTx } from "./tiktok-room";

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

let uidSeq = 0;
function makeSubject(tag: string) {
  uidSeq += 1;
  return {
    tiktokUid: `8${String(Date.now() % 1_000_000).padStart(6, "0")}${String(uidSeq).padStart(11, "0")}`,
    tiktokHandle: `itestw1a${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase(),
  };
}

const roomIds: string[] = [];
const principalIds: string[] = [];

async function makeStreamer(subject: { tiktokUid: string; tiktokHandle: string }) {
  const user = await prisma.principal.create({
    data: { email: `itest-w1a-${suffix()}@local.test`, name: "itest" },
    select: { id: true },
  });
  principalIds.push(user.id);
  const streamer = await prisma.streamer.create({
    data: {
      principalId: user.id,
      tiktokUid: subject.tiktokUid,
      tiktokHandle: subject.tiktokHandle,
      verificationCode: `itest-${suffix()}`,
      overlayToken: `itest-overlay-${suffix()}`,
    },
    select: { id: true },
  });
  return streamer;
}

afterAll(async () => {
  await prisma.streamer.deleteMany({ where: { principalId: { in: principalIds } } });
  await prisma.principal.deleteMany({ where: { id: { in: principalIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("resolveRoomForStreamer 正常系", () => {
  it("新規room作成: roomId未設定のStreamerがresolveすると新しいTiktokRoomが作られ、roomIdが埋まる", async () => {
    const subject = makeSubject("new");
    const streamer = await makeStreamer(subject);

    const roomId = await resolveRoomForStreamer(streamer.id);

    roomIds.push(roomId);
    const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: roomId } });
    expect(room.hostTiktokUid).toBe(subject.tiktokUid);
    expect(room.tiktokHandle).toBe(subject.tiktokHandle);

    const streamerAfter = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(streamerAfter.roomId).toBe(roomId);
  });

  it("既存room: 他の配信者が既に同じhostTiktokUidのroomを持っていれば、それを再利用しStreamer.roomIdへ紐付ける", async () => {
    const subject = makeSubject("existing");
    const existingRoom = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: subject.tiktokUid, tiktokHandle: subject.tiktokHandle },
      select: { id: true },
    });
    roomIds.push(existingRoom.id);
    const streamer = await makeStreamer(subject);

    const roomId = await resolveRoomForStreamer(streamer.id);
    expect(roomId).toBe(existingRoom.id);

    const streamerAfter = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(streamerAfter.roomId).toBe(existingRoom.id);
  });

  it("同一UID再設定(冪等): 既に正しいroomへ紐付いている状態で呼んでも無変化(早期return)で同じroomIdを返す", async () => {
    const subject = makeSubject("idempotent");
    const streamer = await makeStreamer(subject);
    const firstRoomId = await resolveRoomForStreamer(streamer.id);
    roomIds.push(firstRoomId);

    const secondRoomId = await resolveRoomForStreamer(streamer.id);
    expect(secondRoomId).toBe(firstRoomId);

    // room行自体も1件のまま(重複作成されていない)
    const rooms = await prisma.tiktokRoom.findMany({ where: { hostTiktokUid: subject.tiktokUid } });
    expect(rooms).toHaveLength(1);
  });

  it("UID変更: Streamer.tiktokUidが別アカウントへ切り替わると、resolveRoomForStreamerは新しいroomへ付け替える", async () => {
    const oldSubject = makeSubject("olduid");
    const streamer = await makeStreamer(oldSubject);
    const oldRoomId = await resolveRoomForStreamer(streamer.id);
    roomIds.push(oldRoomId);

    const newSubject = makeSubject("newuid");
    await prisma.streamer.update({
      where: { id: streamer.id },
      data: { tiktokUid: newSubject.tiktokUid, tiktokHandle: newSubject.tiktokHandle },
    });

    const newRoomId = await resolveRoomForStreamer(streamer.id);
    roomIds.push(newRoomId);
    expect(newRoomId).not.toBe(oldRoomId);

    const streamerAfter = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(streamerAfter.roomId).toBe(newRoomId);

    const newRoom = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: newRoomId } });
    expect(newRoom.hostTiktokUid).toBe(newSubject.tiktokUid);
  });
});

describe("resolveRoomForStreamerInTx atomicity(中間失敗で不整合を残さない)", () => {
  it("room解決後・呼び出し元txがロールバックすると、room作成もStreamer.roomId更新も両方消える(stale roomIdが残らない)", async () => {
    const subject = makeSubject("midfail");
    const streamer = await makeStreamer(subject);

    class InjectedFailure extends Error {}

    await expect(
      prisma.$transaction(async (tx) => {
        const { commit } = await resolveRoomForStreamerInTx(tx, streamer.id);
        // resolveRoomForStreamerInTx完了直後(room upsert + streamer.roomId更新は完了している)に
        // 呼び出し元のtxが失敗した状況を再現する。commit()自体はtx確定後専用の副作用なので
        // ここではまだ呼ばない(意図的に呼ばないことがWave1-Aの設計そのもの)。
        void commit;
        throw new InjectedFailure();
      })
    ).rejects.toThrow(InjectedFailure);

    // ロールバックされているので、room自体が作られていない
    const room = await prisma.tiktokRoom.findUnique({ where: { hostTiktokUid: subject.tiktokUid } });
    expect(room).toBeNull();

    // Streamer.roomIdも旧(null)のまま — 「tiktokUid=新, roomId=旧room」のような不整合が起きない
    const streamerAfter = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(streamerAfter.roomId).toBeNull();
  });

  it("room解決失敗(存在しないstreamerId): エラーを投げ、TiktokRoomを作成しない", async () => {
    await expect(
      prisma.$transaction(async (tx) => resolveRoomForStreamerInTx(tx, "itest-nonexistent-streamer-id"))
    ).rejects.toThrow(/not found/);
  });

  it("upsertRoomInTxはtx内でTiktokRoomを作るが、呼び出し元txがロールバックすれば消える", async () => {
    const subject = makeSubject("upsertrollback");
    class InjectedFailure extends Error {}

    await expect(
      prisma.$transaction(async (tx) => {
        await upsertRoomInTx(tx, { ...subject, nickname: null });
        throw new InjectedFailure();
      })
    ).rejects.toThrow(InjectedFailure);

    const room = await prisma.tiktokRoom.findUnique({ where: { hostTiktokUid: subject.tiktokUid } });
    expect(room).toBeNull();
  });
});
