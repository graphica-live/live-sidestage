"use client";

import type { TapListSnapshot } from "@/lib/overlay/tap-list.server";
import { useOverlayParams } from "../../_hooks/useOverlayParams";
import { useOverlaySnapshot } from "../../_hooks/useOverlaySnapshot";
import OverlayAvatar from "../../_components/OverlayAvatar";

// OBS ブラウザソース用。URL は `/overlay/tap-list?token=<overlayToken>`。
// coin-listとほぼ同型(ハートアイコンのみ差分)。

export default function TapListOverlayPage() {
  const { token, ready } = useOverlayParams();
  const snapshot = useOverlaySnapshot<TapListSnapshot>("tap-list", token);

  if (!ready || !token) return null;

  return (
    <div className="p-6">
      {snapshot && (
        <ul className="flex flex-col" style={{ gap: `${snapshot.rowGap}px` }}>
          {snapshot.entries.map((entry) => (
            <li
              key={entry.uniqueId}
              className="flex items-center gap-3 px-3 py-1.5 rounded-xl"
              style={{ background: snapshot.bgStyle === "semi" ? "rgba(0,0,0,0.45)" : "transparent" }}
            >
              <span className="w-6 text-right font-bold text-white/80">{entry.rank}</span>
              <OverlayAvatar src={entry.profileImageUrl} alt={entry.nickname} size={28} />
              <span className="flex-1 truncate text-white font-semibold">{entry.nickname}</span>
              <span className="text-pink-400 font-extrabold tabular-nums">❤ {entry.tapCount.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
