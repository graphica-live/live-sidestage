// overlayToken の発行と解決。**サーバー専用**(crypto と prisma を引く)。
// クライアントからは絶対に import しないこと。

import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export function generateOverlayToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export async function resolveStreamerIdByOverlayToken(
  token: string | null | undefined
): Promise<string | null> {
  if (!token) return null;

  // verified未完了でもオーバーレイは即時利用可能にする(コイン数/ギフト履歴の表示制限とは別軸)。
  const streamer = await prisma.streamer.findUnique({
    where: { overlayToken: token },
    select: { id: true },
  });

  return streamer?.id ?? null;
}

// overlayToken の遅延発行。**未発行(null)のときだけ書き込む updateMany で競合を防ぐ。**
// 単純な findUnique -> update だと、初回に2タブが同時に開いた場合に別トークンが2つ生成され、
// DB に残らなかった側のタブが「無効な OBS URL」を表示してしまう(コピーしても何も映らない)。
// 書き込みが自分でなかった場合は、先に書かれた方を読み直して返す。
export async function ensureOverlayToken(streamerId: string): Promise<string | null> {
  const generated = generateOverlayToken();
  await prisma.streamer.updateMany({
    where: { id: streamerId, overlayToken: null },
    data: { overlayToken: generated },
  });

  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: { overlayToken: true },
  });

  return streamer?.overlayToken ?? null;
}
