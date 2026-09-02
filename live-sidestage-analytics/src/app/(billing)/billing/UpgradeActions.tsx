"use client";

import { useState } from "react";
import type { PaidPlan } from "@/lib/plan/price-map";

async function redirectToUrl(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || "エラーが発生しました");
  }
  if (!data?.url) throw new Error("リダイレクト先を取得できませんでした");
  window.location.href = data.url;
}

export function UpgradeButton({ plan, label }: { plan: PaidPlan; label: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      await redirectToUrl(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <button onClick={handleClick} disabled={loading} className="btn-primary w-full text-sm">
        {loading ? "処理中..." : label}
      </button>
      {error && <p className="text-red-600 dark:text-red-400 text-xs">{error}</p>}
    </div>
  );
}

export function ManageBillingButton({ label = "プランを管理する" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      await redirectToUrl(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <button onClick={handleClick} disabled={loading} className="btn-ghost text-sm">
        {loading ? "処理中..." : label}
      </button>
      {error && <p className="text-red-600 dark:text-red-400 text-xs">{error}</p>}
    </div>
  );
}
