"use client";

import { useMemo, useState } from "react";
import type { BattleReplayPayload } from "@/lib/battle-replay-contract";
import { Avatar } from "@/components/analytics/battle-types";
import { assignFactionColors, FALLBACK_COLOR } from "@/components/analytics/battle-colors";
import { ReplayPlayer } from "@/components/analytics/battle-replay/BattleReplayView";
import { formatClock, formatShortAmount } from "@/components/analytics/battle-replay/replay-format";
import { teamTotalsOf } from "@/components/analytics/battle-replay/replay-select";

type Mode = "replay" | "list";

/**
 * シェアページの本体。**ペイロードはサーバーから props で渡る**ので、モードを切り替えても
 * 再取得しない。ステージは配信者本人向けの再生モーダルと同じ `ReplayPlayer`
 * (視覚契約 `.impeccable/approved/battle-replay/spec.md`)をそのまま使う。
 */
export function PublicBattleClient({
  payload,
  title,
  initialMode,
}: {
  payload: BattleReplayPayload;
  title: string;
  initialMode: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);

  const colorByTeam = useMemo(
    () =>
      assignFactionColors(
        payload.teams.map((team) => ({ index: team.index, isSelf: team.isSelf, score: team.officialScore }))
      ),
    [payload]
  );
  const totals = useMemo(() => teamTotalsOf(payload), [payload]);

  // 表示モードを URL へ反映する。共有された側が開いた状態を、共有した側と揃えるため。
  // **履歴を積まない**(タブの往復で戻るボタンがページから出られなくなる)。
  const switchMode = (next: Mode) => {
    setMode(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("v", next);
    window.history.replaceState(null, "", url.toString());
  };

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <div className="overflow-hidden rounded-xl border border-white/10 bg-panel">
        <div className="flex items-start justify-between gap-3 border-b border-row-border px-[14px] py-[10px]">
          <div className="min-w-0">
            <h1 className="m-0 truncate text-[13px] font-semibold text-strong">{title}</h1>
            <div className="font-mono text-[11px] text-muted">
              {new Date(payload.startedAt).toLocaleString("ja-JP")} ・ {formatClock(payload.durationMs)}
            </div>
          </div>
          <CopyLinkButton />
        </div>

        <div className="flex gap-1 border-b border-row-border px-[14px] py-2">
          <ModeTab active={mode === "replay"} onClick={() => switchMode("replay")}>
            ▶ バトルを再生
          </ModeTab>
          <ModeTab active={mode === "list"} onClick={() => switchMode("list")}>
            貢献者一覧
          </ModeTab>
        </div>

        {mode === "replay" ? (
          <ReplayPlayer payload={payload} />
        ) : (
          <div className="px-[12px] py-[10px]">
            <div className="grid grid-cols-2 gap-4">
              {totals.map((team) => (
                <TeamColumn
                  key={team.teamIndex}
                  team={team}
                  senders={payload.senders}
                  color={colorByTeam.get(team.teamIndex) ?? FALLBACK_COLOR}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-[6px]">
              {payload.opponentGiftsMissing && (
                <Chip>相手陣営のギフト明細は記録なし(片側のみ)</Chip>
              )}
              {payload.truncated && <Chip>ギフト件数が上限を超えたため後半を省略</Chip>}
            </div>
          </div>
        )}
      </div>

      <p className="mx-auto mt-4 max-w-lg text-center text-[11px] leading-relaxed text-muted">
        このページは配信者が発行した共有リンクで、URL を知っている人なら誰でも閲覧できる。
        <br />
        <a href="/privacy" className="underline">
          プライバシーポリシー
        </a>
      </p>
    </main>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-field bg-brand px-5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-brand-hover"
          : "rounded-field border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:text-strong"
      }
    >
      {children}
    </button>
  );
}

function CopyLinkButton() {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  const copy = async () => {
    const url = window.location.href;
    try {
      // 非 secure context では clipboard API 自体が存在しない。その場合は
      // URL を選択可能なテキストで出して手でコピーしてもらう。
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(url);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("manual");
    }
  };

  if (state === "manual") {
    return (
      <input
        readOnly
        value={typeof window === "undefined" ? "" : window.location.href}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="共有URL"
        className="w-[160px] shrink-0 rounded-field border border-border bg-surface px-2 py-1 font-mono text-[10px] text-muted"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={state === "copied" ? "コピーした" : "リンクをコピー"}
      title={state === "copied" ? "コピーした" : "リンクをコピー"}
      className="flex shrink-0 items-center justify-center rounded-field border border-border p-1.5 text-muted transition-colors hover:text-strong"
    >
      {state === "copied" ? (
        <CheckIcon />
      ) : (
        <ShareIcon />
      )}
    </button>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function TeamColumn({
  team,
  senders,
  color,
}: {
  team: ReturnType<typeof teamTotalsOf>[number];
  senders: BattleReplayPayload["senders"];
  color: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-semibold" style={{ color }}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate">{team.displayName}</span>
        </span>
        <div className="flex items-baseline gap-2 font-mono">
          <span className="text-[15px] font-bold" style={{ color }}>
            {team.officialScore === null ? "—" : Number(team.officialScore).toLocaleString()}
          </span>
          <span className="text-[11px] text-muted">🪙{team.observedCoins.toLocaleString()}</span>
        </div>
      </div>

      {team.contributors.length === 0 ? (
        <div className="rounded-md border border-border bg-white/[.02] px-2.5 py-6 text-center text-[11px] text-muted">
          この陣営のギフト明細は記録されていない
        </div>
      ) : (
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {team.contributors.map((c, i) => {
            const sender = senders[c.senderIndex];
            const name = sender?.n ?? "?";
            return (
              <div key={c.senderIndex} className="flex items-center gap-1.5 px-1 py-1">
                <span
                  className="w-4 shrink-0 text-right font-mono text-[10px] tabular-nums"
                  style={{ color }}
                >
                  {i + 1}
                </span>
                <span
                  className="shrink-0 rounded-full border p-px"
                  style={{ borderColor: `color-mix(in srgb, ${color} 50%, transparent)` }}
                >
                  <Avatar src={sender?.a ?? null} alt={name} size="sm" />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
                <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-muted">
                  🪙{formatShortAmount(c.coins)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[999px] border border-border px-[8px] py-[2px] text-[11px] text-muted">
      {children}
    </span>
  );
}
