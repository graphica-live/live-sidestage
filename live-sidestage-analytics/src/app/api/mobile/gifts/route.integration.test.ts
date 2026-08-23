// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// モバイルの「ギフトを選ぶ」ピッカーへ返す候補一覧を検証する。
//
// 一致キーの正規化(trim + 小文字化)が socket.io の chat:gift と揃っていないと、
// ピッカーで選んだギフト名が実際のイベントと永久に一致しなくなる。ここが要点。
//
// `tiktok_gift_catalog` は部屋に紐づかないグローバルなテーブルなので、
// このファイルの前後で中身を空にしてから検証する(テスト専用DBなので消してよい)。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_gifts";

let userId: string;
let streamerId: string;
let roomId: string;
let otherUserId: string;
let noRoomUserId: string;
let token: string;
let otherToken: string;
let noRoomToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-gifts-secret";

beforeAll(async () => {
  await prisma.tiktokGiftCatalog.deleteMany();

  const room = await prisma.tiktokRoom.create({ data: { tiktokId: TIKTOK_ID } });
  roomId = room.id;

  const user = await prisma.user.create({ data: { email: `itest-mobile-gifts-${Date.now()}@local.test` } });
  userId = user.id;
  const streamer = await prisma.streamer.create({
    data: { userId, tiktokId: TIKTOK_ID, verificationCode: "x", verified: true, roomId },
  });
  streamerId = streamer.id;
  token = signMobileToken({ userId, streamerId });

  // Streamerを持たないユーザー。404になることの確認用。
  const other = await prisma.user.create({
    data: { email: `itest-mobile-gifts-other-${Date.now()}@local.test` },
  });
  otherUserId = other.id;
  otherToken = signMobileToken({ userId: otherUserId });

  // Streamerはあるが部屋がまだ割り当たっていないユーザー。カタログだけ返る確認用。
  const noRoom = await prisma.user.create({
    data: { email: `itest-mobile-gifts-noroom-${Date.now()}@local.test` },
  });
  noRoomUserId = noRoom.id;
  const noRoomStreamer = await prisma.streamer.create({
    data: { userId: noRoomUserId, tiktokId: `${TIKTOK_ID}_noroom`, verificationCode: "x" },
  });
  noRoomToken = signMobileToken({ userId: noRoomUserId, streamerId: noRoomStreamer.id });
});

afterAll(async () => {
  await prisma.tiktokGiftCatalog.deleteMany();
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: otherUserId } }).catch(() => {});
  await prisma.user.delete({ where: { id: noRoomUserId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> Gift
  await prisma.$disconnect();
});

let orderSeq = 0;

async function addGift(
  giftName: string,
  diamondCount: number,
  receivedAt: Date,
  giftPictureUrl?: string | null
) {
  orderSeq++;
  return prisma.gift.create({
    data: {
      roomId,
      uniqueId: "user_a",
      nickname: "ユーザーA",
      giftId: 1,
      giftName,
      giftPictureUrl: giftPictureUrl ?? null,
      repeatCount: 1,
      diamondCount,
      totalDiamonds: diamondCount,
      dayKey: "2026-08-20",
      orderId: `itest-mobile-gifts-${orderSeq}`,
      receivedAt,
    },
  });
}

async function addCatalog(
  giftId: number,
  label: string,
  diamondCount: number,
  imageUrl?: string | null
) {
  return prisma.tiktokGiftCatalog.create({
    data: {
      giftId,
      name: label.trim().toLowerCase(),
      label: label.trim(),
      diamondCount,
      imageUrl: imageUrl ?? null,
    },
  });
}

function request(bearer?: string) {
  return new NextRequest("http://localhost/api/mobile/gifts", {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

interface GiftCandidate {
  name: string;
  label: string;
  diamondCount: number;
  minDiamondCount: number;
  maxDiamondCount: number;
  seen: boolean;
  imageUrl: string | null;
}

async function fetchGifts(bearer?: string) {
  const res = await GET(request(bearer));
  const body = await res.json();
  return { status: res.status, body, gifts: (body.gifts ?? []) as GiftCandidate[] };
}

function names(gifts: GiftCandidate[]) {
  return gifts.map((g) => g.name);
}

function find(gifts: GiftCandidate[], name: string) {
  const hit = gifts.find((g) => g.name === name);
  if (!hit) throw new Error(`候補に ${name} が無い: ${names(gifts).join(", ")}`);
  return hit;
}

describe("GET /api/mobile/gifts — 受信履歴のみ", () => {
  it("トークンが無ければ401", async () => {
    const { status } = await fetchGifts();
    expect(status).toBe(401);
  });

  it("Streamer未登録なら404", async () => {
    const { status } = await fetchGifts(otherToken);
    expect(status).toBe(404);
  });

  it("ギフト履歴もカタログも無ければ空配列", async () => {
    const { status, gifts } = await fetchGifts(token);
    expect(status).toBe(200);
    expect(gifts).toEqual([]);
  });

  it("大文字小文字・前後空白の違いを1件に畳む", async () => {
    await addGift("Rose", 1, new Date("2026-08-20T10:00:00Z"));
    await addGift("rose", 1, new Date("2026-08-20T10:01:00Z"));
    await addGift("  Rose  ", 1, new Date("2026-08-20T10:02:00Z"));

    const { gifts } = await fetchGifts(token);
    expect(gifts).toHaveLength(1);
    expect(gifts[0].name).toBe("rose");
    expect(gifts[0].seen).toBe(true);
  });

  it("表示用ラベルは最新行の元表記を使う", async () => {
    // 直前のテストで最新は "  Rose  "(2026-08-20T10:02:00Z)。trimだけして返す。
    const { gifts } = await fetchGifts(token);
    expect(gifts[0].label).toBe("Rose");
  });

  it("複数種類を新しい順に返す", async () => {
    await addGift("Galaxy", 1000, new Date("2026-08-20T11:00:00Z"));

    const { gifts } = await fetchGifts(token);
    expect(names(gifts)).toEqual(["galaxy", "rose"]);
    expect(gifts[0].diamondCount).toBe(1000);
    expect(gifts[0].minDiamondCount).toBe(1000);
    expect(gifts[0].maxDiamondCount).toBe(1000);
  });

  it("空のギフト名は候補に出さない", async () => {
    await addGift("   ", 1, new Date("2026-08-20T12:00:00Z"));

    const { gifts } = await fetchGifts(token);
    expect(names(gifts)).toEqual(["galaxy", "rose"]);
  });

  it("GiftEditによるリネームは反映しない(TikTokが送る名前ではないため)", async () => {
    const gift = await addGift("TikTokName", 5, new Date("2026-08-20T13:00:00Z"));
    await prisma.giftEdit.create({
      data: { giftId: gift.id, streamerId, giftName: "手動でつけた名前", totalDiamonds: 5 },
    });

    const { gifts } = await fetchGifts(token);
    expect(names(gifts)).toContain("tiktokname");
    expect(names(gifts)).not.toContain("手動でつけた名前");
  });
});

describe("GET /api/mobile/gifts — カタログとの和集合", () => {
  beforeAll(async () => {
    // 前のブロックが積んだ履歴を消して、この節が使う分だけを入れ直す。
    await prisma.gift.deleteMany({ where: { roomId } });
    await prisma.tiktokGiftCatalog.deleteMany();

    // 受け取ったことがあるギフト。
    await addGift("Rose", 1, new Date("2026-08-20T10:00:00Z"));
    // カタログには無いが受け取ったことのあるギフト(部屋限定ギフト等)。
    await addGift("RoomOnly", 7, new Date("2026-08-20T10:05:00Z"));

    await addCatalog(5655, "Rose", 1);
    await addCatalog(11046, "Galaxy", 1000);
    // 実測どおり、同じ名前に複数のgiftIdが割り当たっているケース。
    await addCatalog(19441, "Freestyle", 1);
    await addCatalog(105795, "Freestyle", 1800);
  });

  it("受け取ったことのないギフトもカタログから候補に出る", async () => {
    const { gifts } = await fetchGifts(token);
    const galaxy = find(gifts, "galaxy");
    expect(galaxy.seen).toBe(false);
    expect(galaxy.label).toBe("Galaxy");
  });

  it("カタログと履歴の両方にあるギフトが2行にならない", async () => {
    const { gifts } = await fetchGifts(token);
    expect(names(gifts).filter((n) => n === "rose")).toHaveLength(1);
    expect(find(gifts, "rose").seen).toBe(true);
  });

  it("カタログに無い受信済みギフトも残る", async () => {
    const { gifts } = await fetchGifts(token);
    expect(find(gifts, "roomonly").seen).toBe(true);
  });

  it("同名で複数のカタログ行があるとき、コイン数を範囲に畳む", async () => {
    // `freestyle` は 1c と 1800c の両方が実在する。最大値だけを見せると
    // 「大物ギフト用」に仕込んだ音が1cでも鳴ってしまう。
    const { gifts } = await fetchGifts(token);
    const freestyle = find(gifts, "freestyle");
    expect(freestyle.minDiamondCount).toBe(1);
    expect(freestyle.maxDiamondCount).toBe(1800);
    // 旧クライアント互換の単一値は下限側。
    expect(freestyle.diamondCount).toBe(1);
  });

  it("同名複数行のラベルは最小giftIdの行から決定的に選ぶ", async () => {
    await addCatalog(9, "FREESTYLE", 1);
    const { gifts } = await fetchGifts(token);
    expect(find(gifts, "freestyle").label).toBe("FREESTYLE");
    await prisma.tiktokGiftCatalog.delete({ where: { giftId: 9 } });
  });

  it("ラベルは履歴側の表記を優先する", async () => {
    await addGift("ROSE!!", 1, new Date("2026-08-20T10:10:00Z"));
    const { gifts } = await fetchGifts(token);
    // 同じ一致キー("rose"ではない)にならないよう別名で入れたので、rose自体は変わらない。
    expect(find(gifts, "rose").label).toBe("Rose");

    await addGift("  rOsE  ", 1, new Date("2026-08-20T10:20:00Z"));
    const after = await fetchGifts(token);
    expect(find(after.gifts, "rose").label).toBe("rOsE");
  });

  it("実際に観測したコイン数も範囲に含める", async () => {
    // カタログでは1cのRoseを、実際には5cで受け取った場合。
    await addGift("Rose", 5, new Date("2026-08-20T10:30:00Z"));
    const { gifts } = await fetchGifts(token);
    const rose = find(gifts, "rose");
    expect(rose.minDiamondCount).toBe(1);
    expect(rose.maxDiamondCount).toBe(5);
  });

  it("受信済みを先頭に、その中は新しい順で並べる", async () => {
    const { gifts } = await fetchGifts(token);
    const seen = gifts.filter((g) => g.seen);
    const unseen = gifts.filter((g) => !g.seen);
    // 先頭が全部 seen になっている(境界より後ろに seen が無い)。
    expect(names(gifts).slice(0, seen.length)).toEqual(names(seen));
    // 未受信はコイン数の下限が小さい順。
    const mins = unseen.map((g) => g.minDiamondCount);
    expect([...mins].sort((a, b) => a - b)).toEqual(mins);
  });

  it("部屋が未割り当てでもカタログだけは返る", async () => {
    const { status, gifts } = await fetchGifts(noRoomToken);
    expect(status).toBe(200);
    expect(names(gifts)).toContain("galaxy");
    expect(gifts.every((g) => !g.seen)).toBe(true);
  });

  it("候補数に上限がある", async () => {
    await prisma.tiktokGiftCatalog.createMany({
      data: Array.from({ length: 1200 }, (_, i) => ({
        giftId: 500000 + i,
        name: `bulk${i}`,
        label: `Bulk${i}`,
        diamondCount: i + 1,
      })),
    });

    const { gifts } = await fetchGifts(token);
    expect(gifts).toHaveLength(1000);
    // 上限で切っても受信済みは必ず残る(集約とソートを終えてから切っているため)。
    expect(gifts.filter((g) => g.seen).length).toBeGreaterThan(0);

    await prisma.tiktokGiftCatalog.deleteMany({ where: { giftId: { gte: 500000 } } });
  });
});

// ピッカーに出すギフトのアイコン。カタログを優先し、無ければ受信履歴の giftPictureUrl。
// TikTokのギフト画像URLは avatar と違って署名(x-expires)が付かないので、履歴に残った
// 古いURLでも使える。ただしモバイルへ渡す以上、どちらの経路も検証を通したものだけ返す。
describe("GET /api/mobile/gifts — アイコン", () => {
  const IMAGE = "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/pic1.png~tplv-obj.webp";
  const IMAGE2 = "https://p19-webcast.tiktokcdn-us.com/img/maliva/pic2.png~tplv-obj.webp";

  it("カタログのアイコンを返す", async () => {
    await addCatalog(70001, "PicGift", 10, IMAGE);
    const { gifts } = await fetchGifts(token);
    expect(find(gifts, "picgift").imageUrl).toBe(IMAGE);
  });

  it("同名複数行では、画像を持つ行のうち最小giftIdを採る", async () => {
    // ラベルの代表(最小giftId=70010)が画像を持たないケース。取りこぼしてはいけない。
    await addCatalog(70010, "MultiPic", 10, null);
    await addCatalog(70012, "multipic", 20, IMAGE2);
    await addCatalog(70011, "MULTIPIC", 30, IMAGE);

    const { gifts } = await fetchGifts(token);
    const hit = find(gifts, "multipic");
    expect(hit.label).toBe("MultiPic"); // ラベルの規則は変わらない
    expect(hit.imageUrl).toBe(IMAGE); // 画像は 70011(画像を持つ行の最小giftId)
  });

  it("カタログに画像が無ければ受信履歴の giftPictureUrl を使う", async () => {
    await addGift("HistPic", 5, new Date("2026-08-20T13:00:00Z"), IMAGE);
    const { gifts } = await fetchGifts(token);
    expect(find(gifts, "histpic").imageUrl).toBe(IMAGE);
  });

  it("カタログの画像が履歴より優先される", async () => {
    await addCatalog(70020, "BothPic", 10, IMAGE);
    await addGift("BothPic", 10, new Date("2026-08-20T13:10:00Z"), IMAGE2);
    const { gifts } = await fetchGifts(token);
    expect(find(gifts, "bothpic").imageUrl).toBe(IMAGE);
  });

  it("履歴の最新行に画像が無くても、少し前の行から拾う", async () => {
    await addGift("OldPic", 5, new Date("2026-08-20T13:20:00Z"), IMAGE);
    await addGift("OldPic", 5, new Date("2026-08-20T13:30:00Z"), null); // こちらが代表行
    const { gifts } = await fetchGifts(token);
    expect(find(gifts, "oldpic").imageUrl).toBe(IMAGE);
  });

  it("検証を通らないURLは返さない(過去に保存された値も遮断する)", async () => {
    await addCatalog(70030, "BadCatalogPic", 10, "https://evil.example/a.png");
    await addGift("BadHistPic", 5, new Date("2026-08-20T13:40:00Z"), "javascript:alert(1)");

    const { gifts } = await fetchGifts(token);
    expect(find(gifts, "badcatalogpic").imageUrl).toBeNull();
    expect(find(gifts, "badhistpic").imageUrl).toBeNull();
  });

  it("画像が無ければ null(候補自体は消えない)", async () => {
    await addCatalog(70040, "NoPic", 10);
    const { gifts } = await fetchGifts(token);
    expect(find(gifts, "nopic").imageUrl).toBeNull();
  });
});
