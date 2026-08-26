"use client";

import type { CSSProperties } from "react";
import type { OverlaySnapshot } from "@/lib/overlay/contracts";
import { useOverlayParams } from "../../_hooks/useOverlayParams";
import { useOverlaySnapshot } from "../../_hooks/useOverlaySnapshot";
import ContributorList from "./ContributorList";
import { HEADING_ACCENT_COLOR, HEADING_ACCENT_TEXT_SHADOW, HEADING_BACKGROUND_STYLE } from "./theme";
import "./contribution.css";

// OBS ブラウザソース用。URL は `/overlay/contribution?token=<overlayToken>`。
// **このパスは配信者の OBS に設定済みなので変えないこと**((overlay) はルートグループで
// URL に出ないため、ファイルの置き場を変えても URL は変わらない)。
// 背景の透過/プレビュー切り替えは (overlay)/layout.tsx が持っている。

function formatDayLabel(dayKey: string): string {
  if (!dayKey) return "";
  const d = new Date(`${dayKey}T00:00:00+09:00`);
  return d.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
}

function formatCompactCoin(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return value.toLocaleString();
}

export default function ContributionOverlayPage() {
  const { token, ready } = useOverlayParams();
  const snapshot = useOverlaySnapshot<OverlaySnapshot>("contribution", token);

  if (!ready || !token) return null;

  const accentColor = snapshot ? HEADING_ACCENT_COLOR[snapshot.headingBackground] : HEADING_ACCENT_COLOR.clear;
  const accentTextShadow = snapshot
    ? HEADING_ACCENT_TEXT_SHADOW[snapshot.headingBackground]
    : HEADING_ACCENT_TEXT_SHADOW.clear;

  return (
    <div className="p-6" style={{ "--overlay-accent": accentColor } as CSSProperties}>
      {snapshot && (
        <>
          <div
            className="flex mb-4"
            style={{ justifyContent: snapshot.align === "right" ? "flex-end" : "flex-start" }}
          >
            <div
              className="inline-flex items-center gap-3"
              style={HEADING_BACKGROUND_STYLE[snapshot.headingBackground]}
            >
              <span className="font-extrabold text-lg" style={{ color: accentColor, textShadow: accentTextShadow }}>
                {formatCompactCoin(snapshot.threshold)}貢献｜
                {snapshot.isToday
                  ? `あと${Math.max(snapshot.goalCount - snapshot.qualifiedCount, 0)}人`
                  : formatDayLabel(snapshot.dayKey)}
              </span>
            </div>
          </div>

          <ContributorList
            contributors={snapshot.contributors}
            visibleRows={snapshot.visibleRows}
            nameMaxWidth={snapshot.nameMaxWidth}
            align={snapshot.align}
            displaySpeed={snapshot.displaySpeed}
          />
        </>
      )}
    </div>
  );
}
