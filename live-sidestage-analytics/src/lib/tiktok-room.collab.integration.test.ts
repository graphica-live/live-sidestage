// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// ensureRoomWatchedForCollab() の3分岐(未登録→新規作成/監視中→無変更/休止中→ON書き換え)を実DBで検証する。
import { describe, it, expect, afterAll, vi } from "vitest";
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
    const sourceRoomId = "itest-source-room-new";
    const result = await ensureRoomWatchedForCollab(subject, undefined, "collab", sourceRoomId);
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
    expect(room.lastCollabSourceRoomId).toBe(sourceRoomId);
    expect(room.lastCollabSourceAt).not.toBeNull();

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

    const sourceRoomId = "itest-source-room-active";
    const result = await ensureRoomWatchedForCollab(subject, undefined, "battle_start", sourceRoomId);
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
    expect(after.lastCollabSourceRoomId).toBe(sourceRoomId);
    expect(after.lastCollabSourceAt).not.toBeNull();
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

    const sourceRoomId = "itest-source-room-suspended";
    const result = await ensureRoomWatchedForCollab(subject, undefined, "battle_start", sourceRoomId);
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
    expect(after.lastCollabSourceRoomId).toBe(sourceRoomId);
    expect(after.lastCollabSourceAt).not.toBeNull();
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

    const sourceRoomId = "itest-source-room-keepsource";
    const result = await ensureRoomWatchedForCollab(subject, undefined, "battle_start", sourceRoomId);
    expect(result!.resumed).toBe(true);
    expect(result!.watchSource).toBe("collab");

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.watchSource).toBe("collab");
    // watchSourceは不変(最初の発見経路)だが、lastCollabSourceRoomIdは新列なので毎回上書きされる。
    expect(after.lastCollabSourceRoomId).toBe(sourceRoomId);
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
      "collab",
      "itest-source-room-norm"
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
      "collab",
      "itest-source-room-renamed"
    );
    expect(result!.roomId).toBe(room.id);
    expect(result!.created).toBe(false);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.tiktokHandle).toBe(renamedHandle);
  });

  it("不正な形式(記号・空文字のハンドル、非数値のuid)はnullを返し、部屋を作らない", async () => {
    const subject = makeSubject("invalid");
    const sourceRoomId = "itest-source-room-invalid";
    expect(
      await ensureRoomWatchedForCollab({ ...subject, tiktokHandle: "" }, undefined, "collab", sourceRoomId)
    ).toBeNull();
    expect(
      await ensureRoomWatchedForCollab(
        { ...subject, tiktokHandle: "has space" },
        undefined,
        "collab",
        sourceRoomId
      )
    ).toBeNull();
    // uid が protobuf 既定値の "0" / 非数値なら room を作らない(ハンドルは正しくても)。
    expect(
      await ensureRoomWatchedForCollab({ ...subject, tiktokUid: "0" }, undefined, "collab", sourceRoomId)
    ).toBeNull();
    expect(
      await ensureRoomWatchedForCollab(
        { ...subject, tiktokUid: "not-a-uid" },
        undefined,
        "collab",
        sourceRoomId
      )
    ).toBeNull();
  });

  it("workerIdを渡すと新規作成時にそのworkerIdで作成する", async () => {
    const subject = makeSubject("worker");
    const result = await ensureRoomWatchedForCollab(subject, 2, "collab", "itest-source-room-worker");
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

    // 別workerが検知した想定
    const result = await ensureRoomWatchedForCollab(subject, 2, "battle_start", "itest-source-room-keepworker");
    expect(result!.created).toBe(false);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.workerId).toBe(1); // 上書きされていない
  });

  describe("lastCollabSourceRoomId(コラボ発見元roomIDの永続化)", () => {
    it("監視中roomを2回連続で発見すると、lastCollabSourceRoomIdは毎回最新の発見元へ上書きされる", async () => {
      const subject = makeSubject("overwrite");
      const room = await prisma.tiktokRoom.create({
        data: {
          hostTiktokUid: subject.tiktokUid,
          tiktokHandle: subject.tiktokHandle,
          monitoringSuspended: false,
        },
      });
      roomIds.push(room.id);

      const firstSourceRoomId = "itest-source-room-overwrite-1";
      await ensureRoomWatchedForCollab(subject, undefined, "collab", firstSourceRoomId);
      const afterFirst = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
      expect(afterFirst.lastCollabSourceRoomId).toBe(firstSourceRoomId);
      const firstAt = afterFirst.lastCollabSourceAt;
      expect(firstAt).not.toBeNull();

      const secondSourceRoomId = "itest-source-room-overwrite-2";
      await ensureRoomWatchedForCollab(subject, undefined, "battle_start", secondSourceRoomId);
      const afterSecond = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
      expect(afterSecond.lastCollabSourceRoomId).toBe(secondSourceRoomId);
      expect(afterSecond.lastCollabSourceAt).not.toBeNull();
      // watchSourceは常にnull(監視中roomなので書き換え対象外)のまま、
      // lastCollabSourceRoomIdだけが更新される差異を確認する。
      expect(afterSecond.watchSource).toBeNull();
    });

    it("同じroomが別の発見元roomから再度発見されると、lastCollabSourceRoomIdが新しい発見元へ更新される(watchSourceは初回のまま不変)", async () => {
      const subject = makeSubject("resourced");
      const room = await prisma.tiktokRoom.create({
        data: {
          hostTiktokUid: subject.tiktokUid,
          tiktokHandle: subject.tiktokHandle,
          monitoringSuspended: true,
        },
      });
      roomIds.push(room.id);

      const firstSourceRoomId = "itest-source-room-resourced-1";
      const firstResult = await ensureRoomWatchedForCollab(subject, undefined, "collab", firstSourceRoomId);
      expect(firstResult!.resumed).toBe(true);
      expect(firstResult!.watchSource).toBe("collab");
      const afterFirst = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
      expect(afterFirst.lastCollabSourceRoomId).toBe(firstSourceRoomId);
      expect(afterFirst.watchSource).toBe("collab");

      const secondSourceRoomId = "itest-source-room-resourced-2";
      const secondResult = await ensureRoomWatchedForCollab(
        subject,
        undefined,
        "battle_start",
        secondSourceRoomId
      );
      expect(secondResult!.watchSource).toBe("collab"); // watchSourceは既存の"collab"のまま(上書きされない)

      const afterSecond = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
      expect(afterSecond.watchSource).toBe("collab"); // 不変
      expect(afterSecond.lastCollabSourceRoomId).toBe(secondSourceRoomId); // 新しい発見元へ更新
    });

    it("新規作成中にP2002競合が起きても、リトライ後の既存room分岐でlastCollabSourceRoomIdが正しく設定される", async () => {
      const subject = makeSubject("p2002");
      const sourceRoomId = "itest-source-room-p2002";

      // findUniqueの1回目だけ「未登録」を偽装してcreate分岐へ進ませ、
      // create実行前に別プロセスが同じhostTiktokUidでroomを作った状況(P2002)を再現する。
      const originalFindUnique = prisma.tiktokRoom.findUnique.bind(prisma.tiktokRoom);
      const findUniqueSpy = vi.spyOn(prisma.tiktokRoom, "findUnique");
      let firstCall = true;
      findUniqueSpy.mockImplementation((...args: Parameters<typeof originalFindUnique>) => {
        if (firstCall) {
          firstCall = false;
          return Promise.resolve(null) as ReturnType<typeof originalFindUnique>;
        }
        return originalFindUnique(...args);
      });

      const racingRoom = await prisma.tiktokRoom.create({
        data: { hostTiktokUid: subject.tiktokUid, tiktokHandle: subject.tiktokHandle },
      });
      roomIds.push(racingRoom.id);

      const result = await ensureRoomWatchedForCollab(subject, undefined, "collab", sourceRoomId);
      findUniqueSpy.mockRestore();

      expect(result).not.toBeNull();
      expect(result!.created).toBe(false); // P2002後のリトライで既存room分岐に入る
      expect(result!.roomId).toBe(racingRoom.id);
      const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: racingRoom.id } });
      expect(room.lastCollabSourceRoomId).toBe(sourceRoomId);
    });
  });
});
