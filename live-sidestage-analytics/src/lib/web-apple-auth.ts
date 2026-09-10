/// Sign in with Apple - Web 版の設定ラッパー。
///
/// モバイル向けの `apple-auth.ts` を変更せず、Web（NextAuth）が必要とする設定と
/// client_secret の長寿命TTLを提供する。

import { createHmac } from "crypto";
import jwt from "jsonwebtoken";
import type { AppleConfig } from "./apple-auth";
import { appleConfig } from "./apple-auth";

/// Web 版の Apple Config。`redirectUri` を持たない（NextAuthの `AppleProvider({...})`
/// へは渡さないため、渡っても無視される値をここで作らない）。
/// 実際にAppleへ送る `redirect_uri` はNextAuthが `providerId` から自動生成する
/// （配信者側は `${NEXTAUTH_URL}/api/auth/callback/apple`、
/// 事務所側は `${NEXTAUTH_URL}/api/auth/callback/apple-agency`）。
/// `APPLE_WEB_REDIRECT_URI` はこの関数では「Web版Apple Sign inの設定が完了しているか」を
/// 判定する feature flag の追加条件としてのみ使い、値の中身は返り値に含めない。
export type WebAppleConfig = Omit<AppleConfig, "redirectUri">;

export function webAppleConfig(): WebAppleConfig | null {
  const config = appleConfig();
  if (!config) return null;

  const webRedirectUri = process.env.APPLE_WEB_REDIRECT_URI?.trim();
  if (!webRedirectUri) return null;

  const { redirectUri, ...rest } = config;
  return rest;
}

/// Web 版 client_secret 生成。モバイル版の `buildClientSecret()` は TTL 5分（再利用想定）だが、
/// NextAuthは `authOptions` をモジュールロード時に1回だけ構築する場合、5分後から Apple token交換が全滅する。
///
/// 対応方針:
/// - TTLを長め（90日程度。Apple上限6ヶ月未満）にして、モジュール内のキャッシュに耐える
/// - 既存モバイル向け `buildClientSecret()` は シグネチャも挙動も変更しない（参照のみ）
/// - NextAuthの`clientSecret`生成のたびに新しいsecretを返すため、呼び出し側で判定して利用する
export function buildWebClientSecret(config: WebAppleConfig, clientId: string): string {
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
