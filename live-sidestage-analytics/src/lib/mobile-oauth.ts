import { signMobileToken } from "./mobile-auth";

/// モバイル認証(Google / Apple)のレスポンス整形と JWT 発行。
///
/// **共通化するのはここだけ**。ユーザーの解決ロジックはプロバイダごとに
/// 前提が違う（Apple はメールが無いことがある・private relay がある・
/// 氏名は初回しか来ない・silent 再認証ができない）ので無理に1本化しない。

export interface MobileAuthStreamer {
  id: string;
  tiktokId: string;
  verified: boolean;
  /// スキーマ上は nullable。従来からそのまま返しているので形は変えない
  /// （端末側は非 null 前提で読むが、apiKey は Streamer 作成時に必ず入る）。
  apiKey: string | null;
}

export interface MobileAuthUser {
  id: string;
  name: string | null;
  email: string | null;
  streamer: MobileAuthStreamer | null;
}

/// Flutter の `AuthSession.fromJson` が読む形。**プロバイダによらず同じ形にする**
/// （端末側はどちらのエンドポイントを叩いたか知っているので provider は返さない）。
export function mobileAuthResponseBody(user: MobileAuthUser) {
  return {
    token: signMobileToken({ userId: user.id, streamerId: user.streamer?.id }),
    user: { id: user.id, name: user.name, email: user.email },
    streamer: user.streamer
      ? {
          id: user.streamer.id,
          tiktokId: user.streamer.tiktokId,
          verified: user.streamer.verified,
          apiKey: user.streamer.apiKey,
        }
      : null,
    onboardingRequired: !user.streamer,
  };
}
