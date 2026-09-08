"use client";

import { useEffect, useRef } from "react";

export type TiktokAccountConfirmPreview = {
  tiktokHandle: string;
  nickname: string | null;
  avatarUrl: string | null;
  signature: string | null;
  followingCount: number | null;
  followerCount: number | null;
};

type Props = {
  preview: TiktokAccountConfirmPreview;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** setup画面(Streamer.tiktokHandle登録用)からのみ渡す。admin-workers(AgencyWatch追加)では表示しない */
  lockNoticeText?: string;
};

function formatCount(n: number | null): string {
  return n === null ? "-" : n.toLocaleString();
}

export function TiktokAccountConfirmModal({ preview, busy, onCancel, onConfirm, lockNoticeText }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        className="w-[360px] rounded-xl border border-border bg-panel p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          {preview.avatarUrl ? (
            <img
              src={preview.avatarUrl}
              alt={preview.nickname ?? preview.tiktokHandle}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <div className="h-16 w-16 rounded-full bg-[#2a2a2a]" />
          )}
          <div>
            <div className="text-sm font-semibold text-white">{preview.nickname ?? preview.tiktokHandle}</div>
            <div className="mt-0.5 text-xs text-[#8b90a0]">@{preview.tiktokHandle}</div>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <div className="flex-1 rounded-lg border border-border bg-[#111111] px-3 py-2 text-center">
            <div className="text-xs font-medium text-gray-500">フォロー</div>
            <div className="font-mono text-sm font-medium text-[#f0f0f0]">
              {formatCount(preview.followingCount)}
            </div>
          </div>
          <div className="flex-1 rounded-lg border border-border bg-[#111111] px-3 py-2 text-center">
            <div className="text-xs font-medium text-gray-500">フォロワー</div>
            <div className="font-mono text-sm font-medium text-[#f0f0f0]">
              {formatCount(preview.followerCount)}
            </div>
          </div>
        </div>

        {preview.signature ? (
          <div className="mt-3 line-clamp-2 text-xs leading-relaxed text-gray-500">{preview.signature}</div>
        ) : null}

        <div className="mt-4 text-sm leading-relaxed text-[#f0f0f0]">このユーザーでよろしいですか？</div>

        {lockNoticeText ? (
          <div className="mt-2 text-xs leading-relaxed text-gray-500">{lockNoticeText}</div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            キャンセル
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm} disabled={busy}>
            登録する
          </button>
        </div>
      </div>
    </div>
  );
}
