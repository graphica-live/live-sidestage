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
import {
  assignFactionColors,
  resolveWinningTeamIndex,
  GOLD,
  FALLBACK_COLOR,
} from "./battle-colors";
import type { ReplayUnavailableReason } from "@/lib/battle-replay-contract";
import { BattleReplayView } from "./battle-replay/BattleReplayView";
import { formatClock, replayTitleOf } from "./battle-replay/replay-format";

/** 再生できない理由の文言。サーバーは理由コードだけを返す(契約は battle-replay-contract.ts)。 */
const REPLAY_UNAVAILABLE_LABEL: Record<ReplayUnavailableReason, string> = {
  not_finalized: "このバトルはまだ確定していないため再生できない",
  no_score_points: "このバトルは再生に必要なデータが記録されていない",
  window_invalid: "バトル区間の長さが想定外のため再生できない",
  participants_invalid: "参加者を特定できないため再生できない",
};

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

// 色と勝者判定は battle-colors.ts が正本(再生UIと同じ関数を通す)。

const CAPTURE_STATUS_LABEL: Record<string, string> = {
  partial: "一部",
  unavailable: "未観測",
  complete: "完全",
};


export function BattleDetailModal({
  battle,
  onClose,
  apiBase,
}: {
  battle: BattleListItem | null;
  onClose: () => void;
  /** fetch先の先頭。既定は一般ユーザー向け "/api/analytics"。admin専用画面では "/api/admin/rooms/{roomId}/analytics" を渡す。 */
  apiBase?: string;
}) {
  const [state, setState] = useState<LoadState | null>(null);
  const [mode, setMode] = useState<"list" | "replay">("list");
  // ヘッダの副題に出す尺。ペイロードを読むまでは判らないので、再生画面から1回だけ受け取る。
  const [replayDurationMs, setReplayDurationMs] = useState<number | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const base = apiBase ?? "/api/analytics";
  // シェアリンクの発行は配信者本人とadminの両方が使える。
  const canShare = base === "/api/analytics" || base.startsWith("/api/admin/rooms/");

  // 別のバトルを開いたら必ず一覧モードから始める。**依存は battleId** —
  // 親が同じバトルを別オブジェクトで渡し直す(一覧のポーリング更新)たびに
  // 再生モードが解除されてしまう。
  const battleId = battle?.battleId ?? null;
  useEffect(() => {
    setMode("list");
  }, [battleId]);

  useEffect(() => {
    if (!battle) return;
    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        const res = await fetch(`${base}/battles/${encodeURIComponent(battle.battleId)}/contributors`);
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
  }, [battle, base]);

  // フォーカス移動は**モーダルを開いた時だけ**。Esc ハンドラの effect と同居させると、
  // 再生モードの出入りのたびにフォーカスが閉じるボタンへ奪われる
  useEffect(() => {
    if (!battle) return;
    closeButtonRef.current?.focus();
  }, [battle]);

  useEffect(() => {
    if (!battle) return;

    // 再生中の Esc はモーダルを閉じず、まず一覧モードへ戻す
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (mode === "replay") {
        setMode("list");
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [battle, onClose, mode]);

  if (!battle) return null;

  const opponent = battle.opponent;
  // 進行中(live)は暫定スコアがリードしているだけで決着していないため、勝敗表示を出さない。
  const isDecided = battle.status !== "live";
  const bothScores = isDecided && battle.selfScore !== null && battle.opponentScore !== null;
  const win = bothScores && BigInt(battle.selfScore!) > BigInt(battle.opponentScore!);
  const lose = bothScores && BigInt(battle.selfScore!) < BigInt(battle.opponentScore!);

  const teams = battle.teams;
  const colorByIndex = teams ? assignFactionColors(teams) : null;
  const winningIndex = teams && isDecided ? resolveWinningTeamIndex(teams) : null;
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

        {mode === "replay" ? null : (
          <div className="pr-8 text-xs text-muted">{new Date(battle.startedAt).toLocaleString("ja-JP")}</div>
        )}

        {mode === "replay" ? (
          <div className="mt-2">
            <div className="mb-2 flex items-start justify-between gap-3 pr-8">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-strong">
                  {replayTitleOf(
                    (teams ?? []).map((team) => ({
                      isSelf: team.isSelf,
                      participants: team.participants.map((p) => ({
                        label: p.nickname ?? (p.tiktokHandle ? `@${p.tiktokHandle}` : null) ?? "?",
                      })),
                    }))
                  )}
                </div>
                <div className="font-mono text-[11px] text-muted">
                  {new Date(battle.startedAt).toLocaleString("ja-JP")}
                  {replayDurationMs === null ? "" : ` ・ ${formatClock(replayDurationMs)}`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {canShare && <ShareButton battleId={battle.battleId} view="replay" base={base} />}
                <button
                  type="button"
                  onClick={() => setMode("list")}
                  className="rounded-field border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:text-strong"
                >
                  貢献者一覧へ戻る
                </button>
              </div>
            </div>
            {/* ステージはモーダルの内側余白を無視して端まで使う(comp と同じ画面比のため) */}
            <div className="-mx-5 overflow-hidden sm:-mx-6">
              <BattleReplayView
                replayUrl={`${base}/battles/${encodeURIComponent(battle.battleId)}/replay`}
                onDurationMs={setReplayDurationMs}
              />
            </div>
          </div>
        ) : (
        <div className={useContinuousDivider ? "relative z-0" : undefined}>
          {useContinuousDivider && (
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-0 bottom-0 w-px bg-border"
              style={{ zIndex: -1 }}
            />
          )}

          {/* 縦分割線・下部貢献欄と中央(left-1/2)を揃えるため、閉じるボタン避けのpr-8は
              日付行(下記)だけに残し、ここには付けない(付けるとVSの中心が左へ16pxずれる)。 */}
          <div className="mt-2">
            {teams && teams.length > 0 ? (
              <VersusHeader teams={teams} colorByIndex={colorByIndex!} winningIndex={winningIndex} />
            ) : (
              <FallbackVersusHeader battle={battle} opponent={opponent} win={win} lose={lose} />
            )}
          </div>

          <div className="mt-4 flex flex-col items-center gap-2">
            <button
              type="button"
              disabled={!battle.replay.available}
              aria-disabled={!battle.replay.available}
              aria-describedby={battle.replay.available ? undefined : "replay-unavailable-reason"}
              onClick={() => setMode("replay")}
              title={battle.replay.available ? undefined : REPLAY_UNAVAILABLE_LABEL[battle.replay.reason ?? "not_finalized"]}
              className="rounded-field bg-brand px-5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-border disabled:text-muted"
            >
              ▶ バトルを再生
            </button>
            {/* disabled ボタンの title はホバーでしか読めないので、理由は本文にも出す */}
            {!battle.replay.available && (
              <p id="replay-unavailable-reason" className="m-0 text-[11px] text-muted">
                {REPLAY_UNAVAILABLE_LABEL[battle.replay.reason ?? "not_finalized"]}
              </p>
            )}
            {canShare && <ShareButton battleId={battle.battleId} view="list" base={base} />}
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
        )}
      </div>
    </div>
  );
}

/**
 * 共有リンクを発行してクリップボードへ入れる。**URLはサーバーが組む**
 * (`canonicalOrigin("analytics")`。`window.location.origin` だと別ホストから発行したときずれる)。
 * `?v=` には押した時点のモードを入れ、共有された側が同じ表示で開くようにする。
 *
 * トークンは遅延発行で、2回目以降は同じトークンが返る(再発行しない)。
 */
function ShareButton({
  battleId,
  view,
  base,
}: {
  battleId: string;
  view: "list" | "replay";
  base?: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "copied" | "manual" | "error">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const apiBase = base ?? "/api/analytics";

  const share = async () => {
    setState("working");
    try {
      const res = await fetch(`${apiBase}/battles/${encodeURIComponent(battleId)}/share`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { url: string };
      const shareUrl = `${data.url}?v=${view}`;
      setUrl(shareUrl);
      // 非 secure context では clipboard API が無い。その場合は URL を
      // 選択可能なテキストで出して手でコピーしてもらう(黙って失敗させない)。
      if (!navigator.clipboard) {
        setState("manual");
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
    }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => void share()}
        disabled={state === "working"}
        aria-label={state === "copied" ? "コピーした" : "共有リンクをコピー"}
        title={state === "copied" ? "コピーした" : "共有リンクをコピー"}
        className="flex shrink-0 items-center justify-center rounded-field border border-border p-1.5 text-muted transition-colors hover:text-strong disabled:opacity-60"
      >
        <ArrowShareIcon />
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
          const label = p.nickname ?? (p.tiktokHandle ? `@${p.tiktokHandle}` : null) ?? "?";
          return (
            <div key={p.tiktokUid} className={`flex min-w-0 items-center gap-1.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
              <Avatar src={p.avatarUrl} alt={label} size="sm" />
              <div className="min-w-0 max-w-[100px] truncate text-xs font-medium" style={{ color }}>
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
          ) : opponent.nickname || opponent.tiktokHandle ? (
            <>
              <Avatar src={opponent.avatarUrl} alt={opponent.nickname ?? opponent.tiktokHandle ?? "?"} />
              <div className="min-w-0">
                <div className="font-medium truncate">{opponent.nickname ?? `@${opponent.tiktokHandle}`}</div>
                {opponent.tiktokHandle && (
                  <div className="text-xs text-muted truncate">@{opponent.tiktokHandle}</div>
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
  const [selectedTiktokUid, setSelectedTiktokUid] = useState<string | null>(
    isIndividual ? (team.participants[0]?.tiktokUid ?? null) : null
  );
  const selectedParticipant =
    selectedTiktokUid !== null ? team.participants.find((p) => p.tiktokUid === selectedTiktokUid) ?? null : null;

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
        <div className="mb-2.5 flex flex-nowrap gap-1">
          {!isIndividual && (
            <button
              type="button"
              onClick={() => setSelectedTiktokUid(null)}
              className="min-w-0 max-w-[52px] flex-1 truncate rounded-full border px-2 py-0.5 text-[10px]"
              style={
                selectedTiktokUid === null
                  ? { borderColor: color, color }
                  : { borderColor: "rgb(var(--border))", color: "#9a9ea6" }
              }
            >
              合算
            </button>
          )}
          {team.participants.map((p) => (
            <button
              key={p.tiktokUid}
              type="button"
              onClick={() => setSelectedTiktokUid(p.tiktokUid)}
              className="min-w-0 max-w-[72px] flex-1 truncate rounded-full border px-2 py-0.5 text-[10px]"
              style={
                selectedTiktokUid === p.tiktokUid
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
          {contributors.map((c, i) => (
            <ExpandableContributorRow key={c.tiktokHandle} contributor={c} color={color} rank={i + 1} />
          ))}
        </div>
      )}

      {partialNote && <div className="mt-2 text-[10px] leading-snug text-muted">{partialNote}</div>}
    </div>
  );
}

function ExpandableContributorRow({
  contributor,
  color,
  rank,
}: {
  contributor: BattleContributor;
  color: string;
  rank: number;
}) {
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
        <span
          className="w-4 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted"
          style={{ color }}
        >
          {rank}
        </span>
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
          <div key={c.tiktokHandle} className="flex items-center gap-1.5 text-xs">
            <span className="shrink-0">
              <Avatar src={c.profileImageUrl} alt={c.nickname} />
            </span>
            {/* nicknameが未取得(空文字)のgiftは呼び出し元でtiktokHandleへフォールバック済み。
                狭い1カラム幅では名前+@tiktokHandle+コインを並べると折り返して崩れるため、
                ExpandableContributorRow(確定バトル側)と同じく名前を主表示にしtiktokHandle併記はしない。 */}
            <span className="min-w-0 flex-1 truncate font-medium">{c.nickname}</span>
            <span className="shrink-0 font-mono">
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

function ArrowShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}
