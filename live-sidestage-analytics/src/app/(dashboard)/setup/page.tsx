"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Step = "input" | "code_issued" | "verifying" | "verified";

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("input");
  const [tiktokId, setTiktokId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if already has pending code
    fetch("/api/verify/generate", { method: "GET" })
      .then((r) => r.json())
      .then((data) => {
        if (data.code && data.tiktokId) {
          setCode(data.code);
          setTiktokId(data.tiktokId);
          setStep("code_issued");
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

    const res = await fetch("/api/verify/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiktokId: clean }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "エラーが発生しました");
      return;
    }

    const data = await res.json();
    setCode(data.code);
    setTiktokId(clean);
    setStep("code_issued");
  }

  async function handleVerify() {
    setError("");
    setLoading(true);
    setStep("verifying");

    const res = await fetch("/api/verify/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiktokId }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok || !data.ok) {
      setError(data.error || "認証に失敗しました");
      setStep("code_issued");
      return;
    }

    setStep("verified");
    setTimeout(() => router.push("/analytics"), 1500);
  }

  function handleReset() {
    setStep("input");
    setTiktokId("");
    setCode("");
    setError("");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-brand">LiveAnalytics</h1>
          <p className="text-gray-400 text-sm mt-1">TikTok IDの設定</p>
        </div>

        <div className="card space-y-4">
          {step === "input" && (
            <form onSubmit={handleGenerateCode} className="space-y-4">
              <div>
                <label className="text-sm text-gray-300 block mb-1">
                  TikTok ユーザーID
                </label>
                <div className="flex gap-2">
                  <span className="flex items-center px-3 bg-surface border border-border rounded-lg text-gray-400 text-sm">
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

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? "処理中..." : "認証コードを発行する"}
              </button>
            </form>
          )}

          {(step === "code_issued" || step === "verifying") && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-300 mb-1">認証対象のTikTok ID</p>
                <p className="font-mono text-brand">@{tiktokId}</p>
              </div>

              <div className="bg-surface border border-brand/30 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-2">
                  以下のコードを TikTok プロフィールの自己紹介(bio)に追記してください
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-lg font-mono font-bold text-white tracking-wider bg-black/40 px-3 py-2 rounded flex-1 text-center">
                    {code}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(code)}
                    className="btn-ghost text-xs"
                    title="コピー"
                  >
                    コピー
                  </button>
                </div>
              </div>

              <div className="text-xs text-gray-400 space-y-1">
                <p>① TikTokアプリ → プロフィール編集 → 自己紹介欄に上記コードを貼り付け</p>
                <p>② 保存後、下の「確認する」ボタンを押してください</p>
                <p>③ 認証完了後、コードはbioから削除して構いません</p>
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  className="btn-ghost flex-1 text-sm"
                >
                  やり直す
                </button>
                <button
                  onClick={handleVerify}
                  disabled={step === "verifying"}
                  className="btn-primary flex-1"
                >
                  {step === "verifying" ? "確認中..." : "確認する"}
                </button>
              </div>

              <a
                href={`https://www.tiktok.com/@${tiktokId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-brand transition-colors"
              >
                プロフィールを開く
                <ExternalLinkIcon />
              </a>
            </div>
          )}

          {step === "verified" && (
            <div className="text-center py-4 space-y-2">
              <div className="text-4xl">✓</div>
              <p className="text-green-400 font-semibold">認証完了!</p>
              <p className="text-sm text-gray-400">解析ページへ移動しています...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-3 h-3"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
