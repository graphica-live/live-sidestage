"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BracketMethod } from "@/event/bracket";
import {
  CONFIDENCE_NOTES,
  MATCH_STATUS_CLASSES,
  MATCH_STATUS_LABELS,
  WINNER_DECIDED_BY_LABELS,
  formatJst,
  toJstInputValue,
} from "@/event/labels";
import type { DeathmatchRules } from "@/event/deathmatch";
import { bracketSize } from "@/event/bracket";
import { isStartedMatch } from "@/event/match-status";
import { AdminBracketTree } from "./AdminBracketTree";
import { BracketBuildMethodDiagram } from "./BracketBuildMethodDiagram";
import { DestroyBracketDialog, type BracketSummary } from "./DestroyBracketDialog";
import { ManualBracketBuilder } from "./ManualBracketBuilder";

/** 開催日程1件。日時は ISO 文字列(サーバーコンポーネントから Date を渡せないため)。 */
export type SessionRow = {
  id: string;
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
  /**
   * TikTok 側のバトルスコア(`hostScore`)。**サーバー側で整形済みの表示文字列**で、
   * 帰属できなかったサイドは null。当サービスの集計(`diamonds`)とは別物で、勝敗には効かない。
   */
  tiktokScore: string | null;
  label: string;
  empty: boolean;
};

export type MatchRow = {
  id: string;
  round: number;
  position: number;
  roundLabel: string;
  status: string;
  /** この対戦を行う開催日程。対戦に個別の時間枠は無い */
  sessionId: string;
  /** 承認待ちの理由(`EventMatch.rules.reviewReason`)。無ければ null */
  reviewReason: string | null;
  detectedStartAt: string | null;
  detectedEndAt: string | null;
  detectionConfidence: string | null;
  detectedEndSource: string | null;
  winnerSideId: string | null;
  winnerDecidedBy: string | null;
  /** 不戦勝行(`EventMatch.rules.bye`)。サーバー側で評価した真偽値だけ受け取る */
  isBye: boolean;
  sides: MatchSideRow[];
};

const END_SOURCE_NOTES: Record<string, string> = {
  observed: "終了はバトルの終了イベントから取った。",
  duration: "終了イベントを受け取れなかったため、バトルの設定時間から計算した。",
  // 旧データにだけ残る値。新しい検知はこの出所を作らない(予定終了時刻を捏造しない)。
  scheduled: "終了を観測できず、旧仕様の予定終了時刻を使っている。結果を確認すること。",
};

/** 承認待ちの理由。主催者が次に何をすればよいかまで書く。 */
const REVIEW_REASON_NOTES: Record<string, string> = {
  PARTIAL: "片側の room しか観測できなかった。相手が本当にこの対戦か確認する。",
  TEAM_BATTLE: "2vs2 はサイドの組み分けを検証できない。内容を確認して承認する。",
  AMBIGUOUS:
    "同じ組み合わせのバトルが日程内に複数ある。どれが公式か決められないので、勝者を手動で確定する。",
  END_UNKNOWN:
    "バトルの終了を観測できないまま日程が終わった。区間が確定しないので、勝者を手動で確定する。",
};

/** 承認できない(区間が確定していない)理由。サーバー側の UNAPPROVABLE_REASONS と揃える。 */
const UNAPPROVABLE_REASONS = new Set(["AMBIGUOUS", "END_UNKNOWN"]);

/**
 * 破棄したときに何が消えるかを数える。**追加のクエリは要らない** — 画面が持っている
 * 対戦一覧だけで出せる(件数の鮮度はモーダルを開く前の `router.refresh()` が担保する)。
 */
function summarizeBracket(matches: MatchRow[]): BracketSummary {
  const started = matches.filter(isStartedMatch);
  return {
    total: matches.length,
    finished: started.filter((m) => m.status === "FINISHED").length,
    running: started.filter((m) => m.status !== "FINISHED").length,
    bye: matches.filter((m) => m.isBye || m.winnerDecidedBy === "BYE").length,
    // 消える結果の中身。主催者が「本当にこれを捨ててよいか」を判断する材料。
    finishedLabels: started
      .filter((m) => m.status === "FINISHED")
      .map((m) => {
        const winner = m.sides.find((s) => s.id === m.winnerSideId);
        return winner ? `${m.roundLabel}: ${winner.label}` : m.roundLabel;
      }),
  };
}

/**
 * いま対戦を組むならどの日程か。開催中ならその日程、まだなら次の日程、
 * 全部終わっていたら最後の日程。新しい対戦を組むときの既定値に使う。
 */
function currentSession(sessions: SessionRow[]): SessionRow | null {
  if (sessions.length === 0) return null;
  const now = Date.now();
  return sessions.find((s) => now < new Date(s.endAt).getTime()) ?? sessions[sessions.length - 1];
}

/** 日程の表示名。名前が無ければ「N日目」。 */
function sessionLabel(sessions: SessionRow[], sessionId: string | null): string {
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index < 0) return "日程未設定";
  const session = sessions[index];
  return session.name || `${index + 1}日目`;
}

/**
 * 日程の時間帯つきの表示。**select の option にも使うので接尾辞を足さない**
 * (option は幅が固定で、伸ばすと末尾が切れて読めなくなる)。
 */
function sessionRangeLabel(session: SessionRow, index: number): string {
  const name = session.name || `${index + 1}日目`;
  return `${name}: ${formatJst(new Date(session.startAt))} 〜 ${formatJst(new Date(session.endAt))}`;
}

/**
 * トーナメント表を作る手順。**1画面に1つの決定しか出さない**(一本道)。
 *
 * `null` はウィザードを開いていない状態(既存の表を見ているだけ)。
 */
type WizardStep = "session" | "method" | "seed" | "manual";

/**
 * 開催日程の一覧。**日程の中で終了したバトルだけが対象**であることを毎回示す。
 * 各行の「(監視対象)」は、その区間そのものが TikTok バトルの検知対象であることを指す。
 */
function SessionNote({ sessions }: { sessions: SessionRow[] }) {
  if (sessions.length === 0) return null;
  return (
    <div className="text-xs text-gray-500">
      <p>
        開催日程(<strong className="text-amber-300/90">この中で終了したバトルだけ</strong>が
        対戦として扱われる):
      </p>
      <ul className="mt-1 space-y-0.5">
        {sessions.map((s, index) => (
          <li key={s.id}>
            {sessionRangeLabel(s, index)}{" "}
            <span className="whitespace-nowrap text-gray-400">(監視対象)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MatchManager({
  eventId,
  eventTitle,
  eventStatus,
  format,
  entryMode,
  sessions,
  entrants,
  matches,
  lives,
  rules,
  bracketMethod,
}: {
  eventId: string;
  /** 表を破棄するときの確認に入力させる文字列 */
  eventTitle: string;
  eventStatus: string;
  format: string;
  entryMode: string;
  /** 開催日程(startAt 昇順)。対戦はこのどれかに割り当てる */
  sessions: SessionRow[];
  entrants: EntrantOption[];
  matches: MatchRow[];
  /** デスマッチのときだけ中身が入る */
  lives: LifeRow[];
  rules: DeathmatchRules;
  /** トーナメントの不戦勝配分方式(TOURNAMENTのときだけ意味を持つ)。 */
  bracketMethod: BracketMethod;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<string[]>(entrants.map((e) => e.id));
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const seedRowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  // ラウンドごとの開催日程。既定は全ラウンドを最初の日程に置く(1日で終わるのが大半)。
  // ラウンド数は参加者数から決まるので、シード順が変わるたびに作り直す。
  const [roundSessionIds, setRoundSessionIds] = useState<string[]>([]);
  // 既定は表。対戦の進み方はトーナメント表のほうが一目で分かる(一覧は操作用)。
  const [viewMode, setViewMode] = useState<"list" | "bracket">("bracket");
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [destroyOpen, setDestroyOpen] = useState(false);
  // 表がまだ無いなら最初のステップから始める。あるなら既存の表を見せるだけ。
  const [step, setStep] = useState<WizardStep | null>(matches.length === 0 ? "session" : null);
  // 手動配置(1回戦の枠に置いたエントリー)。**戻る操作で失わないようここで持つ。**
  const [placement, setPlacement] = useState<(string | null)[] | null>(null);

  /**
   * 1回戦の枠数。**シード順でも手動配置でも同じ**(参加組数以上で最小の2のべき乗)なので、
   * ラウンド数は作成方法を選ぶ前に決まる — だから日程の割り当てを先に聞ける。
   */
  const frameSize = entrants.length < 2 ? 0 : bracketSize(entrants.length);
  const roundCount = frameSize === 0 ? 0 : Math.log2(frameSize);

  /** 手動配置の現在値。参加組数が変わって枠数が合わなくなったら作り直す。 */
  const slots = useMemo(
    () =>
      placement && placement.length === frameSize
        ? placement
        : Array.from({ length: frameSize }, () => null),
    [placement, frameSize]
  );
  const placedCount = slots.filter((id) => id !== null).length;
  const allPlaced = frameSize > 0 && placedCount === entrants.length;

  /** すでに表があるなら、そのラウンドが今どの日程に置かれているか。 */
  const currentRoundSessionIds = useMemo(() => {
    const byRoundNo = new Map<number, string>();
    for (const match of matches) {
      if (!byRoundNo.has(match.round)) byRoundNo.set(match.round, match.sessionId);
    }
    return byRoundNo;
  }, [matches]);

  /**
   * ラウンド順の日程 id。主催者が選び直していないラウンドは
   * **今の表の割り当て** → 最初の日程 の順で埋める(作り直しで割り当てが勝手に戻らないように)。
   */
  const plannedRoundSessionIds = useMemo(
    () =>
      Array.from(
        { length: roundCount },
        (_, index) =>
          roundSessionIds[index] ||
          currentRoundSessionIds.get(index + 1) ||
          sessions[0]?.id ||
          ""
      ),
    [roundCount, roundSessionIds, currentRoundSessionIds, sessions]
  );

  const byRound = useMemo(() => {
    const groups = new Map<number, MatchRow[]>();
    for (const m of matches) {
      const list = groups.get(m.round);
      if (list) list.push(m);
      else groups.set(m.round, [m]);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [matches]);

  // 判定はサーバーと同じ述語を使う(`match-status.ts`)。不戦勝・NO_SHOW・VOID は
  // 「進行済み」に数えない。ここで使うのは「破棄すると何が消えるか」の表示だけ。
  const started = matches.some(isStartedMatch);
  const selectedMatch = matches.find((m) => m.id === selectedMatchId) ?? null;

  const destroySummary = useMemo(() => summarizeBracket(matches), [matches]);

  /**
   * 表があるあいだは作成ウィザードを出さない。**表がある状態でできるのは破棄だけ**で、
   * 作り直しは「破棄 → 改めて表を作る」の2手順に分けてある。
   *
   * `step` はクライアントの state なので、別タブが表を作った場合(こちらの POST は 409)にも
   * ここで畳む。`step` 自体は残しておき、破棄で表が消えたときに勝手に作成画面へ入らないようにする
   * (もう一度「表を作る」を押させる)。
   */
  const wizardStep = matches.length === 0 ? step : null;

  /**
   * 破棄ダイアログを開く。**開く前に必ず最新を読み直す。**
   * event-worker が10秒ごとに status を書き換えるので、画面の件数はすぐ古くなる。
   * 古い件数のまま「確定3件が消える」と見せて確認させない。
   *
   * `keepError` はサーバーに弾かれて開き直すとき。**理由を消さない** — 消すと
   * 「押したのに何も起きなかった」ようにしか見えない。
   */
  function openDestroyDialog(keepError = false) {
    router.refresh();
    if (!keepError) setError(null);
    setDestroyOpen(true);
  }

  /**
   * 作成リクエストの中身。**シード順(`entrantIds`)と手動配置(`placement`)は排他**で、
   * サーバーは両方来たら 400 を返す。いま開いている作成画面がどちらかで決める。
   *
   * 表を消すのは破棄(DELETE)だけになったので、確認(イベント名)も `expectedMatchIds` も
   * 送らない。既存の表があれば作成そのものが 409 で弾かれる。
   */
  function bracketBody() {
    const base = { roundSessionIds: plannedRoundSessionIds };
    return wizardStep === "manual" ? { ...base, placement: slots } : { ...base, entrantIds: seed };
  }

  async function submitBracket() {
    const ok = await send(
      `/api/events/${eventId}/matches`,
      bracketBody(),
      "POST",
      // 別タブが先に作っていた場合(BRACKET_EXISTS)。最新を読み直せば、その表が画面に出て
      // ウィザードは畳まれる。
      { onConflict: () => router.refresh() }
    );
    // 作れたらウィザードを閉じて、できた表そのものを見せる。
    if (ok) setStep(null);
  }

  async function destroyBracket(confirm: string) {
    const ok = await send(
      `/api/events/${eventId}/matches`,
      { confirm, expectedMatchIds: matches.map((m) => m.id) },
      "DELETE",
      { onConflict: () => openDestroyDialog(true) }
    );
    if (ok) setDestroyOpen(false);
  }

  async function send(
    url: string,
    body: unknown,
    method = "PATCH",
    options: { onConflict?: (code: string | null) => void } = {}
  ) {
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
      const code = typeof payload?.code === "string" ? payload.code : null;
      if (
        options.onConflict &&
        (code === "BRACKET_EXISTS" || code === "BRACKET_CHANGED" || code === "CONFIRM_MISMATCH")
      ) {
        setError(payload?.error ?? null);
        options.onConflict(code);
        return false;
      }
      setError(payload?.error ?? "操作に失敗した。");
      return false;
    }
    router.refresh();
    return true;
  }

  function handleSeedDragStart(e: React.DragEvent, index: number, id: string) {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    const row = seedRowRefs.current.get(id);
    if (row) e.dataTransfer.setDragImage(row, row.offsetWidth / 2, row.offsetHeight / 2);
  }

  function handleSeedDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (index !== dragOverIndex) setDragOverIndex(index);
  }

  function handleSeedDrop(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      const next = [...seed];
      const [moved] = next.splice(draggedIndex, 1);
      next.splice(index, 0, moved);
      setSeed(next);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  function handleSeedDragEnd() {
    setDraggedIndex(null);
    setDragOverIndex(null);
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
                sessions={sessions}
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
      {error && !destroyOpen && (
        <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {destroyOpen && (
        <DestroyBracketDialog
          eventTitle={eventTitle}
          eventStatus={eventStatus}
          summary={destroySummary}
          busy={busy}
          error={error}
          onClose={() => {
            setDestroyOpen(false);
            setError(null);
          }}
          onDestroy={(confirm) => void destroyBracket(confirm)}
        />
      )}

      {wizardStep === null && (
        <section className="card space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold">トーナメント表</h2>
              <p className="mt-1 text-xs leading-relaxed text-gray-400">
                {matches.length === 0
                  ? "まだ表がない。日程を決めるところから順に作る。"
                  : `対戦カードが${matches.length}件ある。組み合わせを変えるには、いまの表を破棄してから作り直す。`}
                {started &&
                  `進行中・確定済みが${destroySummary.finished + destroySummary.running}件あり、破棄すると消える。`}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {matches.length === 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStep("session")}
                  className="btn-primary"
                >
                  表を作る
                </button>
              ) : (
                // **参加が2組未満に減っても押せる。** ここへ到達できないと、表を作れない
                // 状態のときに公開ページの古い表を消せなくなる。
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openDestroyDialog()}
                  className="rounded-lg border border-red-400/40 px-3 py-2 text-sm text-red-300 transition hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  表を破棄する
                </button>
              )}
            </div>
          </div>
          {matches.length > 0 && <SessionNote sessions={sessions} />}
        </section>
      )}

      {wizardStep === "session" && (
        <WizardFrame
          stepNo={1}
          title="1. どの日程で行うか"
          description="対戦ごとの開始・終了時刻は設定しない。割り当てた日程の中で終了したバトルを、組み合わせで照合する。"
        >
          {sessions.length === 0 ? (
            <p className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 text-xs text-yellow-200/80">
              開催日程がまだない。先にイベント設定で日程を登録する。
            </p>
          ) : entrants.length < 2 ? (
            <p className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 text-xs text-yellow-200/80">
              {entryMode === "TEAM" ? "チーム" : "参加者"}が2組未満。
              先に登録してから表を作る。
            </p>
          ) : sessions.length === 1 ? (
            <div className="rounded-lg bg-white/5 px-3 py-2 text-sm">
              <p>{sessionRangeLabel(sessions[0], 0)}</p>
              <p className="mt-1 text-xs text-gray-500">
                日程は1つだけなので、全{roundCount}ラウンドをこの日程で行う。
              </p>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: roundCount }, (_, index) => (
                <div key={index}>
                  <label htmlFor={`round-session-${index}`} className="label">
                    {index + 1}回戦の日程
                  </label>
                  <select
                    id={`round-session-${index}`}
                    className="input-field"
                    value={plannedRoundSessionIds[index] ?? ""}
                    onChange={(e) => {
                      const next = [...plannedRoundSessionIds];
                      next[index] = e.target.value;
                      // 後のラウンドが前より early にならないよう、以降を引きずって揃える。
                      const picked = sessions.findIndex((s) => s.id === e.target.value);
                      for (let i = index + 1; i < next.length; i++) {
                        const current = sessions.findIndex((s) => s.id === next[i]);
                        if (current < picked) next[i] = e.target.value;
                      }
                      setRoundSessionIds(next);
                    }}
                  >
                    {sessions.map((session, i) => (
                      <option key={session.id} value={session.id}>
                        {sessionRangeLabel(session, i)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          <SessionNote sessions={sessions} />

          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy || sessions.length === 0 || entrants.length < 2}
              onClick={() => setStep("method")}
              className="btn-primary"
            >
              次へ
            </button>
          </div>
        </WizardFrame>
      )}

      {wizardStep === "method" && (
        <WizardFrame
          stepNo={2}
          title="2. どう作るか"
          description={`${entrants.length}組を${frameSize}枠に入れる。決め方を選ぶ。`}
          onBack={() => setStep("session")}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <MethodChoice
              kind="SEED"
              title="シード順から作る"
              lead={`強い順に並べるだけ。上位の${entryMode === "TEAM" ? "チーム" : "参加者"}どうしが早い段階で当たらないよう自動で振り分ける。`}
              points={[
                "並べ替えはドラッグだけ",
                bracketMethod === "STAGED_BYE"
                  ? "不戦勝は各ラウンド最大1組(段階的不戦勝方式)"
                  : "不戦勝は1回戦にまとめる(標準シード方式)",
              ]}
              onSelect={() => setStep("seed")}
            />
            <MethodChoice
              kind="MANUAL"
              title="手動で配置する"
              lead="空欄の表へ自分で置く。誰と誰を当てるかを完全に決めたいとき。"
              points={["1回戦の枠へドラッグして配置", "空けたままの枠は不戦勝になる"]}
              onSelect={() => setStep("manual")}
            />
          </div>
        </WizardFrame>
      )}

      {wizardStep === "seed" && (
        <WizardFrame
          stepNo={3}
          title="3. シード順を決める"
          description={
            bracketMethod === "STAGED_BYE"
              ? "上から強い順に並べる。参加数が2のべき乗でない場合、各ラウンド最大1組ずつ不戦勝になる(段階的不戦勝方式)。"
              : "上から強い順に並べる。参加数が2のべき乗でない場合、上位から順に1回戦が不戦勝になる(標準シード方式)。"
          }
          onBack={() => setStep("method")}
        >
          <SelectedSessions sessions={sessions} roundSessionIds={plannedRoundSessionIds} />

          <ol className="space-y-1">
          {seed.map((id, index) => {
            const entrant = entrants.find((e) => e.id === id);
            if (!entrant) return null;
            const isDragging = draggedIndex === index;
            const isDragOver =
              dragOverIndex === index && draggedIndex !== null && draggedIndex !== index;
            return (
              <li
                key={id}
                ref={(el) => {
                  if (el) seedRowRefs.current.set(id, el);
                  else seedRowRefs.current.delete(id);
                }}
                onDragOver={(e) => handleSeedDragOver(e, index)}
                onDrop={(e) => handleSeedDrop(e, index)}
                onDragEnd={handleSeedDragEnd}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                  isDragging ? "opacity-40" : "bg-white/5"
                } ${isDragOver ? "ring-1 ring-brand/60" : ""}`}
              >
                <span
                  draggable={!busy}
                  onDragStart={(e) => handleSeedDragStart(e, index, id)}
                  aria-label="ドラッグして並び替え"
                  className={`shrink-0 text-gray-500 hover:text-gray-300 ${
                    busy ? "cursor-not-allowed opacity-30" : "cursor-grab active:cursor-grabbing"
                  }`}
                >
                  <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
                    <circle cx="2" cy="2" r="1.5" />
                    <circle cx="8" cy="2" r="1.5" />
                    <circle cx="2" cy="8" r="1.5" />
                    <circle cx="8" cy="8" r="1.5" />
                    <circle cx="2" cy="14" r="1.5" />
                    <circle cx="8" cy="14" r="1.5" />
                  </svg>
                </span>
                <span className="w-8 shrink-0 text-xs text-gray-500">第{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{entrant.label}</span>
              </li>
            );
          })}
          </ol>

          <div className="flex justify-end">
            <BuildButton busy={busy} disabled={seed.length < 2} onBuild={() => void submitBracket()} />
          </div>
        </WizardFrame>
      )}

      {wizardStep === "manual" && (
        <WizardFrame
          stepNo={3}
          title="3. 枠へ配置する"
          description={`1回戦の枠は${frameSize}。${entrants.length}組すべてを置くと作れる。空けたままの枠は不戦勝になる。`}
          onBack={() => setStep("method")}
        >
          <SelectedSessions sessions={sessions} roundSessionIds={plannedRoundSessionIds} />

          <ManualBracketBuilder
            entrants={entrants}
            slots={slots}
            disabled={busy}
            onChange={setPlacement}
          />

          <div className="flex flex-wrap items-center justify-end gap-3">
            {!allPlaced && (
              <p className="text-xs text-gray-500">
                残り {entrants.length - placedCount} 組を配置すると作れる。
              </p>
            )}
            <BuildButton busy={busy} disabled={!allPlaced} onBuild={() => void submitBracket()} />
          </div>
        </WizardFrame>
      )}

      {byRound.length === 0 ? (
        wizardStep === null && (
          <div className="card text-sm text-gray-500">
            まだ対戦表がない。「表を作る」から日程・作成方法の順に決める。
          </div>
        )
      ) : (
        <>
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`rounded-full px-3 py-1 ${
                viewMode === "list" ? "bg-brand/20 text-brand" : "text-gray-400 hover:bg-white/5"
              }`}
            >
              一覧
            </button>
            <button
              type="button"
              onClick={() => setViewMode("bracket")}
              className={`rounded-full px-3 py-1 ${
                viewMode === "bracket" ? "bg-brand/20 text-brand" : "text-gray-400 hover:bg-white/5"
              }`}
            >
              表
            </button>
          </div>

          {viewMode === "list" ? (
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
                    sessions={sessions}
                    busy={busy}
                    onSend={send}
                  />
                ))}
              </section>
            ))
          ) : (
            <AdminBracketTree matches={matches} onSelect={setSelectedMatchId} />
          )}
        </>
      )}

      {selectedMatch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelectedMatchId(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-panel p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedMatchId(null)}
                className="btn-ghost text-xs"
              >
                閉じる
              </button>
            </div>
            <MatchCard
              eventId={eventId}
              match={selectedMatch}
              format={format}
              sessions={sessions}
              busy={busy}
              onSend={send}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ウィザードの1ステップぶんの枠。**1画面に決定を1つしか置かない**ための器で、
 * 現在地(N/3)と戻る導線をここに集約する。
 *
 * 「やめる」は無い。ウィザードが出るのは表が1件も無いときだけで、抜けた先に見せるものが
 * 「まだ表がない」以外に無いため。
 */
function WizardFrame({
  stepNo,
  title,
  description,
  onBack,
  children,
}: {
  stepNo: number;
  title: string;
  description?: string;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="card space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {onBack && (
            <button type="button" onClick={onBack} className="text-gray-400 hover:text-white">
              ← 戻る
            </button>
          )}
          <span className="rounded-full bg-white/5 px-2 py-0.5">ステップ {stepNo} / 3</span>
        </div>
        <h2 className="mt-2 font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-gray-400">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/** 作成方法の選択肢。図解つきで大きく見せて、押したらその作成画面へ入る。 */
function MethodChoice({
  kind,
  title,
  lead,
  points,
  onSelect,
}: {
  kind: "SEED" | "MANUAL";
  title: string;
  lead: string;
  points: string[];
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col gap-3 rounded-xl border border-border bg-white/[0.02] p-4 text-left transition hover:border-brand/50 hover:bg-white/[0.05]"
    >
      <div className="rounded-lg bg-black/20 p-3">
        <BracketBuildMethodDiagram kind={kind} />
      </div>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">{lead}</p>
        <ul className="mt-2 space-y-0.5 text-xs text-gray-500">
          {points.map((point) => (
            <li key={point}>・{point}</li>
          ))}
        </ul>
      </div>
      <span className="mt-auto text-xs font-medium text-brand">この方法で作る →</span>
    </button>
  );
}

/** ステップ1で決めた日程。作成画面でも見えるようにしておく(戻らなくても確認できる)。 */
function SelectedSessions({
  sessions,
  roundSessionIds,
}: {
  sessions: SessionRow[];
  roundSessionIds: string[];
}) {
  if (sessions.length <= 1) return null;
  return (
    <p className="rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-400">
      日程:{" "}
      {roundSessionIds
        .map((id, index) => `${index + 1}回戦 ${sessionLabel(sessions, id)}`)
        .join(" / ")}
    </p>
  );
}

/**
 * 表を作るボタン。**押した先で表が消えることはない** — 既存の表があるイベントでは
 * ウィザードそのものが出ない(あれば先に破棄する)。
 */
function BuildButton({
  busy,
  disabled,
  onBuild,
}: {
  busy: boolean;
  disabled: boolean;
  onBuild: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onBuild}
      className="btn-primary shrink-0"
    >
      この内容で表を作る
    </button>
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
  // 対戦は個別の時間枠を持たない。どの開催日程で行うかだけを選ぶ。
  const [sessionId, setSessionId] = useState(() => currentSession(sessions)?.id ?? "");

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

    const ok = await onSend(
      `/api/events/${eventId}/matches/single`,
      {
        sideA: { teamId: isTeam ? sideA : null, participantIds: membersA },
        sideB: { teamId: isTeam ? sideB : null, participantIds: membersB },
        sessionId,
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
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="dmSession" className="label">
            開催日程
          </label>
          <select
            id="dmSession"
            className="input-field"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            required
          >
            {sessions.map((session, index) => (
              <option key={session.id} value={session.id}>
                {sessionRangeLabel(session, index)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={busy || !ready || !sessionId}
          className="btn-primary shrink-0"
        >
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
  sessions,
  busy,
  onSend,
}: {
  eventId: string;
  match: MatchRow;
  format: string;
  /** 開催日程。カードの表示と、割り当ての変更に使う */
  sessions: SessionRow[];
  busy: boolean;
  onSend: (url: string, body: unknown, method?: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [sessionId, setSessionId] = useState(match.sessionId);

  const url = `/api/events/${eventId}/matches/${match.id}`;
  const decided = match.status === "FINISHED";
  // 検知・確定した後は日程を動かせない(API 側でも 409 で拒否する)。
  // 日程は検知の対象区間そのもので、動かすと確定済みの検知が区間の外に出る。
  const reschedulable = match.status === "SCHEDULED" || match.status === "NO_SHOW";
  // 区間が確定していない検知は承認させない(サーバー側も 409 で拒否する)。
  const unapprovable = !!match.reviewReason && UNAPPROVABLE_REASONS.has(match.reviewReason);
  // バトルの開始を検知した対戦。トーナメント表と同じ赤い発光で一覧でも目立たせる。
  const isLive = match.status === "LIVE";

  return (
    <div className={`card space-y-3 ${isLive ? "border-red-500/70 live-glow" : ""}`}>
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
        <span className="text-xs text-gray-500">{sessionLabel(sessions, match.sessionId)}</span>
        {reschedulable && sessions.length > 1 ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="ml-auto text-xs text-gray-400 hover:text-white"
          >
            {editing ? "閉じる" : "日程を変更"}
          </button>
        ) : !reschedulable ? (
          <span className="ml-auto text-xs text-gray-600">
            日程の変更には検知のやり直しが要る
          </span>
        ) : null}
      </div>

      {editing && reschedulable && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-white/5 p-3">
          <div className="min-w-[14rem] flex-1">
            <label className="label">開催日程</label>
            <select
              className="input-field"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            >
              {sessions.map((session, index) => (
                <option key={session.id} value={session.id}>
                  {sessionRangeLabel(session, index)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const ok = await onSend(url, { action: "assignSession", sessionId });
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
              {/* TikTok 側のバトルスコア。勝敗は左のダイヤで決まるので、別物と分かるよう並べる。 */}
              {side.tiktokScore !== null && (
                <span className="ml-2 text-gray-500">TikTok {side.tiktokScore}</span>
              )}
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
          {(match.reviewReason && REVIEW_REASON_NOTES[match.reviewReason]) ??
            (match.detectionConfidence
              ? CONFIDENCE_NOTES[match.detectionConfidence]
              : "検知した組み合わせを自動では確定できない。")}
          {match.sides.length > 2 || match.sides.some((s) => s.label.includes(" / "))
            ? " 2vs2 はどちらの組が同じサイドだったかを payload から確認できないため、必ず目視で確認すること。"
            : ""}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {match.status === "NEEDS_REVIEW" && !unapprovable && (
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
