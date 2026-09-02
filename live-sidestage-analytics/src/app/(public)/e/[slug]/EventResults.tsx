"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatJstStamp } from "@/event/datetime";
import {
  BATTLE_ONLY_SCORING_NOTE,
  BATTLE_ONLY_STANDING_HEADINGS,
  FORMAT_PENDING_NOTES,
  STANDING_HEADINGS,
} from "@/event/labels";
import type {
  ContributionDto,
  EventSnapshot,
  LifeStandingDto,
  StandingDto,
} from "@/event/public-event";
import { formatNumber, formatPoints } from "@/event/public-event";
import type { EventFormat } from "@/event/validation";
import { CARD_CLIP, TAG_SKEW, TAG_UNSKEW } from "./battle-ui";

// 公開ページの結果表示。開催中だけポーリングして更新する。
// 集計ワーカーの間隔が10秒なので、それより短く引いても新しい値は出てこない。
const POLL_INTERVAL_MS = 10_000;

type Snapshot = EventSnapshot & { participantContributions: ContributionDto[] | null };

type Tab = "standings" | "listeners";

export function EventResults({
  slug,
  status,
  entryMode,
  format,
  initial,
}: {
  slug: string;
  status: string;
  entryMode: string;
  format: string;
  initial: Snapshot;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [tab, setTab] = useState<Tab>("standings");
  const [participantId, setParticipantId] = useState<string>("");
  const [sortBy, setSortBy] = useState<"points" | "diamonds">("points");

  const refresh = useCallback(async () => {
    const url = participantId
      ? `/api/public/events/${slug}/snapshot?participantId=${encodeURIComponent(participantId)}`
      : `/api/public/events/${slug}/snapshot`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return;
    setSnapshot(await res.json());
  }, [slug, participantId]);

  // 参加者を切り替えたときは即座に取り直す。
  useEffect(() => {
    if (participantId) void refresh();
  }, [participantId, refresh]);

  useEffect(() => {
    if (status !== "RUNNING") return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status, refresh]);

  const listeners = participantId
    ? (snapshot.participantContributions ?? [])
    : snapshot.eventContributions;

  const sorted =
    sortBy === "diamonds"
      ? [...listeners].sort((a, b) => compareNumeric(b.diamonds, a.diamonds))
      : listeners;

  const notAggregated = snapshot.standings.length === 0 && snapshot.eventContributions.length === 0;

  // 内訳(breakdown)は参加者IDだけを持つので、名前はここで引く。
  // 引けない(参加者が抜けた直後など)ものは表示しない — 支援先の表示と同じ規約。
  const participantNames = useMemo(
    () => new Map(snapshot.participants.map((p) => [p.id, p.displayName])),
    [snapshot.participants]
  );

  // デスマッチの順位はライフで決まる。獲得ダイヤの順位表とは別のものを出す。
  const lives = format === "DEATHMATCH" ? snapshot.lives : null;
  const battleOnly = snapshot.battleOnly;
  const standingHeading =
    (battleOnly ? BATTLE_ONLY_STANDING_HEADINGS[format as EventFormat] : undefined) ??
    STANDING_HEADINGS[format as EventFormat] ??
    "順位";
  const heading = lives ? "ライフ" : standingHeading;
  const pendingNote = FORMAT_PENDING_NOTES[format as EventFormat];

  return (
    <div className="mt-10">
      {pendingNote && (
        <p className={`mb-4 border border-yellow-400/25 bg-yellow-400/5 px-3 py-2 text-xs text-yellow-200/80 ${CARD_CLIP}`}>
          {pendingNote}
        </p>
      )}

      {/* バトル中のみ集計しているイベントは、何が数えられているかを常に明示する。
          空状態の差し替えではなく常時表示にしてあるのは、EventStanding が0点でも
          全参加者ぶん作られるため「集計結果が空」の状態が事実上ありえないから。 */}
      {battleOnly && (
        <p className={`mb-4 border border-border bg-panel px-3 py-2 text-xs text-muted ${CARD_CLIP}`}>
          {BATTLE_ONLY_SCORING_NOTE}
        </p>
      )}

      <div className="flex items-center gap-2.5">
        <span className="h-5 w-1.5 shrink-0 -skew-x-12 bg-brand" aria-hidden />
        <div className="flex gap-1 border-b border-border">
          <TabButton active={tab === "standings"} onClick={() => setTab("standings")}>
            {entryMode === "TEAM" ? `チーム${heading}` : `参加者${heading}`}
          </TabButton>
          <TabButton active={tab === "listeners"} onClick={() => setTab("listeners")}>
            リスナー貢献
          </TabButton>
        </div>
      </div>

      {notAggregated ? (
        <p className={`mt-4 border border-border bg-panel p-4 text-sm text-muted ${CARD_CLIP}`}>
          {status === "SCHEDULED"
            ? "イベントが始まると、順位とリスナーの貢献ランキングがここに出る。"
            : "まだ集計されたギフトがない。"}
        </p>
      ) : tab === "standings" ? (
        lives ? (
          <LifeStandingsTable rows={lives} battleOnly={battleOnly} />
        ) : (
          <StandingsTable rows={snapshot.standings} hasMultiplier={snapshot.hasMultiplier} />
        )
      ) : (
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              value={participantId}
              onChange={(e) => setParticipantId(e.target.value)}
              className="w-auto border border-border bg-panel px-3 py-2 text-xs text-strong focus:border-brand/60 focus:outline-none"
              aria-label="集計対象"
            >
              <option value="">イベント全体</option>
              {snapshot.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>

            {snapshot.hasMultiplier && (
              <div className="flex gap-1">
                <SortButton active={sortBy === "points"} onClick={() => setSortBy("points")}>
                  ポイント順
                </SortButton>
                <SortButton active={sortBy === "diamonds"} onClick={() => setSortBy("diamonds")}>
                  実弾(ダイヤ)順
                </SortButton>
              </div>
            )}
          </div>

          <ListenerTable
            rows={sorted}
            hasMultiplier={snapshot.hasMultiplier}
            participantNames={participantNames}
          />
        </div>
      )}

      {snapshot.lastAggregatedAt && (
        <p className="mt-3 text-xs text-muted">
          {/* toLocaleString はサーバー(UTC)とブラウザ(JST)で結果が変わり、
              SSR したこの行がハイドレーション不一致になる。JST 固定で出す。 */}
          最終集計: {formatJstStamp(new Date(snapshot.lastAggregatedAt))}
          {status === "RUNNING" && "(10秒ごとに更新)"}
        </p>
      )}
    </div>
  );
}

function compareNumeric(a: string, b: string): number {
  // BigInt 由来の文字列なので Number へ落とさずに比較する。
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  if (ai.length !== bi.length) return ai.length - bi.length;
  if (ai !== bi) return ai < bi ? -1 : 1;
  return af === bf ? 0 : af < bf ? -1 : 1;
}

function TabButton({
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
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-brand text-strong"
          : "border-transparent text-muted hover:text-strong"
      }`}
    >
      {children}
    </button>
  );
}

function SortButton({
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
      onClick={onClick}
      className={`${TAG_SKEW} border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        active ? "border-brand/50 bg-brand/10 text-brand" : "border-border text-muted hover:text-strong"
      }`}
    >
      <span className={`inline-block ${TAG_UNSKEW}`}>{children}</span>
    </button>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const medal =
    rank === 1
      ? "border-yellow-400/60 bg-yellow-400/15 text-yellow-300"
      : rank === 2
        ? "border-border bg-black/10 dark:bg-white/10 text-strong"
        : rank === 3
          ? "border-orange-400/50 bg-orange-400/15 text-orange-300"
          : "border-border text-muted";
  return (
    <span
      className={`flex h-8 w-8 shrink-0 -skew-x-12 items-center justify-center border font-mono text-xs font-black tabular-nums ${medal}`}
    >
      <span className={`inline-block ${TAG_UNSKEW}`}>{rank}</span>
    </span>
  );
}

function StandingsTable({ rows, hasMultiplier }: { rows: StandingDto[]; hasMultiplier: boolean }) {
  if (rows.length === 0) {
    return <p className={`mt-4 border border-border bg-panel p-4 text-sm text-muted ${CARD_CLIP}`}>まだ順位がついていない。</p>;
  }

  return (
    <ul className="mt-4 space-y-2">
      {rows.map((r) => (
        <li
          key={r.subjectId}
          className={`flex items-center gap-3 border p-3 ${CARD_CLIP} ${
            r.rank === 1 ? "border-brand/40 bg-brand/[0.06]" : "border-border bg-panel"
          }`}
        >
          <RankBadge rank={r.rank} />
          {r.colorHex && (
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: r.colorHex }}
              aria-hidden
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{r.name}</p>
            {r.sub && <p className="truncate font-mono text-xs text-muted">{r.sub}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-sm tabular-nums">
              {hasMultiplier ? formatPoints(r.points) : formatNumber(r.diamonds)}
              <span className="ml-1 text-xs text-muted">
                {hasMultiplier ? "pt" : "ダイヤ"}
              </span>
            </p>
            {hasMultiplier && (
              <p className="font-mono text-xs text-muted tabular-nums">
                実弾 {formatNumber(r.diamonds)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * デスマッチの順位表。残ライフが多い順(同じなら遅く脱落した順 → 獲得ダイヤ順)。
 * 獲得ダイヤの順位(StandingsTable)とは別物なので、混ぜて表示しない。
 *
 * **同ライフのタイブレークに使うダイヤは集計方式の影響を受ける。** バトル中のみ集計する
 * スナップショットではバトル外のダイヤが入らないので、ライフ順位まで変わりうる。
 * 何のダイヤなのかが読み取れるよう、副表示のラベルを切り替える。
 */
function LifeStandingsTable({ rows, battleOnly }: { rows: LifeStandingDto[]; battleOnly: boolean }) {
  if (rows.length === 0) {
    return <p className={`mt-4 border border-border bg-panel p-4 text-sm text-muted ${CARD_CLIP}`}>まだ順位がついていない。</p>;
  }

  return (
    <ul className="mt-4 space-y-2">
      {rows.map((r) => (
        <li
          key={r.subjectId}
          className={`flex items-center gap-3 border border-border bg-panel p-3 ${CARD_CLIP} ${r.eliminated ? "opacity-50" : ""}`}
        >
          <RankBadge rank={r.rank} />
          {r.colorHex && (
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: r.colorHex }}
              aria-hidden
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{r.name}</p>
            {r.sub && <p className="truncate font-mono text-xs text-muted">{r.sub}</p>}
          </div>
          <div className="shrink-0 text-right">
            {r.eliminated ? (
              <p className="text-sm text-muted">脱落</p>
            ) : (
              <p className="text-sm text-brand" aria-label={`残ライフ ${r.current}`}>
                {"♥".repeat(Math.min(r.current, 10))}
                <span className="ml-1.5 font-mono text-xs text-muted tabular-nums">
                  {r.current} / {r.max}
                </span>
              </p>
            )}
            <p className="font-mono text-xs text-muted tabular-nums">
              {formatNumber(r.diamonds)} {battleOnly ? "バトルダイヤ" : "ダイヤ"}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ListenerTable({
  rows,
  hasMultiplier,
  participantNames,
}: {
  rows: ContributionDto[];
  hasMultiplier: boolean;
  participantNames: Map<string, string>;
}) {
  if (rows.length === 0) {
    return <p className={`border border-border bg-panel p-4 text-sm text-muted ${CARD_CLIP}`}>まだギフトが記録されていない。</p>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.listenerUniqueId} className={`border border-border bg-panel p-3 ${CARD_CLIP}`}>
          <div className="flex items-center gap-3">
            <RankBadge rank={i + 1} />
            {r.profileImageUrl ? (
              // 外部(TikTok CDN)の画像なので next/image の最適化は通さない。
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.profileImageUrl}
                alt=""
                className="h-8 w-8 shrink-0 rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="h-8 w-8 shrink-0 rounded-full bg-black/5 dark:bg-white/5" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{r.nickname}</p>
              <p className="truncate font-mono text-xs text-muted">@{r.listenerUniqueId}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-sm tabular-nums">
                {hasMultiplier ? formatPoints(r.points) : formatNumber(r.diamonds)}
                <span className="ml-1 text-xs text-muted">
                  {hasMultiplier ? "pt" : "ダイヤ"}
                </span>
              </p>
              <p className="font-mono text-xs text-muted tabular-nums">
                {hasMultiplier && `実弾 ${formatNumber(r.diamonds)} ・ `}
                {formatNumber(String(r.giftCount))} 個
              </p>
            </div>
          </div>
          <ListenerParticipants
            row={r}
            hasMultiplier={hasMultiplier}
            participantNames={participantNames}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * そのリスナーが「どの枠へいくら入れたか」。イベント全体の表示でだけ入る
 * (参加者を選んでいるときは自明なので出ない)。
 *
 * 並びはポイント基準なので、実弾(ダイヤ)順に並べ替えても順序は動かない。
 * 名前が長いとモバイルで切れるので、上の行の中ではなくカード幅いっぱいに置いて折り返す。
 *
 * `breakdown` が null の行は内訳を持たない(集計が内訳に未対応だった頃の行 — 終了済みの
 * 過去イベントは再集計されないので残り続ける)。そのときは従来どおり支援先だけを出す。
 */
function ListenerParticipants({
  row,
  hasMultiplier,
  participantNames,
}: {
  row: ContributionDto;
  hasMultiplier: boolean;
  participantNames: Map<string, string>;
}) {
  const entries = row.breakdown?.flatMap((b) => {
    const name = participantNames.get(b.participantId);
    return name ? [{ ...b, name }] : [];
  });

  if (entries && entries.length > 1) {
    return (
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border pt-2 text-xs text-muted">
        {/* 数値の単位(pt / ダイヤ)はカード上段の合計に出ているので繰り返さない。 */}
        <span className="shrink-0 text-muted">内訳</span>
        {entries.map((b) => (
          <span key={b.participantId} className="inline-flex min-w-0 items-baseline gap-1">
            <span className="truncate text-brand/80">{b.name}</span>
            <span className="shrink-0 font-mono tabular-nums text-muted">
              {hasMultiplier ? formatPoints(b.points) : formatNumber(b.diamonds)}
            </span>
          </span>
        ))}
      </div>
    );
  }

  if (!row.topParticipantName) return null;

  return (
    <p className="mt-2 truncate border-t border-border pt-2 text-xs text-muted">
      <span className="text-brand/80">{row.topParticipantName}</span> のリスナー
      {/* 内訳を持たない行だけ、従来の省略表記で人数を伝える。 */}
      {!row.breakdown && row.participantCount > 1 && <>（他{row.participantCount - 1}人にも）</>}
    </p>
  );
}
