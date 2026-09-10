"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { TiktokHandleSetupForm } from "@/components/TiktokHandleSetupForm";

export default function SetupPage() {
  const [plan, setPlan] = useState<string | null>(null);
  const [principalId, setPrincipalId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/billing/subscription")
      .then((r) => r.json())
      .then((data) => setPlan(data.plan ?? "FREE"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // サポート問い合わせ時の本人特定キー(principalId)。session.user.id と
    // 同じ値(src/lib/auth.ts の session コールバックで token.id を代入)。
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => setPrincipalId(data?.user?.id ?? null))
      .catch(() => {});
  }, []);

  async function handleCopyPrincipalId() {
    if (!principalId) return;
    try {
      await navigator.clipboard.writeText(principalId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <TiktokHandleSetupForm />

        <div className="card space-y-3 mt-4">
          <div>
            <p className="text-sm text-strong font-semibold">現在のプラン</p>
            <p className="mt-1 text-lg font-bold text-brand">{plan ?? "…"}</p>
          </div>
          <div>
            <p className="text-sm text-strong font-semibold">アカウントID</p>
            <p className="text-xs text-muted mb-1">
              サポートへの問い合わせ時にお伝えください
            </p>
            <div className="flex gap-2 items-center">
              <span className="font-mono text-sm text-brand truncate">
                {principalId ?? "…"}
              </span>
              <button
                type="button"
                onClick={handleCopyPrincipalId}
                disabled={!principalId}
                className="btn-ghost text-xs shrink-0"
              >
                {copied ? "コピーしました" : "コピー"}
              </button>
            </div>
          </div>
          <Link href="/billing" className="btn-ghost block w-full text-center text-sm">
            プランを管理する
          </Link>
        </div>
      </div>
    </div>
  );
}
