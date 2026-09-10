/// Sign in with Apple - Web 版の設定ラッパー。
///
/// モバイル向けの `apple-auth.ts` を変更せず、Web（NextAuth）が必要とする設定と
/// client_secret の長寿命TTLを提供する。

import { createHmac } from "crypto";
import jwt from "jsonwebtoken";
import type { AppleConfig } from "./apple-auth";
import { appleConfig } from "./apple-auth";

/// Web 版の Apple Config。モバイル版と異なるのは `redirectUri` だけ。
/// NextAuthは配信者側なら `${NEXTAUTH_URL}/api/auth/callback/apple`、
/// 事務所側なら `${NEXTAUTH_URL}/api/auth/callback/<apple-agency-id>` を使う。
export function webAppleConfig(): AppleConfig | null {
  const config = appleConfig();
  if (!config) return null;

  const webRedirectUri = process.env.APPLE_WEB_REDIRECT_URI?.trim();
  if (!webRedirectUri) return null;

  return {
    ...config,
    redirectUri: webRedirectUri,
  };
}

/// Web 版 client_secret 生成。モバイル版の `buildClientSecret()` は TTL 5分（再利用想定）だが、
/// NextAuthは `authOptions` をモジュールロード時に1回だけ構築する場合、5分後から Apple token交換が全滅する。
///
/// 対応方針:
/// - TTLを長め（90日程度。Apple上限6ヶ月未満）にして、モジュール内のキャッシュに耐える
/// - 既存モバイル向け `buildClientSecret()` は シグネチャも挙動も変更しない（参照のみ）
/// - NextAuthの`clientSecret`生成のたびに新しいsecretを返すため、呼び出し側で判定して利用する
export function buildWebClientSecret(config: AppleConfig, clientId: string): string {
  const now = Math.floor(Date.now() / 1000);
  // 90日のTTL（秒単位）。Appleの上限6ヶ月より手前。
  const ttlSeconds = 90 * 24 * 60 * 60;

  return jwt.sign(
    {
      iss: config.teamId,
      iat: now,
      exp: now + ttlSeconds,
      aud: "https://appleid.apple.com",
      sub: clientId,
    },
    config.privateKey,
    { algorithm: "ES256", keyid: config.keyId },
  );
}
