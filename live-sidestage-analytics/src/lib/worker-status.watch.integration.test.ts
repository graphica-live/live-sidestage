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
import { makeTiktokUid } from "./__fixtures__/gift";

// addWatchedRoom は room の同一性を tiktokUid(実在確認応答の不変ID)で決め、uid が取れない
// 応答は unverified で弾く。stub はハンドルから決定的に uid を返すので、テスト側で同じ
// ハンドルから作った既存 room と確実に一致する。
function stubChecker(verdict: AccountExistence = "EXISTS"): ExistenceChecker {
  return {
    async check(tiktokHandle: string) {
      return {
        verdict,
        nickname: verdict === "EXISTS" ? "テストニックネーム" : null,
        tiktokUid: verdict === "EXISTS" ? makeTiktokUid(tiktokHandle) : null,
      };
    },
    size: () => 0,
  };
}

const roomIds: string[] = [];
// isValidNormalizedTiktokHandle は正規化後2〜24文字までしか許さないため、接頭辞込みで収まる短さにする。
const suffix = () => Math.random().toString(36).slice(2, 8);

afterAll(async () => {
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("addWatchedRoom", () => {
  it("実在するIDは新規TiktokRoomを作成し監視対象(monitoringSuspended: false)になる", async () => {
    const tiktokHandle = `awnew_${suffix()}`;

    const result = await addWatchedRoom(tiktokHandle, stubChecker("EXISTS"));

    expect(result).toMatchObject({ status: "ok", tiktokHandle, created: true, nickname: "テストニックネーム" });
    if (result.status === "ok") roomIds.push(result.roomId);
    // tiktokHandle は @unique ではなくなったので findFirst で引く。
    const room = await prisma.tiktokRoom.findFirstOrThrow({ where: { tiktokHandle } });
    expect(room.monitoringSuspended).toBe(false);
    expect(room.hostTiktokUid).toBe(makeTiktokUid(tiktokHandle));
  });

  it("休止中(monitoringSuspended: true)の既存roomは復帰させる(新規作成しない)", async () => {
    const tiktokHandle = `awrev_${suffix()}`;
    const existing = await prisma.tiktokRoom.create({
      data: { tiktokHandle, hostTiktokUid: makeTiktokUid(tiktokHandle), monitoringSuspended: true },
      select: { id: true },
    });
    roomIds.push(existing.id);

    const result = await addWatchedRoom(tiktokHandle, stubChecker("EXISTS"));

    expect(result).toMatchObject({ status: "ok", roomId: existing.id, tiktokHandle, created: false });
    const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: existing.id } });
    expect(room.monitoringSuspended).toBe(false);
  });

  it("監視中(monitoringSuspended: false)の既存roomは冪等(何も壊さない)", async () => {
    const tiktokHandle = `awidem_${suffix()}`;
    const existing = await prisma.tiktokRoom.create({
      data: {
        tiktokHandle,
        hostTiktokUid: makeTiktokUid(tiktokHandle),
        monitoringSuspended: false,
        workerId: 1,
      },
      select: { id: true },
    });
    roomIds.push(existing.id);

    const result = await addWatchedRoom(tiktokHandle, stubChecker("EXISTS"));

    expect(result).toMatchObject({ status: "ok", roomId: existing.id, created: false });
    const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: existing.id } });
    expect(room.workerId).toBe(1); // 既存の担当workerを上書きしない
  });

  it("TikTok上に実在しないIDはfail-closedで拒否し部屋を作らない", async () => {
    const tiktokHandle = `awmiss_${suffix()}`;

    const result = await addWatchedRoom(tiktokHandle, stubChecker("MISSING"));

    expect(result).toEqual({ status: "not_found" });
    expect(await prisma.tiktokRoom.findFirst({ where: { tiktokHandle } })).toBeNull();
  });

  it("実在確認できない(UNVERIFIED)場合もfail-closedで拒否する", async () => {
    const tiktokHandle = `awunv_${suffix()}`;

    const result = await addWatchedRoom(tiktokHandle, stubChecker("UNVERIFIED"));

    expect(result).toEqual({ status: "unverified" });
    expect(await prisma.tiktokRoom.findFirst({ where: { tiktokHandle } })).toBeNull();
  });

  it("不正な形式のIDは実在確認を呼ばずinvalidを返す", async () => {
    let checkerCalled = false;
    const checker: ExistenceChecker = {
      async check() {
        checkerCalled = true;
        return { verdict: "EXISTS", nickname: null, tiktokUid: makeTiktokUid("never_called") };
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
        return { verdict: "EXISTS", nickname: null, tiktokUid: makeTiktokUid("never_called") };
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
    const tiktokHandle = `ab`; // 2文字ちょうど。実運用では衝突しうるが形式検証の境界確認が目的
    const result = await addWatchedRoom(tiktokHandle, stubChecker("MISSING"));
    // 形式は通り実在確認まで進んだ結果MISSINGで拒否される(invalidにはならない)ことを確認する
    expect(result.status).toBe("not_found");
  });

  it("上限(24文字)ちょうどは有効な形式として実在確認へ進む", async () => {
    const tiktokHandle = `aw24_${"x".repeat(19)}`; // 正規化後ちょうど24文字
    expect(tiktokHandle.length).toBe(24);
    const result = await addWatchedRoom(tiktokHandle, stubChecker("EXISTS"));
    expect(result.status).toBe("ok");
    if (result.status === "ok") roomIds.push(result.roomId);
  });

  it("@付き・大文字混じりの入力は正規化してから扱う", async () => {
    const raw = `@AwNorm_${suffix()}`;

    const result = await addWatchedRoom(raw, stubChecker("EXISTS"));

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      roomIds.push(result.roomId);
      expect(result.tiktokHandle).toBe(raw.replace(/^@/, "").toLowerCase());
    }
  });
});
