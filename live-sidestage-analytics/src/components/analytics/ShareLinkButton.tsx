"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowShareIcon } from "./icons/ArrowShareIcon";

const COPIED_FEEDBACK_MS = 3000;

/**
 * 共有リンクを発行してクリップボードへ入れる汎用ボタン。**URLはサーバーが組む**
 * (`canonicalOrigin("analytics")`。`window.location.origin` だと別ホストから発行したときずれる)。
 *
 * 元は `BattleDetailModal.tsx` のバトル履歴共有専用だった状態機械
 * (`idle|working|copied|manual|error`)を `{postUrl, buildRequestBody}` で汎用化したもの。
 * 貢献ランキングのシェアボタンもこれを使う。
 */
export function ShareLinkButton({
  postUrl,
  buildRequestBody,
  urlSuffix,
  ariaLabel = "共有リンクをコピー",
}: {
  postUrl: string;
  /** POSTボディを組み立てる。省略時はボディ無しでPOSTする(バトル履歴の既存挙動)。 */
  buildRequestBody?: () => unknown;
  /** 発行されたURLへ付け足す文字列(バトル履歴の `?v=list|replay` 等)。 */
  urlSuffix?: string;
  ariaLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "copied" | "manual" | "error">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const share = async () => {
    setState("working");
    try {
      const body = buildRequestBody?.();
      const res = await fetch(postUrl, {
        method: "POST",
        ...(body !== undefined && body !== null
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { url: string };
      const shareUrl = urlSuffix ? `${data.url}${urlSuffix}` : data.url;
      setUrl(shareUrl);
      // 非 secure context では clipboard API が無い。その場合は URL を
      // 選択可能なテキストで出して手でコピーしてもらう(黙って失敗させない)。
      if (!navigator.clipboard) {
        setState("manual");
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setState("copied");
      window.setTimeout(() => setState("idle"), COPIED_FEEDBACK_MS);
    } catch {
      setState("error");
    }
  };

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => void share()}
          disabled={state === "working"}
          aria-label={state === "copied" ? "コピーした" : ariaLabel}
          title={state === "copied" ? "コピーした" : ariaLabel}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-row-hover hover:text-strong disabled:opacity-60 ${
            state === "copied" ? "bg-brand/15 text-brand" : "text-muted"
          }`}
        >
          {state === "copied" ? <CheckIcon /> : <ArrowShareIcon />}
        </button>
        {state === "error" && <span className="text-[10px] text-muted">共有リンクを発行できなかった。</span>}
        {state === "manual" && url !== null && (
          <input
            readOnly
            value={url}
            aria-label="共有URL"
            onFocus={(e) => e.currentTarget.select()}
            className="w-[210px] rounded-field border border-border bg-surface px-2 py-1 font-mono text-[10px] text-muted"
          />
        )}
      </div>
      {mounted &&
        state === "copied" &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 top-5 z-[200] flex justify-center px-4"
          >
            <div className="flex max-w-md items-center gap-2.5 rounded-xl border border-brand/25 bg-brand px-5 py-3.5 text-sm font-semibold text-on-accent shadow-[0_12px_40px_-12px_rgba(79,70,229,.55)]">
              <CheckIcon className="h-[18px] w-[18px]" />
              共有リンクをコピーしました
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
