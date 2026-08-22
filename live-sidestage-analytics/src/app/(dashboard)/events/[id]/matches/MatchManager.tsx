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
} from "@/event/labels";
import type { DeathmatchRules } from "@/event/deathmatch";

/** 開催日程1件。日時は ISO 文字列(サーバーコンポーネントから Date を渡せないため)。 */
export type SessionRow = {
  name: string | null;
  startAt: string;
  endAt: string;
};

export type EntrantOption = {
  id: string;
  label: string;
  /** 個人戦なら本人1人、チーム戦なら所属メンバー。対戦に出す人をここから選ぶ */
  members: { id: string; label: string }[];
};

/** 1サイドに出せる人数(サーバー側の MAX_SIDE_SIZE と揃える)。 */
const MAX_SIDE_SIZE = 2;

export type LifeRow = {
  subjectId: string;
  label: string;
  /** まだ集計が回っていなければ null */
  current: number | null;
  max: number | null;
  eliminated: boolean;
};

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

/**
 * いま対戦を組むならどの日程か。開催中ならその日程、まだなら次の日程、
 * 全部終わっていたら最後の日程。対戦の初期値に使う。
 */
function currentSession(sessions: SessionRow[]): SessionRow | null {
  if (sessions.length === 0) return null;
  const now = Date.now();
  return (
    sessions.find((s) => now < new Date(s.endAt).getTime()) ?? sessions[sessions.length - 1]
  );
}

/** 開催日程の一覧。対戦の時間枠がどこに収まるべきかを主催者へ示す。 */
function SessionNote({ sessions }: { sessions: SessionRow[] }) {
  if (sessions.length === 0) return null;
  if (sessions.length === 1) {
    return (
      <p className="text-xs text-gray-500">
        開催日程: {formatJst(new Date(sessions[0].startAt))} 〜{" "}
        {formatJst(new Date(sessions[0].endAt))}
      </p>
    );
  }
  return (
    <div className="text-xs text-gray-500">
      <p>開催日程(対戦は1つの日程に収める):</p>
      <ul className="mt-1 space-y-0.5">
        {sessions.map((s, index) => (
          <li key={index}>
            {s.name || `${index + 1}日目`}: {formatJst(new Date(s.startAt))} 〜{" "}
            {formatJst(new Date(s.endAt))}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MatchManager({
  eventId,
  format,
  entryMode,
  sessions,
  entrants,
  matches,
  lives,
  rules,
}: {
  eventId: string;
  format: string;
  entryMode: string;
  /** 開催日程(startAt 昇順)。日程を持たないイベントは外枠1件が入る */
  sessions: SessionRow[];
  entrants: EntrantOption[];
  matches: MatchRow[];
  /** デスマッチのときだけ中身が入る */
  lives: LifeRow[];
  rules: DeathmatchRules;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<string[]>(entrants.map((e) => e.id));
  const [startAt, setStartAt] = useState(() =>
    // 1回戦は日程の中で始めないと表を作れない(サーバー側が拒否する)。
    toJstInputValue(new Date(sessions[0]?.startAt ?? Date.now()))
  );
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

  if (format === "DEATHMATCH") {
    return (
      <div className="space-y-6">
        {error && (
          <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <LifeTable lives={lives} rules={rules} entryMode={entryMode} />

        <RulesEditor eventId={eventId} rules={rules} busy={busy} onSend={send} started={started} />

        <SingleMatchBuilder
          eventId={eventId}
          entryMode={entryMode}
          entrants={entrants}
          lives={lives}
          sessions={sessions}
          busy={busy}
          onSend={send}
        />

        {matches.length === 0 ? (
          <div className="card text-sm text-gray-500">
            まだ対戦がない。上のフォームから組むと、その時間枠のバトルを自動で照合する。
          </div>
        ) : (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-300">対戦</h2>
            {matches.map((match) => (
              <MatchCard
                key={match.id}
                eventId={eventId}
                match={match}
                format={format}
                busy={busy}
                onSend={send}
              />
            ))}
          </section>
        )}
      </div>
    );
  }

  if (format !== "TOURNAMENT") {
    return (
      <div className="card text-sm text-gray-500">
        獲得ダイヤレースには対戦がない。順位は期間中のダイヤだけで決まる。
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
        <SessionNote sessions={sessions} />
        {sessions.length > 1 && (
          <p className="text-xs text-gray-500">
            ラウンドの枠が日程からはみ出す場合は、次の日程の開始時刻へ送る。
          </p>
        )}
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
                format={format}
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

/** 残ライフの一覧。デスマッチの進行状況はこれが主。 */
function LifeTable({
  lives,
  rules,
  entryMode,
}: {
  lives: LifeRow[];
  rules: DeathmatchRules;
  entryMode: string;
}) {
  if (lives.length === 0) {
    return (
      <div className="card text-sm text-gray-500">
        {entryMode === "TEAM"
          ? "まだチームがない。チームを作ってから対戦を組む。"
          : "まだ参加者がいない。参加者を登録してから対戦を組む。"}
      </div>
    );
  }

  const alive = lives.filter((l) => !l.eliminated).length;

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">ライフ</h2>
        <p className="text-xs text-gray-500">
          初期{rules.initialLife} / 敗北 -{rules.lossDelta}
          {rules.winDelta > 0 && ` / 勝利 +${rules.winDelta}`}
          {rules.drawDelta > 0 && ` / 引き分け -${rules.drawDelta}`} ・ 残り{alive}
        </p>
      </div>

      <ul className="space-y-1">
        {lives.map((life) => {
          // まだ集計が回っていない出場者は、まだ何も起きていないので初期値そのもの。
          // 「集計待ち」とだけ出すと、ライフを持っていないように読めてしまう。
          const pending = life.current === null;
          const current = life.current ?? rules.initialLife;
          const max = life.max ?? rules.maxLife ?? rules.initialLife;

          return (
            <li
              key={life.subjectId}
              className={`flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm ${
                life.eliminated ? "bg-white/[0.02] text-gray-600" : "bg-white/5"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{life.label}</span>
              {life.eliminated ? (
                <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-xs">脱落</span>
              ) : (
                <span className="shrink-0 font-mono text-xs" aria-label={`残ライフ ${current}`}>
                  {"♥".repeat(Math.min(current, 10))}
                  <span className="ml-1.5 text-gray-400">
                    {current} / {max}
                  </span>
                  {pending && <span className="ml-1.5 font-sans text-gray-600">初期値</span>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** ライフの増減量。変更すると全期間を計算し直すので、開催中でも安全に変えられる。 */
function RulesEditor({
  eventId,
  rules,
  busy,
  started,
  onSend,
}: {
  eventId: string;
  rules: DeathmatchRules;
  busy: boolean;
  started: boolean;
  onSend: (url: string, body: unknown, method?: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(rules);

  const field = (
    key: "initialLife" | "lossDelta" | "winDelta" | "drawDelta",
    label: string,
    min: number
  ) => (
    <div>
      <label htmlFor={key} className="label">
        {label}
      </label>
      <input
        id={key}
        type="number"
        min={min}
        max={99}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
        className="input-field w-24"
      />
    </div>
  );

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">ライフの増減</h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-gray-400 hover:text-white"
        >
          {open ? "閉じる" : "変更する"}
        </button>
      </div>

      {open && (
        <>
          {started && (
            <p className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 text-xs leading-relaxed text-yellow-200/80">
              すでに確定した対戦がある。ここを変えると
              <strong className="font-semibold">全期間のライフが計算し直される</strong>ため、
              脱落済みの{"　"}出場者が復活したり、その逆が起きたりする。
            </p>
          )}

          <div className="flex flex-wrap items-end gap-3">
            {field("initialLife", "初期ライフ", 1)}
            {field("lossDelta", "敗北で減る", 0)}
            {field("winDelta", "勝利で増える", 0)}
            {field("drawDelta", "引き分けで減る", 0)}
            <div>
              <label htmlFor="maxLife" className="label">
                回復の上限
              </label>
              <input
                id="maxLife"
                type="number"
                min={draft.initialLife}
                max={99}
                value={draft.maxLife ?? draft.initialLife}
                onChange={(e) => setDraft({ ...draft, maxLife: Number(e.target.value) })}
                className="input-field w-24"
              />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await onSend(`/api/events/${eventId}`, { deathmatchRules: draft });
                if (ok) setOpen(false);
              }}
              className="btn-primary shrink-0"
            >
              保存
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** デスマッチの対戦カードを1件ずつ組む。トーナメントのような表は作らない。 */
function SingleMatchBuilder({
  eventId,
  entryMode,
  entrants,
  lives,
  sessions,
  busy,
  onSend,
}: {
  eventId: string;
  entryMode: string;
  entrants: EntrantOption[];
  lives: LifeRow[];
  sessions: SessionRow[];
  busy: boolean;
  onSend: (url: string, body: unknown, method?: string) => Promise<boolean>;
}) {
  const isTeam = entryMode === "TEAM";
  const [sideA, setSideA] = useState("");
  const [sideB, setSideB] = useState("");
  const [membersA, setMembersA] = useState<string[]>([]);
  const [membersB, setMembersB] = useState<string[]>([]);
  const [start, setStart] = useState(() => {
    // 日程の外に枠を作るとサーバー側が拒否する。開催中でなければ日程の開始を初期値にする。
    const session = currentSession(sessions);
    if (!session) return toJstInputValue(new Date());
    const from = new Date(session.startAt);
    return toJstInputValue(from.getTime() > Date.now() ? from : new Date());
  });
  const [windowMin, setWindowMin] = useState(30);

  // 脱落した出場者は組めない(API 側でも弾く)。
  const selectable = entrants.filter(
    (e) => !lives.find((l) => l.subjectId === e.id)?.eliminated
  );

  const label = isTeam ? "チーム" : "参加者";
  const byId = new Map(entrants.map((e) => [e.id, e]));

  /**
   * エントリーを選び直したら出場者もリセットする。
   * メンバーが上限以下のチームは全員を既定にする(選び忘れを防ぐ)。
   */
  function pick(entrantId: string, setSide: (v: string) => void, setMembers: (v: string[]) => void) {
    setSide(entrantId);
    const members = byId.get(entrantId)?.members ?? [];
    setMembers(members.length > 0 && members.length <= MAX_SIDE_SIZE ? members.map((m) => m.id) : []);
  }

  function toggleMember(id: string, members: string[], setMembers: (v: string[]) => void) {
    if (members.includes(id)) setMembers(members.filter((m) => m !== id));
    else if (members.length < MAX_SIDE_SIZE) setMembers([...members, id]);
  }

  const ready =
    !!sideA &&
    !!sideB &&
    membersA.length > 0 &&
    membersA.length === membersB.length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const startDate = new Date(start);
    const end = new Date(startDate.getTime() + windowMin * 60_000);

    const ok = await onSend(
      `/api/events/${eventId}/matches/single`,
      {
        sideA: { teamId: isTeam ? sideA : null, participantIds: membersA },
        sideB: { teamId: isTeam ? sideB : null, participantIds: membersB },
        scheduledStartAt: start,
        scheduledEndAt: toJstInputValue(end),
      },
      "POST"
    );
    if (ok) {
      setSideA("");
      setSideB("");
      setMembersA([]);
      setMembersB([]);
    }
  }

  const sidePicker = (
    key: "A" | "B",
    value: string,
    setValue: (v: string) => void,
    members: string[],
    setMembers: (v: string[]) => void,
    other: string
  ) => {
    const entrant = byId.get(value);
    return (
      <div className="min-w-0 flex-1 space-y-2">
        <label htmlFor={`side${key}`} className="label">
          {label} {key}
        </label>
        <select
          id={`side${key}`}
          value={value}
          onChange={(e) => pick(e.target.value, setValue, setMembers)}
          required
          className="input-field"
        >
          <option value="">選択</option>
          {selectable
            .filter((e) => e.id !== other)
            .map((e) => (
              <option key={e.id} value={e.id} disabled={e.members.length === 0}>
                {e.label}
                {e.members.length === 0 && "（メンバーなし）"}
              </option>
            ))}
        </select>

        {/* チーム戦は出場するメンバーを明示させる。全員をサイドに入れると、
            バトルの検知(room 集合の一致)が成立しなくなるため。 */}
        {isTeam && entrant && (
          <div className="space-y-1 rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-xs text-gray-400">
              出場するメンバー（{MAX_SIDE_SIZE}人まで）
            </p>
            {entrant.members.length === 0 ? (
              <p className="text-xs text-yellow-200/80">
                このチームには参加者がいない。先に参加者をチームへ入れる。
              </p>
            ) : (
              entrant.members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={members.includes(m.id)}
                    onChange={() => toggleMember(m.id, members, setMembers)}
                    className="h-4 w-4 rounded border-white/20 bg-transparent"
                  />
                  <span className="min-w-0 truncate">{m.label}</span>
                </label>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={submit} className="card space-y-4">
      <div>
        <h2 className="font-semibold">対戦を組む</h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">
          時間枠のあいだに実際のバトルが起きると自動で照合する。
          脱落した{label}は選べない。同じ{label}の枠は重ねられない。
          {isTeam && "チームからは実際にバトルへ出るメンバーだけを選ぶ。"}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {sidePicker("A", sideA, setSideA, membersA, setMembersA, sideB)}
        {sidePicker("B", sideB, setSideB, membersB, setMembersB, sideA)}
      </div>

      {sideA && sideB && membersA.length !== membersB.length && (
        <p className="text-xs text-yellow-200/80">
          両サイドの出場人数を揃える（1vs1 か 2vs2）。
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="dmStart" className="label">
            開始
          </label>
          <input
            id="dmStart"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            className="input-field"
          />
        </div>
        <div>
          <label htmlFor="dmWindow" className="label">
            枠(分)
          </label>
          <input
            id="dmWindow"
            type="number"
            min={5}
            max={600}
            value={windowMin}
            onChange={(e) => setWindowMin(Number(e.target.value))}
            className="input-field w-28"
          />
        </div>
        <button type="submit" disabled={busy || !ready} className="btn-primary shrink-0">
          対戦を追加
        </button>
      </div>

      <SessionNote sessions={sessions} />
    </form>
  );
}

function MatchCard({
  eventId,
  match,
  format,
  busy,
  onSend,
}: {
  eventId: string;
  match: MatchRow;
  format: string;
  busy: boolean;
  onSend: (url: string, body: unknown, method?: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(() => toJstInputValue(new Date(match.scheduledStartAt)));
  const [end, setEnd] = useState(() => toJstInputValue(new Date(match.scheduledEndAt)));

  const url = `/api/events/${eventId}/matches/${match.id}`;
  const decided = match.status === "FINISHED";
  // 検知・確定した後は時間枠を動かせない(API 側でも 409 で拒否する)。
  // デスマッチのライフは決着時刻の順に適用するので、確定後に枠を動かすと
  // 過去の対戦順が変わって脱落の結果まで変わってしまう。
  const reschedulable = match.status === "SCHEDULED" || match.status === "NO_SHOW";

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
        {reschedulable ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="ml-auto text-xs text-gray-400 hover:text-white"
          >
            {editing ? "閉じる" : "時間枠を変更"}
          </button>
        ) : (
          <span className="ml-auto text-xs text-gray-600">
            時間枠の変更には検知のやり直しが要る
          </span>
        )}
      </div>

      {editing && reschedulable && (
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

        {/* 引き分けはデスマッチだけ。トーナメントは勝者が出ないと次へ進めない。 */}
        {format === "DEATHMATCH" && !decided && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("引き分けとして確定する。")) return;
              onSend(url, { action: "draw" });
            }}
            className="btn-secondary"
          >
            引き分けにする
          </button>
        )}

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
              if (
                !window.confirm(
                  format === "DEATHMATCH"
                    ? "この対戦を無効にする。ライフは元に戻る。"
                    : "この対戦を無効にする。勝者は次のラウンドへ進まない。"
                )
              )
                return;
              onSend(url, { action: "void" });
            }}
            className="text-xs text-red-400 hover:text-red-300"
          >
            無効にする
          </button>
        )}

        {/* まだ検知していない対戦は取り消せる(デスマッチのみ。表のあるトーナメントは無効化で対応)。 */}
        {format === "DEATHMATCH" && match.status === "SCHEDULED" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("この対戦を取り消す。")) return;
              onSend(url, null, "DELETE");
            }}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            取り消す
          </button>
        )}
      </div>
    </div>
  );
}
