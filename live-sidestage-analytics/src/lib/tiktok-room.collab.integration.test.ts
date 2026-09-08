// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// ensureRoomWatchedForCollab() の3分岐(未登録→新規作成/監視中→無変更/休止中→ON書き換え)を実DBで検証する。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ensureRoomWatchedForCollab } from "./tiktok-room";

const roomIds: string[] = [];
const tiktokUids: string[] = [];

// room の同一性は hostTiktokUid(@unique)なので、テストごとに別の数値IDを配る。
let uidSeq = 0;

type Subject = { tiktokUid: string; tiktokHandle: string; nickname: string | null };

function makeSubject(tag: string): Subject {
  uidSeq += 1;
  // `Date.now() % 1_000_000` は約16.7分で一周するので、時刻+連番だけだと過去の実行が残した
  // 行と衝突しうる(hostTiktokUid は @unique なので、衝突すると「未登録」の分岐に入れない)。
  // 乱数を混ぜて、同じDBを共有する並行実行・再実行と当たらないようにする。
  const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  const tiktokUid = `7${String(Date.now() % 1_000_000).padStart(6, "0")}${rand}${String(uidSeq).padStart(5, "0")}`;
  tiktokUids.push(tiktokUid);
  return {
    tiktokUid,
    tiktokHandle: `itestcollab${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase(),
    nickname: `itest ${tag}`,
  };
}

afterAll(async () => {
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
  await prisma.tikTokUser.deleteMany({ where: { tiktokUid: { in: tiktokUids } } });
});

describe("ensureRoomWatchedForCollab", () => {
  it("未登録のtiktokUidは新規作成し、監視中(resumed: false)として返す", async () => {
    const subject = makeSubject("new");
    const result = await ensureRoomWatchedForCollab(subject, undefined, "collab");
    expect(result).not.toBeNull();
    roomIds.push(result!.roomId);

    expect(result!.tiktokHandle).toBe(subject.tiktokHandle);
    expect(result!.resumed).toBe(false);
    expect(result!.created).toBe(true);
    expect(result!.watchSource).toBe("collab");

    const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: result!.roomId } });
    expect(room.hostTiktokUid).toBe(subject.tiktokUid);
    expect(room.monitoringSuspended).toBe(false);
    expect(room.watchSource).toBe("collab");
    expect(room.watchSourceAt).not.toBeNull();

    // 同一トランザクションで TikTokUser(表示名の正本)も記録される。
    const user = await prisma.tikTokUser.findUniqueOrThrow({ where: { tiktokUid: subject.tiktokUid } });
    expect(user.tiktokHandle).toBe(subject.tiktokHandle);
    expect(user.nickname).toBe(subject.nickname);
  });

  it("既に監視中(monitoringSuspended: false)の部屋はそのまま(resumed: false)。watchSourceも書き換えない", async () => {
    const subject = makeSubject("active");
    const room = await prisma.tiktokRoom.create({
      data: {
        hostTiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        monitoringSuspended: false,
      },
    });
    roomIds.push(room.id);

    const result = await ensureRoomWatchedForCollab(subject, undefined, "battle_start");
    expect(result).toEqual({
      roomId: room.id,
      tiktokHandle: subject.tiktokHandle,
      resumed: false,
      created: false,
      watchSource: null,
    });

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(false);
    expect(after.watchSource).toBeNull();
  });

  it("休止中(monitoringSuspended: true)の部屋はONへ書き換える(resumed: true)。watchSourceがnullなら今回のsourceを書く", async () => {
    const subject = makeSubject("suspended");
    const room = await prisma.tiktokRoom.create({
      data: {
        hostTiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        monitoringSuspended: true,
      },
    });
    roomIds.push(room.id);

    const result = await ensureRoomWatchedForCollab(subject, undefined, "battle_start");
    expect(result).toEqual({
      roomId: room.id,
      tiktokHandle: subject.tiktokHandle,
      resumed: true,
      created: false,
      watchSource: "battle_start",
    });

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(false);
    expect(after.watchSource).toBe("battle_start");
  });

  it("休止中でも既にwatchSourceが記録済みなら上書きしない(最初の発見経路を残す)", async () => {
    const subject = makeSubject("keepsource");
    const room = await prisma.tiktokRoom.create({
      data: {
        hostTiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        monitoringSuspended: true,
        watchSource: "collab",
      },
    });
    roomIds.push(room.id);

    const result = await ensureRoomWatchedForCollab(subject, undefined, "battle_start");
    expect(result!.resumed).toBe(true);
    expect(result!.watchSource).toBe("collab");

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.watchSource).toBe("collab");
  });

  it("@付き・大文字混じりのtiktokHandleは正規化して保存する", async () => {
    const subject = makeSubject("norm");
    const room = await prisma.tiktokRoom.create({
      data: {
        hostTiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        monitoringSuspended: true,
      },
    });
    roomIds.push(room.id);

    const result = await ensureRoomWatchedForCollab(
      { ...subject, tiktokHandle: `@${subject.tiktokHandle.toUpperCase()}` },
      undefined,
      "collab"
    );
    expect(result).toEqual({
      roomId: room.id,
      tiktokHandle: subject.tiktokHandle,
      resumed: true,
      created: false,
      watchSource: "collab",
    });
  });

  // このリファクタリングの主目的。ハンドルが変わっても uid が同じなら room は割れない。
  it("ハンドルが改名されていても同じtiktokUidなら既存部屋を再利用し、ハンドルを追随させる", async () => {
    const subject = makeSubject("renamed");
    const room = await prisma.tiktokRoom.create({
      data: {
        hostTiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        monitoringSuspended: false,
      },
    });
    roomIds.push(room.id);

    const renamedHandle = `${subject.tiktokHandle}x`;
    const result = await ensureRoomWatchedForCollab(
      { ...subject, tiktokHandle: renamedHandle },
      undefined,
      "collab"
    );
    expect(result!.roomId).toBe(room.id);
    expect(result!.created).toBe(false);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.tiktokHandle).toBe(renamedHandle);
  });

  it("不正な形式(記号・空文字のハンドル、非数値のuid)はnullを返し、部屋を作らない", async () => {
    const subject = makeSubject("invalid");
    expect(await ensureRoomWatchedForCollab({ ...subject, tiktokHandle: "" }, undefined, "collab")).toBeNull();
    expect(
      await ensureRoomWatchedForCollab({ ...subject, tiktokHandle: "has space" }, undefined, "collab")
    ).toBeNull();
    // uid が protobuf 既定値の "0" / 非数値なら room を作らない(ハンドルは正しくても)。
    expect(await ensureRoomWatchedForCollab({ ...subject, tiktokUid: "0" }, undefined, "collab")).toBeNull();
    expect(
      await ensureRoomWatchedForCollab({ ...subject, tiktokUid: "not-a-uid" }, undefined, "collab")
    ).toBeNull();
  });

  it("workerIdを渡すと新規作成時にそのworkerIdで作成する", async () => {
    const subject = makeSubject("worker");
    const result = await ensureRoomWatchedForCollab(subject, 2, "collab");
    expect(result).not.toBeNull();
    roomIds.push(result!.roomId);
    expect(result!.created).toBe(true);

    const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: result!.roomId } });
    expect(room.workerId).toBe(2);
  });

  it("既存roomの再開時はworkerIdを渡してもDBのworkerIdを上書きしない", async () => {
    const subject = makeSubject("keepworker");
    const room = await prisma.tiktokRoom.create({
      data: {
        hostTiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        monitoringSuspended: true,
        workerId: 1,
      },
    });
    roomIds.push(room.id);

    const result = await ensureRoomWatchedForCollab(subject, 2, "battle_start"); // 別workerが検知した想定
    expect(result!.created).toBe(false);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.workerId).toBe(1); // 上書きされていない
  });
});
