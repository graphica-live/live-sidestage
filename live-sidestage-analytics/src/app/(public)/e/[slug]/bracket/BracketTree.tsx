import { formatJst } from "@/event/datetime";
import { MATCH_STATUS_LABELS, WINNER_DECIDED_BY_LABELS } from "@/event/labels";
import type { BracketEntrantDto, BracketMatchDto, BracketSideDto } from "@/event/public-event";
import { BracketScroller } from "./BracketScroller";

// 決勝を中央に置き、左右へブロックを分けて描くトーナメント表。
//
// ラウンドごとの縦カラムを並べる方式ではなく、**マッチを根とする再帰構造**にしている。
//
//   ノード = [ 子2つ(縦に並べる) ][ コネクタ ][ 自分のカード(items-center) ]
//
// **この形で接続線を引けるのは、カードの高さが全部同じだからである。**
// 高さが揃っていれば完全二分木の各サブツリーの高さも揃うので、子の中心は必ず
// 25% / 75% に来て、コネクタの縦線をその位置へ絶対配置できる。
// 逆に言うと、カードの中身を可変行数にすると幾何が崩れて線がずれる —
// だから状態・不戦勝・時刻は1行にまとめ、カードに固定高を与えている(CARD_H)。
//
// 決勝カラムの「優勝」バナーを絶対配置にしているのも同じ理由。通常フローに置くと
// カラムの中心がカードの中心からずれ、左右から来る線が決勝カードに刺さらなくなる。

/** カード幅。ラウンド見出しの列と揃えるため、見出し側にも同じ幅を使う。 */
const CARD_W = "w-40 sm:w-44";
/** コネクタ列の幅。見出しの間隔にも同じ幅を使う。 */
const CONN_W = "w-5";
/** カード高。中身に関わらずこの高さに固定する(上のコメントを参照)。アイコン+名前を縦積みにした分、h-28から拡張。 */
const CARD_H = "h-36";

type MatchIndex = Map<string, BracketMatchDto>;

function key(round: number, position: number): string {
  return `${round}:${position}`;
}

export function BracketTree({
  roundCount,
  matches,
}: {
  roundCount: number;
  matches: BracketMatchDto[];
}) {
  const index: MatchIndex = new Map(matches.map((m) => [key(m.round, m.position), m]));
  const final = index.get(key(roundCount, 0));

  // 準決勝のサブツリー。roundCount が 1(参加2組)なら決勝しかないので左右は出さない。
  const hasWings = roundCount >= 2;

  return (
    <BracketScroller>
      <div className="min-w-max">
        <RoundHeadings roundCount={roundCount} index={index} hasWings={hasWings} />

        {/* pt は決勝の上に絶対配置する「優勝」バナーのぶん。 */}
        <div className="flex items-center pt-24">
          {hasWings && <MatchNode round={roundCount - 1} position={0} mirror={false} index={index} />}
          {hasWings && <StraightConnector />}

          <div className={`relative ${CARD_W} shrink-0`}>
            <div className="absolute inset-x-0 bottom-full mb-2">
              <Champion final={final} />
            </div>
            {final ? (
              <MatchCard match={final} mirror={false} isFinal />
            ) : (
              <EmptyCard isFinal />
            )}
          </div>

          {hasWings && <StraightConnector />}
          {hasWings && <MatchNode round={roundCount - 1} position={1} mirror index={index} />}
        </div>
      </div>
    </BracketScroller>
  );
}

/**
 * ラウンド見出し。カード幅とコネクタ幅を本体と揃えているので、
 * 同じ順序で並べれば列に重なる。
 */
function RoundHeadings({
  roundCount,
  index,
  hasWings,
}: {
  roundCount: number;
  index: MatchIndex;
  hasWings: boolean;
}) {
  const label = (round: number) => index.get(key(round, 0))?.roundLabel ?? `${round}回戦`;

  // 左ブロックは 1回戦 → 準決勝、右ブロックはその逆順。
  const wings = Array.from({ length: roundCount - 1 }, (_, i) => i + 1);

  return (
    <div className="flex items-end">
      {hasWings &&
        wings.map((round) => (
          <div key={`l${round}`} className="flex">
            <div className={`${CARD_W} shrink-0 text-center text-xs text-gray-500`}>
              {label(round)}
            </div>
            <div className={`${CONN_W} shrink-0`} />
          </div>
        ))}

      <div className={`${CARD_W} shrink-0 text-center text-xs font-semibold text-brand`}>
        {label(roundCount)}
      </div>

      {hasWings &&
        [...wings].reverse().map((round) => (
          <div key={`r${round}`} className="flex">
            <div className={`${CONN_W} shrink-0`} />
            <div className={`${CARD_W} shrink-0 text-center text-xs text-gray-500`}>
              {label(round)}
            </div>
          </div>
        ))}
    </div>
  );
}

function MatchNode({
  round,
  position,
  mirror,
  index,
}: {
  round: number;
  position: number;
  mirror: boolean;
  index: MatchIndex;
}) {
  const match = index.get(key(round, position));
  const card = (
    <div className={`${CARD_W} shrink-0`}>
      {match ? <MatchCard match={match} mirror={mirror} /> : <EmptyCard />}
    </div>
  );

  if (round <= 1) {
    return <div className="flex items-center">{card}</div>;
  }

  return (
    <div className={`flex items-stretch ${mirror ? "flex-row-reverse" : ""}`}>
      {/* 子2つ。高さが等しいので、それぞれの中心が 25% / 75% に来る。 */}
      <div className="flex flex-col">
        <div className="flex flex-1 items-center py-1.5">
          <MatchNode round={round - 1} position={position * 2} mirror={mirror} index={index} />
        </div>
        <div className="flex flex-1 items-center py-1.5">
          <MatchNode round={round - 1} position={position * 2 + 1} mirror={mirror} index={index} />
        </div>
      </div>

      <PairConnector mirror={mirror} />

      <div className="flex items-center">{card}</div>
    </div>
  );
}

/** 子2つ(25% / 75%)を束ねて親(50%)へ繋ぐ線。 */
function PairConnector({ mirror }: { mirror: boolean }) {
  const fromChildren = mirror ? "right-0" : "left-0";
  const spine = mirror ? "right-1/2" : "left-1/2";
  return (
    <div className={`relative ${CONN_W} shrink-0 self-stretch`} aria-hidden>
      <span className={`absolute ${fromChildren} top-1/4 h-px w-1/2 bg-border`} />
      <span className={`absolute ${fromChildren} bottom-1/4 h-px w-1/2 bg-border`} />
      <span className={`absolute ${spine} bottom-1/4 top-1/4 w-px bg-border`} />
      <span className={`absolute ${spine} top-1/2 h-px w-1/2 bg-border`} />
    </div>
  );
}

/** 準決勝と決勝の間。1対1なので横線だけでよい。 */
function StraightConnector() {
  return (
    <div className={`relative ${CONN_W} shrink-0`} aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
    </div>
  );
}

function Champion({ final }: { final: BracketMatchDto | undefined }) {
  const winner = final?.sides.find((s) => s.isWinner) ?? null;

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.2em] text-brand">
        <TrophyIcon />
        優勝
      </span>
      {winner ? (
        <div className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand/40 bg-brand/10 px-2 py-2">
          <EntrantAvatars entrants={winner.entrants} size="md" />
          <span className="min-w-0 truncate text-sm font-semibold">{winner.name}</span>
        </div>
      ) : (
        <div className="w-full rounded-xl border border-dashed border-brand/40 px-2 py-2 text-center text-xs text-gray-600">
          未確定
        </div>
      )}
    </div>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" width={11} height={11} fill="currentColor" aria-hidden>
      <path d="M6 2h12v2h3v3a4 4 0 0 1-4 4h-.35A6.02 6.02 0 0 1 13 15.9V18h3v2H8v-2h3v-2.1A6.02 6.02 0 0 1 7.35 11H7a4 4 0 0 1-4-4V4h3V2Zm0 4H5v1a2 2 0 0 0 2 2V6Zm12 0v3a2 2 0 0 0 2-2V6h-2Z" />
    </svg>
  );
}

/**
 * 対戦カード。**高さを固定している**(理由はファイル冒頭)。
 * そのため行数を増やせない — 不戦勝などの補足は状態の表示に畳んである。
 */
function MatchCard({
  match,
  mirror,
  isFinal,
}: {
  match: BracketMatchDto;
  mirror: boolean;
  isFinal?: boolean;
}) {
  const decided =
    match.winnerDecidedBy && match.winnerDecidedBy !== "AGGREGATE"
      ? WINNER_DECIDED_BY_LABELS[match.winnerDecidedBy]
      : null;
  // 不戦勝は対戦相手がそもそも存在しない。相手側の「未確定」枠は出さず、本人だけを表示する。
  const byeWinner =
    match.winnerDecidedBy === "BYE" ? match.sides.find((s) => s.isWinner) : undefined;

  return (
    <article
      className={`card flex ${CARD_H} flex-col justify-between overflow-hidden p-2.5 ${
        isFinal
          ? "border-2 border-brand/50 bg-gradient-to-b from-brand/10 to-transparent shadow-[0_0_24px_-6px_rgba(254,44,85,0.45)]"
          : ""
      }`}
    >
      <div
        className={`flex items-center justify-between gap-1 text-[10px] text-gray-500 ${
          mirror ? "flex-row-reverse" : ""
        }`}
      >
        <span className="shrink-0">{formatJst(new Date(match.scheduledStartAt))}</span>
        <span className="truncate">
          {decided ?? MATCH_STATUS_LABELS[match.status] ?? match.status}
        </span>
      </div>

      {byeWinner ? (
        <SideRow side={byeWinner} />
      ) : (
        match.sides.map((side) => <SideRow key={side.id} side={side} />)
      )}
    </article>
  );
}

/** アイコンを上、名前を下に縦積みして横幅を節約する。 */
function SideRow({ side }: { side: BracketSideDto }) {
  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-0.5 text-center ${
        side.isWinner ? "bg-brand/10 ring-1 ring-brand/40" : "bg-white/5"
      }`}
    >
      <EntrantAvatars entrants={side.entrants} size="sm" />
      <span className="min-w-0 max-w-full truncate text-sm">
        {side.name ?? <span className="text-gray-600">未確定</span>}
      </span>
    </div>
  );
}

/**
 * ライバーのアイコン。チーム戦は出場メンバー分あるので2つまで重ねて出し、残りは +N で表す。
 *
 * src はいつでも `/api/public/avatar/<participantId>`。**取得に失敗した場合も API 側が
 * プレースホルダ画像を返す**ので、ここで欠損や読み込み失敗を扱う必要がない
 * (TikTok の avatar URL は署名付きで約2日で失効するため、URL をここへ埋めない)。
 */
function EntrantAvatars({
  entrants,
  size,
}: {
  entrants: BracketEntrantDto[];
  size: "sm" | "md";
}) {
  const box = size === "md" ? "h-7 w-7" : "h-6 w-6";
  const shown = entrants.slice(0, 2);
  const rest = entrants.length - shown.length;

  if (entrants.length === 0) {
    return <span className={`${box} shrink-0 rounded-full bg-white/5`} aria-hidden />;
  }

  return (
    <span className="flex shrink-0 items-center -space-x-1.5">
      {shown.map((e) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={e.participantId}
          src={`/api/public/avatar/${e.participantId}`}
          alt=""
          title={e.displayName}
          width={28}
          height={28}
          className={`${box} rounded-full border border-panel bg-white/5 object-cover`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ))}
      {rest > 0 && (
        <span
          className={`${box} flex items-center justify-center rounded-full border border-panel bg-white/10 font-mono text-[9px] text-gray-300`}
          title={entrants.slice(2).map((e) => e.displayName).join(" / ")}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

/** 表に穴があるとき(データ不整合)の枠。通常は出ない。決勝枠は未確定でも装飾を保つため isFinal を受け取る。 */
function EmptyCard({ isFinal }: { isFinal?: boolean } = {}) {
  return (
    <div
      className={`flex ${CARD_H} items-center justify-center rounded-xl border border-dashed text-[10px] text-gray-600 ${
        isFinal ? "border-brand/40" : "border-border"
      }`}
    >
      —
    </div>
  );
}
