import { issueRefreshToken, signMobileToken } from "./mobile-auth";

/// モバイル認証(Google / Apple)のレスポンス整形と JWT 発行。
///
/// **共通化するのはここだけ**。ユーザーの解決ロジックはプロバイダごとに
/// 前提が違う（Apple はメールが無いことがある・private relay がある・
/// 氏名は初回しか来ない・silent 再認証ができない）ので無理に1本化しない。

export interface MobileAuthStreamer {
  id: string;
  tiktokHandle: string;
  verified: boolean;
}

export interface MobileAuthUser {
  id: string;
  name: string | null;
  email: string | null;
  streamer: MobileAuthStreamer | null;
}

/// Flutter の `AuthSession.fromJson` が読む形。**プロバイダによらず同じ形にする**
/// （端末側はどちらのエンドポイントを叩いたか知っているので provider は返さない）。
///
/// `token`(access token)は1時間で切れるので、端末は同時に受け取る `refreshToken` で
/// 無言再発行する（`POST /api/mobile/auth/refresh`）。**refresh token の発行は DB 書き込みを
/// 伴うため、この関数は非同期**（呼び出し元は `await` すること）。
export async function mobileAuthResponseBody(user: MobileAuthUser) {
  const refreshToken = await issueRefreshToken({
    principalId: user.id,
    // 発行時点の参考情報。再発行時のクレームには使わず、毎回 DB から引き直す。
    streamerId: user.streamer?.id ?? null,
  });

  return {
    token: signMobileToken({ principalId: user.id, streamerId: user.streamer?.id }),
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email },
    streamer: user.streamer
      ? {
          id: user.streamer.id,
          tiktokHandle: user.streamer.tiktokHandle,
          verified: user.streamer.verified,
        }
      : null,
    onboardingRequired: !user.streamer,
  };
}
