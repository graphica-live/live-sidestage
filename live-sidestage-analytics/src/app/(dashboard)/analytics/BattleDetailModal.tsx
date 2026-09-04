"use client";

import { useRef, useState, useEffect } from "react";
import {
  Avatar,
  BATTLE_STATUS_LABELS,
  type BattleContributor,
  type BattleContributorsData,
  type BattleListItem,
  type BattleTeam,
  type BattleTeamContributors,
} from "./battle-types";

// バトル履歴の行クリックで開く対戦詳細モーダル。以前は行内アコーディオン展開だったが、
// 公開トーナメント表の対戦詳細モーダル(MatchDetailModal.tsx)と表示形式を揃えるため変更した。
//
// 対戦相手陣営の貢献者(誰がいくら投げたか)も表示する。相手roomが監視対象で観測できていれば
// queryBattleContributorsがteamIndexベースで陣営別に返す(battle-history.ts参照)。観測できない/
// ライブ中で相手陣営が確定できない場合は`teams`がnullになり、既存の単一貢献者リスト表示にフォールバックする。

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: BattleContributorsData };

const SELF_COLOR = "#fe4d4d";
const OPPONENT_COLORS = ["#4d9fff", "#ffa64d", "#b98aff"];
const GOLD = "#f5c451";
const FALLBACK_COLOR = "#9a9ea6";

const CAPTURE_STATUS_LABEL: Record<string, string> = {
  partial: "一部",
  unavailable: "未観測",
  complete: "完全",
};

/** 自陣営は常に赤固定、相手陣営はバトルスコア降順で青→橙→紫を割り当てる。 */
function assignFactionColors(teams: { index: number; isSelf: boolean; score: string | null }[]): Map<number, string> {
  const colorByIndex = new Map<number, string>();
  for (const t of teams) if (t.isSelf) colorByIndex.set(t.index, SELF_COLOR);
  const opponents = teams
    .filter((t) => !t.isSelf)
    .slice()
    .sort((a, b) => {
      const av = a.score === null ? -1n : BigInt(a.score);
      const bv = b.score === null ? -1n : BigInt(b.score);
      return av > bv ? -1 : av < bv ? 1 : 0;
    });
  opponents.forEach((t, i) => colorByIndex.set(t.index, OPPONENT_COLORS[i % OPPONENT_COLORS.length]));
  return colorByIndex;
}

/** スコアが確定していない陣営が2つ未満、または最高スコアが同点のときはnull(WINバッジを出さない)。 */
function resolveWinningTeamIndex(teams: { index: number; score: string | null }[]): number | null {
  const scored = teams.filter((t) => t.score !== null);
  if (scored.length < 2) return null;
  let maxIndex: number | null = null;
  let maxScore: bigint | null = null;
  let tie = false;
  for (const t of scored) {
    const v = BigInt(t.score!);
    if (maxScore === null || v > maxScore) {
      maxScore = v;
      maxIndex = t.index;
      tie = false;
    } else if (v === maxScore) {
      tie = true;
    }
  }
  return tie ? null : maxIndex;
}

export function BattleDetailModal({
  battle,
  onClose,
}: {
  battle: BattleListItem | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!battle) return;
    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        const res = await fetch(`/api/analytics/battles/${encodeURIComponent(battle.battleId)}/contributors`);
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const data = (await res.json()) as BattleContributorsData;
        if (!cancelled) setState({ status: "ready", data });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [battle]);

  useEffect(() => {
    if (!battle) return;
    closeButtonRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [battle, onClose]);

  if (!battle) return null;

  const opponent = battle.opponent;
  const bothScores = battle.selfScore !== null && battle.opponentScore !== null;
  const win = bothScores && BigInt(battle.selfScore!) > BigInt(battle.opponentScore!);
  const lose = bothScores && BigInt(battle.selfScore!) < BigInt(battle.opponentScore!);

  const teams = battle.teams;
  const colorByIndex = teams ? assignFactionColors(teams) : null;
  const winningIndex = teams ? resolveWinningTeamIndex(teams) : null;
  // 上下貫通の縦分割線は2陣営(自分1陣営+相手1陣営。相手陣営内が複数人でも2陣営)のときのみ。
  // 3陣営以上(乱戦・個人戦)は対戦表が2列gridの折返し表示になり、下部貢献欄との列対応が
  // 無いため線を統合しない(spec.md参照)。
  const useContinuousDivider = (teams?.length ?? 0) === 2;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 py-10 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="relative mx-auto w-full max-w-lg rounded-xl border border-white/10 bg-panel p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-row-hover hover:text-strong"
        >
          <CloseIcon />
        </button>

        <div className="pr-8 text-xs text-muted">{new Date(battle.startedAt).toLocaleString("ja-JP")}</div>

        <div className={useContinuousDivider ? "relative z-0" : undefined}>
          {useContinuousDivider && (
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-0 bottom-0 w-px bg-border"
              style={{ zIndex: -1 }}
            />
          )}

          <div className="mt-2 pr-8">
            {teams && teams.length > 0 ? (
              <VersusHeader teams={teams} colorByIndex={colorByIndex!} winningIndex={winningIndex} />
            ) : (
              <FallbackVersusHeader battle={battle} opponent={opponent} win={win} lose={lose} />
            )}
          </div>

          <div className="mt-5 pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted">貢献者</span>
              <span className="text-[10px] text-muted">🪙降順</span>
            </div>
            {state?.status === "loading" && (
              <div className="text-center py-6 text-muted text-xs">読み込み中...</div>
            )}
            {state?.status === "error" && (
              <div className="text-center py-6 text-muted text-xs">貢献者一覧を取得できなかった。</div>
            )}
            {state?.status === "ready" &&
              (state.data.teams && state.data.teams.length > 0 ? (
                <div className="grid grid-cols-2 gap-4">
                  {state.data.teams.map((team) => (
                    <TeamContributorColumn
                      key={team.index}
                      team={team}
                      color={colorByIndex?.get(team.index) ?? FALLBACK_COLOR}
                    />
                  ))}
                </div>
              ) : state.data.contributors.length === 0 ? (
                <div className="text-center py-6 text-muted text-xs">
                  {state.data.status === "unknown"
                    ? "バトル区間を確定できないため集計できません"
                    : "このバトルへの貢献者なし"}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <FallbackContributorList contributors={state.data.contributors} />
                  </div>
                  <OpponentPendingPlaceholder />
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function VersusHeader({
  teams,
  colorByIndex,
  winningIndex,
}: {
  teams: BattleTeam[];
  colorByIndex: Map<number, string>;
  winningIndex: number | null;
}) {
  if (teams.length === 2) {
    const [a, b] = teams;
    return (
      <div className="flex items-stretch justify-between gap-2">
        <TeamCard team={a} color={colorByIndex.get(a.index) ?? FALLBACK_COLOR} isWinner={winningIndex === a.index} />
        <span className="flex items-center shrink-0 text-[10px] font-semibold text-muted">VS</span>
        <TeamCard
          team={b}
          color={colorByIndex.get(b.index) ?? FALLBACK_COLOR}
          isWinner={winningIndex === b.index}
          align="right"
        />
      </div>
    );
  }
  return (
    <div className="relative grid grid-cols-2 gap-2">
      {teams.map((t) => (
        <TeamCard
          key={t.index}
          team={t}
          color={colorByIndex.get(t.index) ?? FALLBACK_COLOR}
          isWinner={winningIndex === t.index}
        />
      ))}
      <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-panel text-[9px] font-semibold text-muted">
        VS
      </span>
    </div>
  );
}

function TeamCard({
  team,
  color,
  isWinner,
  align,
}: {
  team: BattleTeam;
  color: string;
  isWinner: boolean;
  align?: "right";
}) {
  return (
    <div
      className={`relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 ${
        align === "right" ? "flex-row-reverse text-right" : ""
      }`}
    >
      {isWinner && (
        <span
          className={`absolute -top-2 ${align === "right" ? "left-2" : "right-2"} rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide`}
          style={{
            color: GOLD,
            borderColor: GOLD,
            background: "#000",
            textShadow: `0 0 6px ${GOLD}88`,
            boxShadow: `0 0 8px ${GOLD}55`,
          }}
        >
          WIN
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        {team.participants.map((p) => {
          const label = team.isSelf
            ? "自分"
            : p.nickName ?? (p.displayId ? `@${p.displayId}` : null) ?? p.tiktokId ?? "?";
          return (
            <div key={p.anchorId} className={`flex min-w-0 items-center gap-1.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
              <Avatar src={p.avatarUrl} alt={label} size="sm" />
              <div className="min-w-0 max-w-[100px] truncate text-xs font-medium" style={team.isSelf ? undefined : { color }}>
                {label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FallbackVersusHeader({
  battle,
  opponent,
  win,
  lose,
}: {
  battle: BattleListItem;
  opponent: BattleListItem["opponent"];
  win: boolean;
  lose: boolean;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {opponent === null ? (
            <span className="text-muted text-sm">対戦相手不明</span>
          ) : opponent.count > 1 ? (
            <span className="text-muted text-sm">複数人バトル({opponent.count + 1}人)</span>
          ) : opponent.nickName || opponent.displayId || opponent.tiktokId ? (
            <>
              <Avatar src={opponent.avatarUrl} alt={opponent.nickName ?? opponent.displayId ?? "?"} />
              <div className="min-w-0">
                <div className="font-medium truncate">{opponent.nickName ?? `@${opponent.displayId}`}</div>
                {(opponent.displayId || opponent.tiktokId) && (
                  <div className="text-xs text-muted truncate">@{opponent.displayId ?? opponent.tiktokId}</div>
                )}
              </div>
            </>
          ) : (
            <span className="text-muted text-sm">対戦相手不明</span>
          )}
        </div>
        <span
          className={`text-xs shrink-0 ${
            battle.status === "live"
              ? "text-brand"
              : battle.status === "cut_short"
                ? "text-red-600 dark:text-red-400"
                : "text-muted"
          }`}
        >
          {BATTLE_STATUS_LABELS[battle.status]}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm font-mono">
        <span>
          {battle.selfScore === null ? (
            "-"
          ) : (
            <span className={win ? "text-brand font-semibold" : ""}>{Number(battle.selfScore).toLocaleString()}</span>
          )}
          {" / "}
          {battle.opponentScore === null ? (
            "-"
          ) : (
            <span className={lose ? "text-red-600 dark:text-red-400 font-semibold" : ""}>
              {Number(battle.opponentScore).toLocaleString()}
            </span>
          )}
        </span>
        <span className="text-muted">💎{battle.selfTotalDiamonds.toLocaleString()}</span>
      </div>
    </>
  );
}

function TeamContributorColumn({ team, color }: { team: BattleTeamContributors; color: string }) {
  const isIndividual = team.selectorMode === "individual";
  // individual(乱戦の相手統合列)は「陣営全体合算」を持たないため、常にどれか1人を選択した状態で
  // 始まる(既定=participants[0]、サーバー側でスコア降順ソート済みなので自分以外の最高スコア者)。
  const [selectedAnchorId, setSelectedAnchorId] = useState<string | null>(
    isIndividual ? (team.participants[0]?.anchorId ?? null) : null
  );
  const selectedParticipant =
    selectedAnchorId !== null ? team.participants.find((p) => p.anchorId === selectedAnchorId) ?? null : null;

  const displayTitle = selectedParticipant ? selectedParticipant.displayName : team.displayName;
  const captureStatus = selectedParticipant ? selectedParticipant.captureStatus : team.captureStatus;
  const battleScore = selectedParticipant ? selectedParticipant.battleScore : team.battleScore;
  const observedGiftTotal = selectedParticipant ? selectedParticipant.observedGiftTotal : team.observedGiftTotal;
  const contributors = selectedParticipant ? selectedParticipant.contributors : team.contributors;
  const partialNote = selectedParticipant ? selectedParticipant.partialNote : team.partialNote;

  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-h-[22px] flex-col gap-1.5">
        <div className="flex items-center justify-between gap-1.5">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-semibold" style={{ color }}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate">{displayTitle}</span>
          </span>
          {captureStatus && captureStatus !== "complete" && (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                captureStatus === "unavailable" ? "bg-white/5 text-muted" : "bg-yellow-500/10 text-yellow-500"
              }`}
            >
              {CAPTURE_STATUS_LABEL[captureStatus]}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2 font-mono">
          <span className="text-[15px] font-bold" style={{ color }}>
            {battleScore === null ? "—" : Number(battleScore).toLocaleString()}
          </span>
          <span className="text-[11px] text-muted">
            {captureStatus === "unavailable" ? "—" : `🪙${observedGiftTotal.toLocaleString()}`}
          </span>
        </div>
      </div>

      {team.participants.length > 1 ? (
        <div className="mb-2.5 flex flex-wrap gap-1">
          {!isIndividual && (
            <button
              type="button"
              onClick={() => setSelectedAnchorId(null)}
              className="rounded-full border px-2 py-0.5 text-[10px]"
              style={
                selectedAnchorId === null
                  ? { borderColor: color, color }
                  : { borderColor: "rgb(var(--border))", color: "#9a9ea6" }
              }
            >
              陣営全体合算
            </button>
          )}
          {team.participants.map((p) => (
            <button
              key={p.anchorId}
              type="button"
              onClick={() => setSelectedAnchorId(p.anchorId)}
              className="max-w-[100px] truncate rounded-full border px-2 py-0.5 text-[10px]"
              style={
                selectedAnchorId === p.anchorId
                  ? { borderColor: color, color }
                  : { borderColor: "rgb(var(--border))", color: "#9a9ea6" }
              }
            >
              {p.displayName}
            </button>
          ))}
        </div>
      ) : (
        <div aria-hidden className="mb-2.5 min-h-[24px]" />
      )}

      {captureStatus === "unavailable" ? (
        <div className="rounded-md border border-border bg-white/[.02] px-2.5 py-6 text-center text-[11px] text-muted">
          相手の配信データは観測できませんでした
        </div>
      ) : contributors.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-muted">貢献者なし</div>
      ) : (
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {contributors.map((c) => (
            <ExpandableContributorRow key={c.uniqueId} contributor={c} color={color} />
          ))}
        </div>
      )}

      {partialNote && <div className="mt-2 text-[10px] leading-snug text-muted">{partialNote}</div>}
    </div>
  );
}

function ExpandableContributorRow({ contributor, color }: { contributor: BattleContributor; color: string }) {
  const [expanded, setExpanded] = useState(false);
  const hasLog = contributor.giftEvents.length > 0;
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => hasLog && setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-row-hover"
      >
        <svg
          viewBox="0 0 16 16"
          width={10}
          height={10}
          fill="currentColor"
          className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""} ${hasLog ? "" : "invisible"}`}
          style={{ color }}
        >
          <path d="M6 4l5 4-5 4V4z" />
        </svg>
        <span
          className="shrink-0 rounded-full border p-px"
          style={{ borderColor: `color-mix(in srgb, ${color} 50%, transparent)` }}
        >
          <Avatar src={contributor.profileImageUrl} alt={contributor.nickname} size="sm" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{contributor.nickname}</span>
        <span className="shrink-0 font-mono text-[11.5px] text-muted">
          🪙{contributor.totalDiamonds.toLocaleString()}
        </span>
      </button>
      {expanded && hasLog && (
        <div className="ml-[30px] space-y-0.5 border-l border-border py-1 pl-2">
          {contributor.giftEvents.map((g, i) => (
            <div key={i} className="flex items-center gap-2 text-[10.5px] text-muted">
              <span className="shrink-0 font-mono text-[10px]">
                {new Date(g.occurredAt).toLocaleTimeString("ja-JP", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              <span className="min-w-0 flex-1 truncate">{g.giftName}</span>
              <span className="shrink-0 font-mono">
                🪙{g.totalDiamonds.toLocaleString()}
                {g.repeatCount > 1 ? `(×${g.repeatCount})` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OpponentPendingPlaceholder() {
  return (
    <div className="min-w-0 flex items-center justify-center rounded-md border border-border bg-white/[.02] px-2.5 py-6 text-center text-[11px] text-muted">
      <span className="animate-pulse">集計中…</span>
    </div>
  );
}

function FallbackContributorList({ contributors }: { contributors: BattleContributor[] }) {
  return (
    <div className="space-y-1.5 max-h-80 overflow-y-auto">
      {contributors
        .slice()
        .sort((a, b) => b.totalDiamonds - a.totalDiamonds)
        .map((c) => (
          <div key={c.uniqueId} className="flex items-center gap-2 text-xs">
            <Avatar src={c.profileImageUrl} alt={c.nickname} />
            <span className="font-medium truncate max-w-[160px]">{c.nickname}</span>
            <span className="text-muted">@{c.uniqueId}</span>
            <span className="ml-auto font-mono">
              💎{c.totalDiamonds.toLocaleString()} ({c.giftCount}件)
            </span>
          </div>
        ))}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}
