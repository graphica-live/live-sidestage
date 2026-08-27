"use client";

import { useEffect, useState } from "react";
import type { LikeContributionSnapshot } from "@/lib/overlay/like-contribution.server";
import type { LikeMilestoneEvent } from "@/lib/overlay/emit";
import { useOverlayParams } from "../../_hooks/useOverlayParams";
import { useOverlayChannel } from "../../_hooks/useOverlayChannel";
import OverlayAvatar from "../../_components/OverlayAvatar";

const DISPLAY_DURATION_MS = 4000;

// OBS ブラウザソース用。URL は `/overlay/like-contribution?token=<overlayToken>`。
// 設定はsnapshot、個別通知はad-hocイベント(overlay:like-contribution:event)経由。
// 通知はキュー消化で1件ずつバルーン表示する。

export default function LikeContributionOverlayPage() {
  const { token, ready } = useOverlayParams();
  const { snapshot, events, dequeueEvent } = useOverlayChannel<LikeContributionSnapshot, LikeMilestoneEvent>(
    "like-contribution",
    token,
    "overlay:like-contribution:event"
  );
  const [current, setCurrent] = useState<LikeMilestoneEvent | null>(null);

  useEffect(() => {
    if (current || events.length === 0) return;
    setCurrent(events[0]);
    dequeueEvent();
  }, [current, events, dequeueEvent]);

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), DISPLAY_DURATION_MS);
    return () => clearTimeout(t);
  }, [current]);

  if (!ready || !token) return null;

  return (
    <div className="p-6">
      {snapshot && current && (
        <div
          className="inline-flex items-center gap-3 px-4 py-3 rounded-2xl bg-black/60 border border-white/10 animate-[fadeIn_0.2s_ease-out]"
          style={{ fontSize: snapshot.nameFontSize }}
        >
          <OverlayAvatar src={current.profileImageUrl} alt={current.nickname} size={40} />
          <div className="flex flex-col leading-tight">
            <span className="text-white font-semibold">{current.nickname}</span>
            <span className="text-pink-400 font-extrabold tabular-nums" style={{ fontSize: snapshot.countFontSize }}>
              {snapshot.title} ❤ {current.totalLikes.toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
