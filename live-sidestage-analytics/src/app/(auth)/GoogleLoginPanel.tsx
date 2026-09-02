"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
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
  /**
   * "split": 左に実績訴求パネルを持つ分割レイアウト(採用comp、analytics専用)。
   * "minimal": 既存の中央カードレイアウト(event/agency側はこちら)。既定。
   */
  variant?: "minimal" | "split";
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

interface LoginStats {
  streamerCount: number;
  contributorCount: number;
  giftCount: number;
  battleCount: number;
}

function useLoginStats(enabled: boolean) {
  const [stats, setStats] = useState<LoginStats | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/public/login-stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setStats(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return stats;
}

function GoogleButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-center gap-2.5 bg-bg hover:bg-row-hover border border-border rounded-field px-4 py-[11px] text-[.88rem] font-semibold text-strong transition-colors"
    >
      <GoogleIcon />
      Googleでログイン
    </button>
  );
}

function DevLoginForm({
  devEmail,
  setDevEmail,
  callbackUrl,
}: {
  devEmail: string;
  setDevEmail: (v: string) => void;
  callbackUrl: string;
}) {
  return (
    <div className="card mt-4 border-dashed">
      <p className="text-xs text-muted mb-2">開発用ログイン(ローカルテスト環境専用)</p>
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
          className="bg-brand text-on-accent rounded-lg px-3 text-sm font-medium hover:bg-brand-hover"
        >
          ログイン
        </button>
      </form>
    </div>
  );
}

function FooterConsent() {
  return (
    <p className="mt-[14px] text-[.72rem] text-muted text-center">
      続行することで
      <Link href="/terms" target="_blank" className="text-brand hover:underline">
        利用規約
      </Link>
      と
      <Link href="/privacy" target="_blank" className="text-brand hover:underline">
        プライバシーポリシー
      </Link>
      に同意したものとみなされます
    </p>
  );
}

function LoginForm({
  brandSuffix,
  tagline,
  defaultCallbackUrl,
  restrictPrefix,
  origin,
  variant = "minimal",
}: GoogleLoginPanelProps) {
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
  const stats = useLoginStats(variant === "split");

  if (variant === "split") {
    return (
      <div className="theme-light-forced min-h-screen flex flex-col md:flex-row">
        <div
          className="flex-1 md:basis-[46%] text-on-accent px-6 py-9 md:px-9 md:py-11 flex flex-col justify-between"
          style={{
            background:
              "linear-gradient(155deg, rgb(var(--accent)), color-mix(in srgb, rgb(var(--accent)) 60%, rgb(var(--bg))))",
          }}
        >
          <div>
            <h1 className="flex items-baseline gap-1.5 leading-tight">
              <span className="text-[1.35rem] font-extrabold tracking-[-.01em]">LIVE Sidestage</span>
              <span className="text-[.95rem] font-medium opacity-90">{brandSuffix}</span>
            </h1>
            <p className="text-[.86rem] mt-1.5" style={{ color: "rgba(255,255,255,.85)" }}>
              {tagline}
            </p>

            <p className="text-[1.15rem] font-bold leading-[1.5] my-[18px] mb-[22px]">
              {stats ? (
                <>
                  <b className="text-[1.3rem]">{stats.streamerCount.toLocaleString()}</b>
                  人の配信者データを集計する、配信を支えるサポートプラットフォーム
                </>
              ) : (
                "配信者データを集計する、配信を支えるサポートプラットフォーム"
              )}
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-[10px] p-3 text-[.76rem]" style={{ background: "rgba(255,255,255,.12)" }}>
                <b className="block text-[1.15rem]">{stats ? stats.contributorCount.toLocaleString() : "—"}</b>
                人の貢献リスナーデータ
              </div>
              <div className="rounded-[10px] p-3 text-[.76rem]" style={{ background: "rgba(255,255,255,.12)" }}>
                <b className="block text-[1.15rem]">{stats ? stats.giftCount.toLocaleString() : "—"}</b>
                件のギフト履歴
              </div>
              <div className="rounded-[10px] p-3 text-[.76rem]" style={{ background: "rgba(255,255,255,.12)" }}>
                <b className="block text-[1.15rem]">{stats ? stats.battleCount.toLocaleString() : "—"}</b>
                件のバトル履歴
              </div>
              <div className="rounded-[10px] p-3 text-[.76rem]" style={{ background: "rgba(255,255,255,.12)" }}>
                高度なAI解析
                <span
                  className="inline-block text-[.62rem] font-bold ml-1.5 align-middle px-1.5 py-px rounded-full"
                  style={{ background: "rgba(255,255,255,.22)" }}
                >
                  近日公開
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 md:basis-[54%] flex items-center justify-center px-6 py-10 bg-bg">
          <div className="w-full max-w-[320px]">
            <div className="card">
              <GoogleButton onClick={() => signIn("google", { callbackUrl })} />
            </div>
            <FooterConsent />
            {DEV_LOGIN_ENABLED && (
              <DevLoginForm devEmail={devEmail} setDevEmail={setDevEmail} callbackUrl={callbackUrl} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="flex items-baseline justify-center gap-2 leading-tight">
            <span className="text-2xl font-bold text-brand">LIVE Sidestage</span>
            <span className="text-base font-medium text-muted">{brandSuffix}</span>
          </h1>
          <p className="text-muted text-sm mt-1">{tagline}</p>
        </div>

        <div className="card">
          <GoogleButton onClick={() => signIn("google", { callbackUrl })} />
        </div>

        {DEV_LOGIN_ENABLED && (
          <DevLoginForm devEmail={devEmail} setDevEmail={setDevEmail} callbackUrl={callbackUrl} />
        )}
      </div>
    </div>
  );
}
