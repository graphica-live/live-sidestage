"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import GoogleIcon from "@/app/GoogleIcon";
import { clampCallbackUrl, safeCallbackUrl } from "@/lib/callback-url";

const DEV_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "1";

export interface GoogleLoginPanelProps {
  /** ブランド名に添える副題。analytics は "Analytics"、イベントは "Event"。 */
  brandSuffix: string;
  tagline: string;
  /** callbackUrl が無い/弾かれたときの戻り先。 */
  defaultCallbackUrl: string;
  /**
   * 戻り先をこのサブツリーへ閉じ込める。イベント側のログインが
   * `?callbackUrl=/analytics` で別サービスへ着地するのを防ぐ。
   * analytics 側は旧ブックマーク(`/login?callbackUrl=/events`)互換のため渡さない。
   */
  restrictPrefix?: string;
  /**
   * safeCallbackUrl() の同一オリジン判定に使う基準origin。呼び出し元のServer
   * Componentがそのページの正規ホスト(ANALYTICS_ORIGIN/EVENTS_ORIGIN)を渡す。
   * サブドメイン化前と違い window.location.origin は使わない — 絶対URL/
   * プロトコル相対URLを別オリジンとして弾く判定ロジックは基準originが固定値でも変わらない。
   */
  origin: string;
}

// analytics とイベントで同じ Google ログインを使う。ブランド表記と戻り先だけが違う。
// useSearchParams はクライアント側でしか解決できないので Suspense 境界が要る。
export default function GoogleLoginPanel(props: GoogleLoginPanelProps) {
  return (
    <Suspense fallback={null}>
      <LoginForm {...props} />
    </Suspense>
  );
}

function LoginForm({ brandSuffix, tagline, defaultCallbackUrl, restrictPrefix, origin }: GoogleLoginPanelProps) {
  const [devEmail, setDevEmail] = useState("dev@local.test");
  const searchParams = useSearchParams();
  // middleware が未ログインのリクエストを弾くとき、元のURLを callbackUrl に載せて
  // ここへ飛ばしてくる。それを読まずに "/" 固定で戻していたため、イベント管理画面から
  // 飛ばされたユーザーがログイン後 analytics へ流れていた。
  // オープンリダイレクトを避けるため safeCallbackUrl() を通す。
  const raw = safeCallbackUrl(searchParams.get("callbackUrl"), origin, defaultCallbackUrl);
  const callbackUrl = restrictPrefix
    ? clampCallbackUrl(raw, restrictPrefix, defaultCallbackUrl)
    : raw;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="flex items-baseline justify-center gap-2 leading-tight">
            <span className="text-2xl font-bold text-brand">LIVE Sidestage</span>
            <span className="text-base font-medium text-gray-400">{brandSuffix}</span>
          </h1>
          <p className="text-gray-400 text-sm mt-1">{tagline}</p>
        </div>

        <div className="card">
          <button
            onClick={() => signIn("google", { callbackUrl })}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-border rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          >
            <GoogleIcon />
            Googleでログイン
          </button>
        </div>

        {DEV_LOGIN_ENABLED && (
          <div className="card mt-4 border-dashed">
            <p className="text-xs text-gray-500 mb-2">開発用ログイン(ローカルテスト環境専用)</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                signIn("dev-login", { email: devEmail, callbackUrl });
              }}
              className="flex gap-2"
            >
              <input
                type="email"
                value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
                className="input-field text-sm flex-1"
                placeholder="dev@local.test"
              />
              <button
                type="submit"
                className="bg-brand text-white rounded-lg px-3 text-sm font-medium hover:opacity-90"
              >
                ログイン
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
