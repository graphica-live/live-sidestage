import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveUserByMobileToken } from "@/lib/mobile-auth";
import { isAllowedAvatarUrl } from "@/lib/tiktok-profile";

// モバイルの「ギフトを選ぶ」ピッカーへ返す候補一覧。
//
// 情報源は2つで、**和集合**を返す。
//  1. TikTokの全ギフトカタログ(`public."tiktok_gift_catalog"`。worker が gift/list/ から取る)
//  2. 自分の部屋が最近受け取ったギフトの履歴(`public."gifts"` の直近 MAX_SCAN_ROWS 行)
//
// どちらか片方が欠けても動く。カタログ未取得なら履歴だけ、部屋が未割り当てならカタログだけ返る。
// カタログも網羅ではない(部屋限定ギフト・新ギフト)ので、一覧に無い名前はクライアント側の
// 自由入力で登録できる導線を残してある。
//
// ピッカーに出すアイコン(`imageUrl`)は**カタログを優先し、無ければ受信履歴の `giftPictureUrl`**。
// TikTokのギフト画像URLは avatar と違って署名(x-expires)が付かないので、履歴に保存された
// 古いURLでも腐らない。どちらの経路も `isAllowedAvatarUrl()` を通したものだけ返す。
//
// **畳む単位はギフト名。** 効果音の一致キーが名前だから(socket.ioの `chat:gift` は
// `giftName` を trim + 小文字化して配信し、モバイルはそれと `GiftSound.giftName` を比較する)。
// gift/list/ は同じ名前に複数の giftId を割り当てているので、giftId で畳むと
// ピッカーに区別のつかない同名行が並ぶ。

// 走査するGift行数の上限。[roomId, receivedAt] インデックスで新しい順に取る。
const MAX_SCAN_ROWS = 5000;
// 返す候補数の上限。実測のカタログは670件なので、全件+履歴が収まる。
const MAX_CANDIDATES = 1000;

interface Candidate {
  name: string;
  label: string;
  minDiamondCount: number;
  maxDiamondCount: number;
  seen: boolean;
  // 履歴での新しさ(小さいほど新しい)。並べ替えにだけ使い、レスポンスには含めない。
  seenRank: number;
  // カタログ側で代表に選んだ行のgiftId。同名複数行のlabelを決定的に選ぶためだけに使う。
  catalogGiftId: number;
  // ピッカーに出すアイコン。取れなければ null。
  imageUrl: string | null;
  // 画像の採用元にした行のgiftId。**labelの代表(最小giftId)とは別に持つ** —
  // 最小giftIdの行が画像を持たないとき、同名の別行にある画像を取りこぼさないため。
  imageGiftId: number;
  // TikTok公式の日本語表示名。カタログにしか無いので、履歴由来だけの候補では null。
  labelJa: string | null;
  // 日本語名の採用元にした行のgiftId。画像と同じ理由で label の代表とは別に持つ。
  labelJaGiftId: number;
}

function widen(candidate: Candidate, coins: number) {
  candidate.minDiamondCount = Math.min(candidate.minDiamondCount, coins);
  candidate.maxDiamondCount = Math.max(candidate.maxDiamondCount, coins);
}

// 履歴由来の画像に与える順位。**どのカタログ行の giftId よりも大きい**ので、
// カタログに画像があればそちらが勝ち、無いときだけ履歴が入る。履歴同士では
// 先に来た行(=受信の新しい行)が勝つ。
const HISTORY_IMAGE_RANK = Number.MAX_SAFE_INTEGER - 1;

// 画像URLの採否。**「画像を持つ行のうち最小giftId」**を採る。
// 非nullを優先するのはカバレッジを落とさないため、その中で最小giftIdなのは決定的にするため。
//
// **検証はここで行う。** カタログは書き込み時にも検証しているが、モバイルへ渡るURLが
// 「必ずこのプロセスで検証済み」と1箇所で言えるようにするため、履歴由来と揃えて通す。
function adoptImage(candidate: Candidate, url: unknown, giftId: number) {
  if (!isAllowedAvatarUrl(url) || giftId >= candidate.imageGiftId) return;
  candidate.imageUrl = url;
  candidate.imageGiftId = giftId;
}

// 日本語名の採否。画像と同じく**「日本語名を持つ行のうち最小giftId」**を採る。
//
// **単純な「最小giftIdの行のlabelJa」にしない。** 同じ英語名に複数のgiftIdがあり、かつ
// 日本語名が枝分かれするケースが実測で8件ある(`zeus` → 「ゼウス」/「覇王ゼウス」など)。
// 最小giftIdの行がまだ日本語化されていないと、同名の別行にある訳を取りこぼす。
function adoptLabelJa(candidate: Candidate, labelJa: string | null, giftId: number) {
  if (!labelJa || giftId >= candidate.labelJaGiftId) return;
  candidate.labelJa = labelJa;
  candidate.labelJaGiftId = giftId;
}

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

  const [catalogRows, historyRows] = await Promise.all([
    prisma.tiktokGiftCatalog.findMany({
      select: {
        giftId: true,
        name: true,
        label: true,
        labelJa: true,
        diamondCount: true,
        imageUrl: true,
      },
    }),
    // 部屋が未割り当てならまだ1件も受け取っていない。カタログだけで返す。
    //
    // Prismaの `distinct` はこのリポジトリでは nativeDistinct を有効にしていないため
    // SQL DISTINCT にならず、SELECT後にメモリ上で重複排除される。素朴に使うと全期間を
    // 引いてしまうので、新しい順に上限件数だけ取ってここで正規化・重複排除する。
    streamer.roomId
      ? prisma.gift.findMany({
          where: { roomId: streamer.roomId },
          select: { giftName: true, diamondCount: true, giftPictureUrl: true },
          orderBy: { receivedAt: "desc" },
          take: MAX_SCAN_ROWS,
        })
      : Promise.resolve([]),
  ]);

  const byName = new Map<string, Candidate>();

  // --- カタログ ---
  // 同じ名前に複数行あるとき(実測638ユニーク名 / 670行)は、コイン数を範囲へ畳む。
  // **最大値だけを1つの価格として見せない。** `freestyle` は 1c と 1800c の両方が存在し、
  // 1800cとして出すと「大物ギフト用」に仕込んだ音が1cでも鳴る。
  // labelは最小giftIdの行を採る(どれを選んでも表示は同じだが、決定的にするため)。
  for (const row of catalogRows) {
    const name = row.name;
    if (!name) continue;
    const existing = byName.get(name);
    if (!existing) {
      const created: Candidate = {
        name,
        label: row.label || name,
        minDiamondCount: row.diamondCount,
        maxDiamondCount: row.diamondCount,
        seen: false,
        seenRank: Number.MAX_SAFE_INTEGER,
        catalogGiftId: row.giftId,
        imageUrl: null,
        imageGiftId: Number.MAX_SAFE_INTEGER,
        labelJa: null,
        labelJaGiftId: Number.MAX_SAFE_INTEGER,
      };
      adoptImage(created, row.imageUrl, row.giftId);
      adoptLabelJa(created, row.labelJa, row.giftId);
      byName.set(name, created);
      continue;
    }
    widen(existing, row.diamondCount);
    adoptImage(existing, row.imageUrl, row.giftId);
    adoptLabelJa(existing, row.labelJa, row.giftId);
    if (row.giftId < existing.catalogGiftId) {
      existing.catalogGiftId = row.giftId;
      existing.label = row.label || existing.label;
    }
  }

  // --- 受信履歴 ---
  // DBには元の大文字小文字のまま保存されているので、一致キーへ正規化してから畳む。
  // 最初に見つかった行 = 最新行を代表にする。
  //
  // labelは**履歴側を優先**する。カタログのロケール表記より、実際に飛んできた表記の方が
  // ユーザーの見慣れたものに近い。
  //
  // GiftEdit によるギフト名の手動リネームは**適用しない**。あれは表示・集計用の
  // 上書きであって、TikTokが実際に送ってくる名前ではないため、一致キーにならない。
  let seenRank = 0;
  for (const row of historyRows) {
    const label = (row.giftName ?? "").trim();
    const name = label.toLowerCase();
    if (!name) continue;

    const existing = byName.get(name);
    if (existing?.seen) {
      // 代表は決まっているが、**画像だけは拾い続ける**。代表になった最新行の
      // giftPictureUrl が null でも、少し前の行が持っていることがある。
      adoptImage(existing, row.giftPictureUrl, HISTORY_IMAGE_RANK);
      continue;
    }

    if (!existing) {
      const created: Candidate = {
        name,
        label,
        minDiamondCount: row.diamondCount,
        maxDiamondCount: row.diamondCount,
        seen: true,
        seenRank: seenRank++,
        catalogGiftId: Number.MAX_SAFE_INTEGER,
        imageUrl: null,
        imageGiftId: Number.MAX_SAFE_INTEGER,
        // 日本語名の供給元はカタログだけ。履歴にしか無いギフト(部屋固有のサブスクギフト、
        // カタログから消えた旧ギフト)は null のまま = クライアントは元表記を出す。
        labelJa: null,
        labelJaGiftId: Number.MAX_SAFE_INTEGER,
      };
      adoptImage(created, row.giftPictureUrl, HISTORY_IMAGE_RANK);
      byName.set(name, created);
      continue;
    }

    adoptImage(existing, row.giftPictureUrl, HISTORY_IMAGE_RANK);
    existing.label = label || existing.label;
    existing.seen = true;
    existing.seenRank = seenRank++;
    // 実際に観測した値も範囲へ含める(カタログに無い価格で飛んでくることがある)。
    widen(existing, row.diamondCount);
  }

  // 受け取ったことのあるギフトを先頭へ(その中は受信の新しい順)。
  // 残りはコイン数の下限が小さい順、同値は名前順で決定的に並べる。
  // **集約が全部終わってから並べて切る。** 先に切ると同名の別行を取りこぼす。
  const gifts = Array.from(byName.values())
    .sort((a, b) => {
      if (a.seen !== b.seen) return a.seen ? -1 : 1;
      if (a.seen && b.seen) return a.seenRank - b.seenRank;
      if (a.minDiamondCount !== b.minDiamondCount) return a.minDiamondCount - b.minDiamondCount;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    })
    .slice(0, MAX_CANDIDATES)
    .map((c) => ({
      name: c.name,
      label: c.label,
      // TikTok公式の日本語表示名。クライアントは「labelJa があればそれ、無ければ label」で描く。
      // **一致キーは name のまま**なので、ここが日本語でも効果音の照合には影響しない。
      labelJa: c.labelJa,
      // 旧クライアント互換。min/maxを知らないクライアントには下限を1つの価格として見せる
      // (上限を見せると「大物ギフト」と誤解させるため)。
      diamondCount: c.minDiamondCount,
      minDiamondCount: c.minDiamondCount,
      maxDiamondCount: c.maxDiamondCount,
      seen: c.seen,
      imageUrl: c.imageUrl,
    }));

  return NextResponse.json({ gifts });
}
