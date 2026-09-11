// 平文・無期限の公開シェアトークン生成。`Streamer.overlayToken` / `BattleHistory.shareToken` /
// `ContributionShareToken.token` の3箇所が同じ方式(crypto.randomBytes(24)、192bit)を使うため
// ここへ切り出す。cuid 等の推測可能な識別子は使わない。

import crypto from "crypto";

export function generateShareToken(): string {
  return crypto.randomBytes(24).toString("hex");
}
