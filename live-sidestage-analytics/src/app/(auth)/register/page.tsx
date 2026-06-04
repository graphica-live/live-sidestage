"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (password.length < 8) {
      setError("パスワードは8文字以上にしてください");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "登録に失敗しました");
      return;
    }

    router.push("/login");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-brand">LiveAnalytics</h1>
          <p className="text-gray-400 text-sm mt-1">新規アカウント作成</p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              placeholder="名前"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              required
            />
            <input
              type="email"
              placeholder="メールアドレス"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              required
            />
            <input
              type="password"
              placeholder="パスワード（8文字以上）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              required
            />

            {error && <p className="text-red-400 text-xs">{error}</p>}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "登録中..." : "アカウント作成"}
            </button>
          </form>

          <p className="text-center text-sm text-gray-400 mt-4">
            既にアカウントあり？{" "}
            <Link href="/login" className="text-brand hover:underline">
              ログイン
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
