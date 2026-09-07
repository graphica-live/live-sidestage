"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TiktokAccountConfirmModal, TiktokAccountConfirmPreview } from "@/components/TiktokAccountConfirmModal";
import { TIKTOK_ID_CHANGE_LOCK_DAYS } from "@/lib/tiktok-id-lock";

type Step = "input" | "verified" | "already_verified";

type RecentMerge = {
  id: string;
  outcome: "MERGED" | "BLOCKED_OLD_HANDLE_ALIVE" | "SELF_NOT_FOUND";
  oldTiktokId: string | null;
  giftCount: number | null;
};

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("input");
  const [tiktokId, setTiktokId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [recentMerge, setRecentMerge] = useState<RecentMerge | null>(null);
  const [confirmPreview, setConfirmPreview] = useState<TiktokAccountConfirmPreview | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    fetch("/api/streamer/recent-merge")
      .then((r) => r.json())
      .then((data) => setRecentMerge(data.recentMerge ?? null))
      .catch(() => {});
  }, []);

  async function handleDismissMergeBanner() {
    if (!recentMerge) return;
    const dismissed = recentMerge;
    setRecentMerge(null);
    await fetch("/api/streamer/recent-merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logId: dismissed.id }),
    }).catch(() => {});
  }

  useEffect(() => {
    fetch("/api/billing/subscription")
      .then((r) => r.json())
      .then((data) => setPlan(data.plan ?? "FREE"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // 認証済み/認証コード発行済みの状態を判定し、初回入力フォームを飛ばす
    fetch("/api/verify/generate", { method: "GET" })
      .then((r) => r.json())
      .then((data) => {
        if (data.tiktokId) {
          setTiktokId(data.tiktokId);
          setStep("already_verified");
        }
      })
      .catch(() => {});
  }, []);

  async function handleGenerateCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const clean = tiktokId.replace(/^@/, "").trim();
    if (!clean) {
      setError("TikTok IDを入力してください");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/verify/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiktokId: clean }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok || !data.ok) {
      setError(data.error || "エラーが発生しました");
      return;
    }

    setTiktokId(data.tiktokId);
    setConfirmPreview({
      tiktokId: data.tiktokId,
      nickname: data.nickname,
      avatarUrl: data.avatarUrl,
      signature: data.signature,
      followingCount: data.followingCount,
      followerCount: data.followerCount,
    });
  }

  async function handleConfirmRegister() {
    if (!confirmPreview) return;
    setConfirming(true);
    setError("");

    const res = await fetch("/api/verify/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiktokId: confirmPreview.tiktokId }),
    });

    const data = await res.json();
    setConfirming(false);

    if (!res.ok) {
      setError(data.error || "エラーが発生しました");
      setConfirmPreview(null);
      return;
    }

    setConfirmPreview(null);
    setTiktokId(data.tiktokId);
    setStep("verified");
    setTimeout(() => router.push("/analytics"), 1500);
  }

  function handleReset() {
    setStep("input");
    setTiktokId("");
    setError("");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-brand">TikTok IDの設定</h1>
        </div>

        {recentMerge && (
          <div
            className={`flex items-start gap-2 rounded-r-xl border p-4 mb-4 ${
              recentMerge.outcome === "MERGED"
                ? "border-brand/30 border-l-4 border-l-brand"
                : "border-gray-400/30 border-l-4 border-l-gray-400"
            }`}
          >
            <p className="flex-1 text-sm leading-relaxed text-gray-200">
              {recentMerge.outcome === "MERGED"
                ? `旧ID @${recentMerge.oldTiktokId} のギフト${recentMerge.giftCount ?? 0}件を引き継ぎました`
                : "引き継げなかったデータがあります。サポートへご連絡ください"}
            </p>
            <button
              onClick={handleDismissMergeBanner}
              className="rounded-md p-1 text-lg leading-none text-gray-400 hover:bg-white/5 hover:text-white"
              aria-label="閉じる"
            >
              &times;
            </button>
          </div>
        )}

        <div className="card space-y-4">
          {step === "already_verified" && (
            <div className="space-y-4">
              <div className="text-center py-2 space-y-1">
                <div className="text-3xl">✓</div>
                <p className="text-green-600 dark:text-green-400 font-semibold">登録済みです</p>
                <p className="text-sm text-muted">
                  対象のTikTok ID: <span className="font-mono text-brand">@{tiktokId}</span>
                </p>
              </div>
              <button onClick={handleReset} className="btn-ghost w-full text-sm">
                別のTikTok IDに変更する
              </button>
            </div>
          )}

          {step === "input" && (
            <form onSubmit={handleGenerateCode} className="space-y-4">
              <div>
                <label className="text-sm text-strong block mb-1">
                  TikTok ユーザーID
                </label>
                <div className="flex gap-2">
                  <span className="flex items-center px-3 bg-surface border border-border rounded-lg text-muted text-sm">
                    @
                  </span>
                  <input
                    type="text"
                    placeholder="your_tiktok_id"
                    value={tiktokId}
                    onChange={(e) => setTiktokId(e.target.value)}
                    className="input-field"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </div>
              </div>

              {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? "確認中..." : "TikTok IDを登録する"}
              </button>
            </form>
          )}

          {step === "verified" && (
            <div className="text-center py-4 space-y-2">
              <div className="text-4xl">✓</div>
              <p className="text-green-600 dark:text-green-400 font-semibold">登録完了!</p>
              <p className="text-sm text-muted">解析ページへ移動しています...</p>
            </div>
          )}
        </div>

        <div className="card space-y-3 mt-4">
          <div>
            <p className="text-sm text-strong font-semibold">現在のプラン</p>
            <p className="mt-1 text-lg font-bold text-brand">{plan ?? "…"}</p>
          </div>
          <Link href="/billing" className="btn-ghost block w-full text-center text-sm">
            プランを管理する
          </Link>
        </div>
      </div>

      {confirmPreview && (
        <TiktokAccountConfirmModal
          preview={confirmPreview}
          busy={confirming}
          onCancel={() => setConfirmPreview(null)}
          onConfirm={handleConfirmRegister}
          lockNoticeText={`登録後${TIKTOK_ID_CHANGE_LOCK_DAYS}日間はTikTok IDを変更できません`}
        />
      )}
    </div>
  );
}
