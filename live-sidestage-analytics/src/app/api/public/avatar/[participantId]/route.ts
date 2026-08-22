import { NextResponse } from "next/server";
import { findPublicParticipantTiktokId } from "@/event/public-event";
import { avatarCache } from "@/lib/tiktok-avatar";

// 参加者のアイコンを返す。認証なし(middleware の matcher が api/public を除外している)。
//
// **画像そのものは中継せず、TikTok の CDN へ 302 で送る。** 帯域を使わずに済み、
// 2回目以降はブラウザが CDN から直接取る。URL は署名付きで約47時間で失効するので、
// リダイレクト自体のキャッシュはそれより十分短くする。
//
// **取れなかった場合も 404 ではなくプレースホルダ画像(200)を返す。** これで呼び出し側は
// 常に <img> を1つ置くだけでよく、読み込み失敗時のフォールバックを持たなくて済む。
//
// 参加者IDから TikTok ハンドルへの解決は、公開してよいイベントに属するものだけに限る
// (DRAFT / PRIVATE のイベントの参加者を、IDを推測して引き当てられないように)。

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** cuid。桁数だけ緩く見て、明らかにIDでないものでDBを引かない。 */
const MAX_ID_LENGTH = 64;

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" role="img" aria-label=""><circle cx="24" cy="24" r="24" fill="#1a1a1a"/><circle cx="24" cy="19" r="7.5" fill="#3a3a3a"/><path d="M8.5 48a15.5 15.5 0 0 1 31 0z" fill="#3a3a3a"/></svg>`;

/**
 * アイコンが無いときの代替。
 *
 * `maxAge` は「次にいつ引き直させるか」。参加者が存在しない(URLの打ち間違い、
 * 削除済み)なら長め、取得に失敗しただけなら短くしてすぐ回復させる。
 */
function placeholder(maxAge: number): NextResponse {
  return new NextResponse(PLACEHOLDER_SVG, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
      // 自前の固定文字列だが、SVG は同一オリジンで開かれうるので何も読み込ませない。
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: { participantId: string } }
): Promise<NextResponse> {
  const participantId = params.participantId;
  if (!participantId || participantId.length > MAX_ID_LENGTH) return placeholder(3600);

  const tiktokId = await findPublicParticipantTiktokId(participantId);
  if (!tiktokId) return placeholder(3600);

  const url = await avatarCache.get(tiktokId);
  if (!url) return placeholder(300);

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: url,
      // 署名の有効期限(約47時間)より十分短く。ブラウザにリダイレクトを持たせすぎない。
      "Cache-Control": "public, max-age=3600",
    },
  });
}
