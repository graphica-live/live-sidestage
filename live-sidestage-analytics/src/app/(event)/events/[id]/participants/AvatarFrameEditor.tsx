"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type AvatarFrame,
  DEFAULT_AVATAR_OFFSET_X,
  DEFAULT_AVATAR_OFFSET_Y,
  DEFAULT_AVATAR_ZOOM,
  avatarFrameStyle,
  clampOffset,
  clampZoom,
  coverDimensions,
  dragDeltaToOffsetDelta,
} from "@/event/avatar-frame";

// プレビュー枠は対戦カードのサイド枠(BracketTree.tsx の CARD_W×SIDE_H)と
// 同じアスペクト比にする。正方形にすると、正方形画像×正方形枠では object-fit: cover の
// 余白が両軸ともゼロになり、ドラッグが一切効かない編集画面になってしまうため
// (fable-expertレビューで指摘)。176:92(sm:CARD_W×SIDE_H)を操作しやすい大きさへ拡大した値。
const PREVIEW_W = 320;
const PREVIEW_H = 168;

const DEFAULT_FRAME: AvatarFrame = {
  offsetX: DEFAULT_AVATAR_OFFSET_X,
  offsetY: DEFAULT_AVATAR_OFFSET_Y,
  zoom: DEFAULT_AVATAR_ZOOM,
};

type PointerState = { x: number; y: number };

export function AvatarFrameEditor({
  eventId,
  participantId,
  displayName,
  initialFrame,
  onClose,
  onSaved,
}: {
  eventId: string;
  participantId: string;
  displayName: string;
  initialFrame: AvatarFrame;
  onClose: () => void;
  onSaved: (frame: AvatarFrame) => void;
}) {
  const router = useRouter();
  const [frame, setFrame] = useState<AvatarFrame>(initialFrame);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);
  // ポインタごとの直近位置。2本目が乗った瞬間にピンチへ切り替える。
  const pointers = useRef<Map<number, PointerState>>(new Map());
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartZoom = useRef<number>(1);

  // React の onWheel は passive: true で登録されるため handler 内の preventDefault が
  // 効かず、ピンチ・ホイール操作でページ全体がスクロール/拡大縮小してしまう。
  // 生のリスナを { passive: false } で登録して確実に止める。
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setFrame((f) => ({ ...f, zoom: clampZoom(f.zoom - e.deltaY * 0.0025) }));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  function applyPan(dxPx: number, dyPx: number) {
    if (!naturalSize) return;
    const cover = coverDimensions(naturalSize.width, naturalSize.height, PREVIEW_W, PREVIEW_H);
    setFrame((f) => ({
      ...f,
      offsetX: clampOffset(
        f.offsetX + dragDeltaToOffsetDelta(dxPx, PREVIEW_W, cover.width, f.zoom)
      ),
      offsetY: clampOffset(
        f.offsetY + dragDeltaToOffsetDelta(dyPx, PREVIEW_H, cover.height, f.zoom)
      ),
    }));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStartDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartZoom.current = frame.zoom;
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStartDistance.current && pinchStartDistance.current > 0) {
        const nextZoom = clampZoom(
          pinchStartZoom.current * (distance / pinchStartDistance.current)
        );
        setFrame((f) => ({ ...f, zoom: nextZoom }));
      }
      return;
    }

    applyPan(next.x - prev.x, next.y - prev.y);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStartDistance.current = null;
  }

  function reset() {
    setFrame(DEFAULT_FRAME);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/participants/${participantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarFrame: frame }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "保存に失敗した。");
        return;
      }
      onSaved(frame);
      router.refresh();
    } catch {
      setError("保存に失敗した(通信エラー)。");
    } finally {
      setSaving(false);
    }
  }

  const style = avatarFrameStyle(frame);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-panel p-4">
        <h2 className="mb-1 text-sm font-bold text-white">@{displayName} のアイコン位置</h2>
        <p className="mb-3 text-xs text-gray-500">
          ドラッグで位置合わせ、ピンチ(PCはホイール)で拡大縮小できる。
        </p>

        <div
          ref={previewRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
          style={{ width: PREVIEW_W, height: PREVIEW_H, touchAction: "none" }}
          className="relative mx-auto select-none overflow-hidden rounded-md border border-white/10 bg-white/5"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/public/avatar/${participantId}`}
            alt=""
            draggable={false}
            onLoad={(e) =>
              setNaturalSize({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
            className="absolute inset-0 h-full w-full object-cover"
            style={style}
          />
          {/* 実際の対戦カードと同じ、下からの名前グラデーション。位置合わせの見た目を一致させる。 */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/90 via-black/60 to-transparent"
            aria-hidden
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-1 truncate px-2 text-center text-xs font-bold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]">
            {displayName}
          </div>
        </div>

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={saving}
            className="text-xs text-gray-400 hover:text-white"
          >
            初期位置に戻す
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
