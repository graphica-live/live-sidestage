"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SessionProvider, signIn } from "next-auth/react";
import GoogleIcon from "@/app/GoogleIcon";
import { AGENCY_AUTH_BASE_PATH, AGENCY_GOOGLE_PROVIDER_ID } from "@/lib/agency/session-cookie";

const DEV_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "1";

// 事務所用のログイン。signIn() は SessionProvider の basePath を見て
// リクエスト先を決めるため、配信者側(/api/auth)ではなく事務所側の
// エンドポイントへ向けるにはこのProviderで包む必要がある。
export default function AgencyLoginClient() {
  return (
    <SessionProvider basePath={AGENCY_AUTH_BASE_PATH}>
      <Suspense fallback={null}>
        <AgencyLoginForm />
      </Suspense>
    </SessionProvider>
  );
}

// 事務所ページ配下だけを戻り先として許可する。他のパスを渡されても /agency に落とす。
function useAgencyCallbackUrl(): string {
  const raw = useSearchParams().get("callbackUrl");
  if (!raw) return "/agency";
  try {
    const url = new URL(raw, "http://localhost");
    const path = `${url.pathname}${url.search}`;
    if (!url.pathname.startsWith("/agency") || url.pathname.startsWith("/agency/login")) {
      return "/agency";
    }
    return path;
  } catch {
    return "/agency";
  }
}

function AgencyLoginForm() {
  const params = useSearchParams();
  const callbackUrl = useAgencyCallbackUrl();
  const [devEmail, setDevEmail] = useState("agency@local.test");

  // 未登録アカウントはログイン自体は通り、コンソール側で「事務所情報が見つかりません」を出す
  // (理由は agencyAuthOptions の callbacks コメント参照)。ここに出るのは通信エラー等。
  const error = params.get("error");
  const deniedMessage = error
    ? "ログインに失敗しました。時間をおいてもう一度お試しください。"
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="flex items-baseline justify-center gap-2 leading-tight">
            <span className="text-2xl font-bold text-brand">LIVE Sidestage</span>
            <span className="text-base font-medium text-gray-400">事務所コンソール</span>
          </h1>
          <p className="text-gray-400 text-sm mt-1">監視対象ライバーの管理と企業向けAPI</p>
        </div>

        {deniedMessage && (
          <div className="card mb-4 border-red-900/60 bg-red-500/5">
            <p className="text-sm text-red-400">{deniedMessage}</p>
          </div>
        )}

        <div className="card">
          <button
            onClick={() => signIn(AGENCY_GOOGLE_PROVIDER_ID, { callbackUrl })}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-border rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          >
            <GoogleIcon />
            Googleでログイン
          </button>
          <p className="text-xs text-gray-500 mt-3">
            運営に登録してもらったGoogleアカウントでログインしてください。
            配信者向けのログインとは別で、どちらか一方のログアウトがもう一方に影響することはありません。
          </p>
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
                placeholder="agency@local.test"
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
