"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import GoogleIcon from "@/app/GoogleIcon";

const DEV_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "1";

// middleware が未ログインのリクエストを弾くとき、元のURLを callbackUrl に載せて
// ここへ飛ばしてくる。それを読まずに "/" 固定で戻していたため、深いURLを直接開くと
// ログイン後に必ずトップへ流されていた。オープンリダイレクトを避けるため、
// 同一オリジンの相対パスだけを受け入れる。
function useSafeCallbackUrl(): string {
  const raw = useSearchParams().get("callbackUrl");
  if (!raw) return "/";
  try {
    // 絶対URLで来た場合も、パス部分だけを取り出して同一オリジンに閉じる。
    const url = new URL(raw, "http://localhost");
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return "/";
  }
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [devEmail, setDevEmail] = useState("dev@local.test");
  const callbackUrl = useSafeCallbackUrl();

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="flex items-baseline justify-center gap-2 leading-tight">
            <span className="text-2xl font-bold text-brand">LIVE Sidestage</span>
            <span className="text-base font-medium text-gray-400">Analytics</span>
          </h1>
          <p className="text-gray-400 text-sm mt-1">TikTok Live ギフト解析</p>
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
