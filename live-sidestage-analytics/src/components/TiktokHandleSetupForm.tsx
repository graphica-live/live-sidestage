"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TiktokAccountConfirmModal, TiktokAccountConfirmPreview } from "@/components/TiktokAccountConfirmModal";
import { TIKTOK_ID_CHANGE_LOCK_DAYS } from "@/lib/tiktok-id-lock";

type Step = "input" | "verified" | "already_verified";

/**
 * TikTok ID登録フォーム。/setup(設定画面)と/onboarding(初回登録画面)の両方から呼ばれる。
 * 登録完了後の遷移先(/analytics)はここで完結させる。呼び出し元側で追加のredirectを行わないこと。
 */
export function TiktokHandleSetupForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("input");
  const [tiktokHandle, setTiktokHandle] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmPreview, setConfirmPreview] = useState<TiktokAccountConfirmPreview | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    // 認証済み/認証コード発行済みの状態を判定し、初回入力フォームを飛ばす
    fetch("/api/verify/generate", { method: "GET" })
      .then((r) => r.json())
      .then((data) => {
        if (data.tiktokHandle) {
          setTiktokHandle(data.tiktokHandle);
          setStep("already_verified");
        }
      })
      .catch(() => {});
  }, []);

  async function handleGenerateCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const clean = tiktokHandle.replace(/^@/, "").trim();
    if (!clean) {
      setError("TikTok IDを入力してください");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/verify/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiktokHandle: clean }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok || !data.ok) {
      setError(data.error || "エラーが発生しました");
      return;
    }

    setTiktokHandle(data.tiktokHandle);
    setConfirmPreview({
      tiktokHandle: data.tiktokHandle,
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
      body: JSON.stringify({ tiktokHandle: confirmPreview.tiktokHandle }),
    });

    const data = await res.json();
    setConfirming(false);

    if (!res.ok) {
      setError(data.error || "エラーが発生しました");
      setConfirmPreview(null);
      return;
    }

    setConfirmPreview(null);
    setTiktokHandle(data.tiktokHandle);
    setStep("verified");
    setTimeout(() => router.push("/analytics"), 1500);
  }

  function handleReset() {
    setStep("input");
    setTiktokHandle("");
    setError("");
  }

  return (
    <>
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-brand">TikTok IDの設定</h1>
      </div>

      <div className="card space-y-4">
        {step === "already_verified" && (
          <div className="space-y-4">
            <div className="text-center py-2 space-y-1">
              <div className="text-3xl">✓</div>
              <p className="text-green-600 dark:text-green-400 font-semibold">登録済みです</p>
              <p className="text-sm text-muted">
                対象のTikTok ID: <span className="font-mono text-brand">@{tiktokHandle}</span>
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
                  value={tiktokHandle}
                  onChange={(e) => setTiktokHandle(e.target.value)}
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

      {confirmPreview && (
        <TiktokAccountConfirmModal
          preview={confirmPreview}
          busy={confirming}
          onCancel={() => setConfirmPreview(null)}
          onConfirm={handleConfirmRegister}
          lockNoticeText={`登録後${TIKTOK_ID_CHANGE_LOCK_DAYS}日間はTikTok IDを変更できません`}
        />
      )}
    </>
  );
}
