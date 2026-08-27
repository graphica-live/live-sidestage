"use client";

import { useEffect, useRef, useState } from "react";
import type { TopGiftSnapshot } from "@/lib/overlay/top-gift.server";
import { useOverlayParams } from "../../_hooks/useOverlayParams";
import { useOverlaySnapshot } from "../../_hooks/useOverlaySnapshot";
import OverlayAvatar from "../../_components/OverlayAvatar";

// OBS ブラウザソース用。URL は `/overlay/top-gift?token=<overlayToken>`。
// トップ更新(giftId+receivedAtの組が変わった)時だけグロー演出をトリガーする。

export default function TopGiftOverlayPage() {
  const { token, ready } = useOverlayParams();
  const snapshot = useOverlaySnapshot<TopGiftSnapshot>("top-gift", token);
  const [celebrate, setCelebrate] = useState(false);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!snapshot?.topGift) return;
    const key = `${snapshot.topGift.giftId}:${snapshot.topGift.receivedAt}`;
    if (lastKeyRef.current !== null && lastKeyRef.current !== key && snapshot.glowEnabled) {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 2000);
      return () => clearTimeout(t);
    }
    lastKeyRef.current = key;
  }, [snapshot?.topGift, snapshot?.glowEnabled]);

  if (!ready || !token) return null;

  const gift = snapshot?.topGift;

  return (
    <div className="p-6">
      {snapshot && (
        <div
          className="inline-flex items-center gap-3 px-4 py-3 rounded-2xl bg-black/40 transition-shadow"
          style={celebrate ? { boxShadow: "0 0 30px 8px rgba(250,204,21,0.75)" } : undefined}
        >
          <span className="text-sm font-bold text-white/70">{snapshot.title}</span>
          {gift ? (
            <>
              {gift.giftPictureUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={gift.giftPictureUrl} alt={gift.giftName} className="w-10 h-10 object-contain" />
              )}
              <OverlayAvatar src={gift.profileImageUrl} alt={gift.nickname} size={28} />
              <span className="text-white font-semibold truncate max-w-[160px]">
                {snapshot.senderDisplayMode === "all" ? gift.senders.join(", ") : gift.latestSender}
              </span>
              <span className="text-yellow-300 font-extrabold tabular-nums">{gift.giftValue.toLocaleString()}</span>
            </>
          ) : (
            <span className="text-white/50 text-sm">まだギフトが届いていません</span>
          )}
        </div>
      )}
    </div>
  );
}
