// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// addWatchedRoom() — admin/workers画面から監視対象TikTok IDを手動追加する。
// Streamer登録・AgencyWatch追加と同じfail-closedな実在確認を通してから、
// 「情報プール方針」(TiktokRoom.monitoringSuspended: false)で部屋を作る/復帰させるだけの設計を固定する。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./prisma";
import { addWatchedRoom } from "./worker-status";
import type { ExistenceChecker } from "./tiktok-existence";
import type { AccountExistence } from "./tiktok-profile";

function stubChecker(verdict: AccountExistence = "EXISTS"): ExistenceChecker {
  return {
    async check() {
      return { verdict, nickname: verdict === "EXISTS" ? "テストニックネーム" : null, userId: null };
    },
    size: () => 0,
  };
}

const roomIds: string[] = [];
// isValidNormalizedTiktokId は正規化後2〜24文字までしか許さないため、接頭辞込みで収まる短さにする。
const suffix = () => Math.random().toString(36).slice(2, 8);

afterAll(async () => {
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("addWatchedRoom", () => {
  it("実在するIDは新規TiktokRoomを作成し監視対象(monitoringSuspended: false)になる", async () => {
    const tiktokId = `awnew_${suffix()}`;

    const result = await addWatchedRoom(tiktokId, stubChecker("EXISTS"));

    expect(result).toMatchObject({ status: "ok", tiktokId, created: true, nickname: "テストニックネーム" });
    if (result.status === "ok") roomIds.push(result.roomId);
    const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { tiktokId } });
    expect(room.monitoringSuspended).toBe(false);
  });

  it("休止中(monitoringSuspended: true)の既存roomは復帰させる(新規作成しない)", async () => {
    const tiktokId = `awrev_${suffix()}`;
    const existing = await prisma.tiktokRoom.create({
      data: { tiktokId, monitoringSuspended: true },
      select: { id: true },
    });
    roomIds.push(existing.id);

    const result = await addWatchedRoom(tiktokId, stubChecker("EXISTS"));

    expect(result).toMatchObject({ status: "ok", roomId: existing.id, tiktokId, created: false });
    const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: existing.id } });
    expect(room.monitoringSuspended).toBe(false);
  });

  it("監視中(monitoringSuspended: false)の既存roomは冪等(何も壊さない)", async () => {
    const tiktokId = `awidem_${suffix()}`;
    const existing = await prisma.tiktokRoom.create({
      data: { tiktokId, monitoringSuspended: false, workerId: 1 },
      select: { id: true },
    });
    roomIds.push(existing.id);

    const result = await addWatchedRoom(tiktokId, stubChecker("EXISTS"));

    expect(result).toMatchObject({ status: "ok", roomId: existing.id, created: false });
    const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: existing.id } });
    expect(room.workerId).toBe(1); // 既存の担当workerを上書きしない
  });

  it("TikTok上に実在しないIDはfail-closedで拒否し部屋を作らない", async () => {
    const tiktokId = `awmiss_${suffix()}`;

    const result = await addWatchedRoom(tiktokId, stubChecker("MISSING"));

    expect(result).toEqual({ status: "not_found" });
    expect(await prisma.tiktokRoom.findUnique({ where: { tiktokId } })).toBeNull();
  });

  it("実在確認できない(UNVERIFIED)場合もfail-closedで拒否する", async () => {
    const tiktokId = `awunv_${suffix()}`;

    const result = await addWatchedRoom(tiktokId, stubChecker("UNVERIFIED"));

    expect(result).toEqual({ status: "unverified" });
    expect(await prisma.tiktokRoom.findUnique({ where: { tiktokId } })).toBeNull();
  });

  it("不正な形式のIDは実在確認を呼ばずinvalidを返す", async () => {
    let checkerCalled = false;
    const checker: ExistenceChecker = {
      async check() {
        checkerCalled = true;
        return { verdict: "EXISTS", nickname: null, userId: null };
      },
      size: () => 0,
    };

    const result = await addWatchedRoom("a", checker);

    expect(result.status).toBe("invalid");
    expect(checkerCalled).toBe(false);
  });

  it("25文字(上限超過)は実在確認を呼ばずinvalidを返す", async () => {
    let checkerCalled = false;
    const checker: ExistenceChecker = {
      async check() {
        checkerCalled = true;
        return { verdict: "EXISTS", nickname: null, userId: null };
      },
      size: () => 0,
    };

    const result = await addWatchedRoom("a".repeat(25), checker);

    expect(result.status).toBe("invalid");
    expect(checkerCalled).toBe(false);
  });

  it("許可されない記号を含む入力はinvalidを返す", async () => {
    const result = await addWatchedRoom("invalid@id#", stubChecker("EXISTS"));
    expect(result.status).toBe("invalid");
  });

  it("下限(2文字)ちょうどは有効な形式として実在確認へ進む", async () => {
    const tiktokId = `ab`; // 2文字ちょうど。実運用では衝突しうるが形式検証の境界確認が目的
    const result = await addWatchedRoom(tiktokId, stubChecker("MISSING"));
    // 形式は通り実在確認まで進んだ結果MISSINGで拒否される(invalidにはならない)ことを確認する
    expect(result.status).toBe("not_found");
  });

  it("上限(24文字)ちょうどは有効な形式として実在確認へ進む", async () => {
    const tiktokId = `aw24_${"x".repeat(19)}`; // 正規化後ちょうど24文字
    expect(tiktokId.length).toBe(24);
    const result = await addWatchedRoom(tiktokId, stubChecker("EXISTS"));
    expect(result.status).toBe("ok");
    if (result.status === "ok") roomIds.push(result.roomId);
  });

  it("@付き・大文字混じりの入力は正規化してから扱う", async () => {
    const raw = `@AwNorm_${suffix()}`;

    const result = await addWatchedRoom(raw, stubChecker("EXISTS"));

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      roomIds.push(result.roomId);
      expect(result.tiktokId).toBe(raw.replace(/^@/, "").toLowerCase());
    }
  });
});
