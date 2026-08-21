"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONFIDENCE_NOTES,
  MATCH_STATUS_CLASSES,
  MATCH_STATUS_LABELS,
  WINNER_DECIDED_BY_LABELS,
  formatJst,
  toJstInputValue,
} from "@/lib/labels";

export type EntrantOption = { id: string; label: string };

export type MatchSideRow = {
  id: string;
  sideIndex: number;
  /** BigInt を渡せないので文字列。表示のときだけ数値化する */
  diamonds: string;
  label: string;
  empty: boolean;
};

export type MatchRow = {
  id: string;
  round: number;
  position: number;
  roundLabel: string;
  status: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  detectedStartAt: string | null;
  detectedEndAt: string | null;
  detectionConfidence: string | null;
  detectedEndSource: string | null;
  winnerSideId: string | null;
  winnerDecidedBy: string | null;
  sides: MatchSideRow[];
};

const END_SOURCE_NOTES: Record<string, string> = {
  observed: "終了はバトルの終了イベントから取った。",
  duration: "終了イベントを受け取れなかったため、バトルの設定時間から計算した。",
  scheduled: "終了イベントも設定時間も取れなかったため、予定終了時刻を使った。",
};

export function MatchManager({
  eventId,
  format,
  entryMode,
  eventStartAt,
  eventEndAt,
  entrants,
  matches,
}: {
  eventId: string;
  format: string;
  entryMode: string;
  eventStartAt: string;
  eventEndAt: string;
  entrants: EntrantOption[];
  matches: MatchRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<string[]>(entrants.map((e) => e.id));
  const [startAt, setStartAt] = useState(() => toJstInputValue(new Date(eventStartAt)));
  const [matchWindowMin, setMatchWindowMin] = useState(30);
  const [roundIntervalMin, setRoundIntervalMin] = useState(45);

  const byRound = useMemo(() => {
    const groups = new Map<number, MatchRow[]>();
    for (const m of matches) {
      const list = groups.get(m.round);
      if (list) list.push(m);
      else groups.set(m.round, [m]);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [matches]);

  const started = matches.some((m) => m.status !== "SCHEDULED");

  async function send(url: string, body: unknown, method = "PATCH") {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      setError(payload?.error ?? "操作に失敗した。");
      return false;
    }
    router.refresh();
    return true;
  }

  function moveSeed(index: number, delta: number) {
    const next = [...seed];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSeed(next);
  }

  if (format !== "TOURNAMENT") {
    return (
      <div className="card text-sm text-gray-500">
        対戦管理はバトルトーナメントの種目でのみ使う。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">トーナメント表を作る</h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">
            シード順に並べると、上位の
            {entryMode === "TEAM" ? "チーム" : "参加者"}
            どうしが早い段階で当たらないように振り分ける。
            参加数が2のべき乗でない場合、上位から順に1回戦が不戦勝になる。
          </p>
        </div>

        {started && (
          <p className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 text-xs text-yellow-200/80">
            すでに進行中・確定済みの対戦があるため、表は作り直せない。作り直すには
            該当の対戦を無効にすること。
          </p>
        )}

        <ol className="space-y-1">
          {seed.map((id, index) => {
            const entrant = entrants.find((e) => e.id === id);
            if (!entrant) return null;
            return (
              <li
                key={id}
                className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-sm"
              >
                <span className="w-8 shrink-0 text-xs text-gray-500">第{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{entrant.label}</span>
                <button
                  type="button"
                  onClick={() => moveSeed(index, -1)}
                  disabled={busy || index === 0}
                  className="rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-white/10 disabled:opacity-30"
                  aria-label="1つ上へ"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveSeed(index, 1)}
                  disabled={busy || index === seed.length - 1}
                  className="rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-white/10 disabled:opacity-30"
                  aria-label="1つ下へ"
                >
                  ↓
                </button>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="startAt" className="label">
              1回戦の開始
            </label>
            <input
              id="startAt"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label htmlFor="matchWindow" className="label">
              1試合の枠(分)
            </label>
            <input
              id="matchWindow"
              type="number"
              min={5}
              max={600}
              value={matchWindowMin}
              onChange={(e) => setMatchWindowMin(Number(e.target.value))}
              className="input-field w-28"
            />
          </div>
          <div>
            <label htmlFor="roundInterval" className="label">
              ラウンド間隔(分)
            </label>
            <input
              id="roundInterval"
              type="number"
              min={5}
              max={1440}
              value={roundIntervalMin}
              onChange={(e) => setRoundIntervalMin(Number(e.target.value))}
              className="input-field w-28"
            />
          </div>
          <button
            type="button"
            disabled={busy || seed.length < 2 || started}
            onClick={() =>
              send(
                `/api/events/${eventId}/matches`,
                {
                  entrantIds: seed,
                  firstRoundStartAt: startAt,
                  matchWindowMin,
                  roundIntervalMin,
                },
                "POST"
              )
            }
            className="btn-primary shrink-0"
          >
            {matches.length > 0 ? "表を作り直す" : "表を作る"}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          イベント期間: {formatJst(new Date(eventStartAt))} 〜 {formatJst(new Date(eventEndAt))}
        </p>
      </section>

      {byRound.length === 0 ? (
        <div className="card text-sm text-gray-500">
          まだ対戦表がない。シード順を決めて「表を作る」を実行する。
        </div>
      ) : (
        byRound.map(([round, rows]) => (
          <section key={round} className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-300">
              {rows[0]?.roundLabel ?? `${round}回戦`}
            </h2>
            {rows.map((match) => (
              <MatchCard
                key={match.id}
                eventId={eventId}
                match={match}
                busy={busy}
                onSend={send}
              />
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function MatchCard({
  eventId,
  match,
  busy,
  onSend,
}: {
  eventId: string;
  match: MatchRow;
  busy: boolean;
  onSend: (url: string, body: unknown, method?: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(() => toJstInputValue(new Date(match.scheduledStartAt)));
  const [end, setEnd] = useState(() => toJstInputValue(new Date(match.scheduledEndAt)));

  const url = `/api/events/${eventId}/matches/${match.id}`;
  const decided = match.status === "FINISHED";

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            MATCH_STATUS_CLASSES[match.status] ?? "bg-white/5 text-gray-400"
          }`}
        >
          {MATCH_STATUS_LABELS[match.status] ?? match.status}
        </span>
        {match.winnerDecidedBy && (
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-gray-400">
            {WINNER_DECIDED_BY_LABELS[match.winnerDecidedBy] ?? match.winnerDecidedBy}
          </span>
        )}
        <span className="text-xs text-gray-500">
          {formatJst(new Date(match.scheduledStartAt))} 〜{" "}
          {formatJst(new Date(match.scheduledEndAt))}
        </span>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="ml-auto text-xs text-gray-400 hover:text-white"
        >
          {editing ? "閉じる" : "時間枠を変更"}
        </button>
      </div>

      {editing && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-white/5 p-3">
          <div>
            <label className="label">開始</label>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="label">終了</label>
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="input-field"
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const ok = await onSend(url, {
                action: "schedule",
                scheduledStartAt: start,
                scheduledEndAt: end,
              });
              if (ok) setEditing(false);
            }}
            className="btn-secondary"
          >
            保存
          </button>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {match.sides.map((side) => (
          <div
            key={side.id}
            className={`rounded-lg px-3 py-2 ${
              match.winnerSideId === side.id
                ? "bg-brand/10 ring-1 ring-brand/40"
                : "bg-white/5"
            }`}
          >
            <div className="truncate text-sm font-medium">
              {side.empty ? <span className="text-gray-500">未確定</span> : side.label}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">
              {Number(side.diamonds).toLocaleString("ja-JP")} ダイヤ
              {match.winnerSideId === side.id && (
                <span className="ml-2 text-brand">勝者</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {match.detectedStartAt && (
        <p className="text-xs leading-relaxed text-gray-500">
          検知: {formatJst(new Date(match.detectedStartAt))}
          {match.detectedEndAt && ` 〜 ${formatJst(new Date(match.detectedEndAt))}`}
          {match.detectedEndSource && ` — ${END_SOURCE_NOTES[match.detectedEndSource] ?? ""}`}
        </p>
      )}

      {match.status === "NEEDS_REVIEW" && (
        <p className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 text-xs leading-relaxed text-yellow-200/80">
          {match.detectionConfidence
            ? CONFIDENCE_NOTES[match.detectionConfidence]
            : "検知した組み合わせを自動では確定できない。"}
          {match.sides.length > 2 || match.sides.some((s) => s.label.includes(" / "))
            ? " 2vs2 はどちらの組が同じサイドだったかを payload から確認できないため、必ず目視で確認すること。"
            : ""}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {match.status === "NEEDS_REVIEW" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSend(url, { action: "approve" })}
            className="btn-secondary"
          >
            この検知を承認する
          </button>
        )}

        {!decided &&
          match.sides
            .filter((s) => !s.empty)
            .map((side) => (
              <button
                key={side.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`${side.label} を勝者として確定する。`)) return;
                  onSend(url, { action: "confirm", winnerSideId: side.id });
                }}
                className="btn-secondary"
              >
                {side.label} を勝者にする
              </button>
            ))}

        {(match.status === "VOID" || match.status === "NO_SHOW" || decided) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSend(url, { action: "reopen" })}
            className="btn-secondary"
          >
            検知をやり直す
          </button>
        )}

        {match.status !== "VOID" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("この対戦を無効にする。勝者は次のラウンドへ進まない。")) return;
              onSend(url, { action: "void" });
            }}
            className="text-xs text-red-400 hover:text-red-300"
          >
            無効にする
          </button>
        )}
      </div>
    </div>
  );
}
