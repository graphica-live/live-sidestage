"use client";

import { useEffect, useState } from "react";
import { OVERLAY_KIND_LIST, overlayUrlFor, type OverlayKind } from "@/lib/overlay/kinds";
import ContributionSettings from "./ContributionSettings";
import { useOverlaySettings } from "./useOverlaySettings";

// オーバーレイの管理ページ。種類は kinds.ts の一覧から出しているので、
// 表示系の種類を足すとカードも自動で増える。
//
// 設定を変えると PATCH が emitOverlaySnapshot() を呼び、右のプレビュー iframe が
// socket 経由で即座に描き変わる。ヘッダーの幅320pxのドロップダウンでは
// 実物を見ながら調整できなかったので、ここが専用ページを作った一番の理由。

export default function OverlaysPage() {
  const { settings, loading, saving, error, update } = useOverlaySettings();
  const [selectedKind, setSelectedKind] = useState<OverlayKind>(OVERLAY_KIND_LIST[0].kind);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  // SSR では origin が分からない。hydration 不一致を避けるためマウント後に入れる
  useEffect(() => setOrigin(window.location.origin), []);

  const meta = OVERLAY_KIND_LIST.find((m) => m.kind === selectedKind) ?? OVERLAY_KIND_LIST[0];
  const token = settings?.overlayToken ?? "";
  const overlayUrl = origin && token ? overlayUrlFor(meta, origin, token) : "";

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header>
        <h1 className="text-xl font-bold text-white">オーバーレイ</h1>
        <p className="text-sm text-gray-400 mt-1">
          OBS の「ブラウザ」ソースに URL を貼ると、配信画面に重ねて表示できます。
        </p>
      </header>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}

      {OVERLAY_KIND_LIST.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {OVERLAY_KIND_LIST.map((k) => (
            <button
              key={k.kind}
              onClick={() => setSelectedKind(k.kind)}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                k.kind === selectedKind
                  ? "border-brand text-brand bg-brand/10"
                  : "border-border text-gray-400 hover:text-white hover:border-white/30"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}

      <section className="card space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-white">{meta.label}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{meta.description}</p>
          </div>
          {saving && <span className="text-xs text-gray-500 shrink-0 pt-1">保存中…</span>}
        </div>

        <div>
          <span className="label">OBS に貼る URL</span>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-white bg-black/40 border border-border px-2.5 py-2 rounded-lg flex-1 truncate">
              {overlayUrl || "読み込み中..."}
            </code>
            <button
              onClick={() => {
                if (!overlayUrl) return;
                navigator.clipboard.writeText(overlayUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              disabled={!overlayUrl}
              className="btn-secondary shrink-0"
            >
              {copied ? "✓ コピー済み" : "コピー"}
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-1.5">
            この URL を知っている人は誰でも表示できます。配信画面には映さないでください。
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400">読み込み中...</p>
        ) : settings ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <ContributionSettings settings={settings} update={update} />

            <div>
              <span className="label">プレビュー</span>
              {overlayUrl ? (
                <iframe
                  src={`${overlayUrl}&preview=1`}
                  title={`${meta.label}のプレビュー`}
                  className="w-full h-[420px] rounded-xl border border-border bg-black/40"
                />
              ) : (
                <div className="w-full h-[420px] rounded-xl border border-border bg-black/40" />
              )}
              <p className="text-[11px] text-gray-500 mt-1.5">
                見やすいように暗い背景を敷いています。実際の配信では背景は透明になります。
              </p>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
