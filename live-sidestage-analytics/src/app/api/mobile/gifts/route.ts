import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveUserByMobileToken } from "@/lib/mobile-auth";

// モバイルの「ギフトを選ぶ」ピッカーへ返す候補一覧。
//
// 全期間の厳密なカタログではなく、**直近に実際に受け取ったギフトの候補**を返す。
// TikTokのギフト一覧APIは持っていないので、自分の部屋の受信履歴が唯一の情報源になる。
// 一覧に無いギフトはクライアント側の自由入力で登録できる。

// 走査するGift行数の上限。[roomId, receivedAt] インデックスで新しい順に取る。
const MAX_SCAN_ROWS = 5000;
// 返すギフト種類数の上限。
const MAX_KINDS = 200;

export async function GET(req: NextRequest) {
  const auth = resolveUserByMobileToken(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  // JWTのstreamerIdは信用せず、userIdから現在のStreamerを引く。
  // リクエストからroomIdを受け取らないので、他人の部屋は参照できない。
  const streamer = await prisma.streamer.findUnique({
    where: { userId: auth.userId },
    select: { roomId: true },
  });
  if (!streamer) {
    return NextResponse.json({ error: "TikTokアカウントが未登録です" }, { status: 404 });
  }
  if (!streamer.roomId) {
    // まだWorkerが部屋を割り当てていない。候補は空でよい(エラーではない)。
    return NextResponse.json({ gifts: [] });
  }

  // Prismaの `distinct` はこのリポジトリでは nativeDistinct を有効にしていないため
  // SQL DISTINCT にならず、SELECT後にメモリ上で重複排除される。
  // 素朴に使うと全期間を引いてしまうので、新しい順に上限件数だけ取って
  // ここで正規化・重複排除する。
  const rows = await prisma.gift.findMany({
    where: { roomId: streamer.roomId },
    select: { giftName: true, diamondCount: true },
    orderBy: { receivedAt: "desc" },
    take: MAX_SCAN_ROWS,
  });

  // DBには元の大文字小文字のまま保存されているが、socket.ioの `chat:gift` は
  // trim + 小文字化して配信している。効果音の一致キーは後者なので、
  // 正規化した name をキーに畳み、表示用の label には最新行の元表記を残す。
  //
  // GiftEdit によるギフト名の手動リネームは**適用しない**。あれは表示・集計用の
  // 上書きであって、TikTokが実際に送ってくる名前ではないため、一致キーにならない。
  const byName = new Map<string, { name: string; label: string; diamondCount: number }>();
  for (const row of rows) {
    const label = row.giftName ?? "";
    const name = label.trim().toLowerCase();
    if (!name) continue;
    if (byName.has(name)) continue; // 最初に見つかった = 最新行を代表にする
    byName.set(name, { name, label: label.trim(), diamondCount: row.diamondCount });
    if (byName.size >= MAX_KINDS) break;
  }

  return NextResponse.json({ gifts: Array.from(byName.values()) });
}
