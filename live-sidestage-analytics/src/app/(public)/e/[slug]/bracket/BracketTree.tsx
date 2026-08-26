import { avatarFrameStyle, resolveAvatarFrame } from "@/event/avatar-frame";
import { fitBracketName } from "@/event/bracket-name-fit";
import { findSurvivorMatchIds } from "@/event/bracket-survivors";
import { MATCH_STATUS_LABELS, WINNER_DECIDED_BY_LABELS } from "@/event/labels";
import {
  formatNumber,
  type BracketEntrantDto,
  type BracketMatchDto,
  type BracketSideDto,
} from "@/event/public-event";
import { CARD_CLIP, CARD_CLIP_MIRROR, TAG_SKEW, TAG_UNSKEW } from "../battle-ui";
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
// **バトルスコアは行を増やさず、VSバッジを挟むように名前の外側(枠の上端/下端)へ絶対配置している。**
// 名前を名前枠(NAME_BOX_H)ごと枠の上下中央に置くことで、枠の残り(上下それぞれ)にスコアの
// 置き場ができる — 対戦カード上側のサイドは枠の下端(VSの直上)、下側のサイドは枠の上端(VSの直下)。
// 通常フローの行にすると、サイドの境目へ絶対配置している「VS」バッジ(高さ18px)が
// サイドの最終行に7px重なって数字が読めなくなる(過去に実測で確認済み)。おかげで CARD_H も据え置ける。
//
// 決勝カラムの「優勝」バナーを絶対配置にしているのも同じ理由。通常フローに置くと
// カラムの中心がカードの中心からずれ、左右から来る線が決勝カードに刺さらなくなる。
//
// カードの角は右下(mirror時は左下)を斜めに切り落とす(CARD_CLIP)。中央へ向かって
// 刃が入っているように見えるのが狙いで、これがこの表全体で唯一のシェイプ言語。
//
// **カードの主役はライバーの顔である。** アイコンは枠の中に納まる小さな丸ではなく、
// サイド枠(SIDE_H)を丸ごと埋める背景として敷き、枠から上下へはみ出したぶんは枠の
// overflow-hidden が切り落とす。名前はその上へグラデーションごしに重ねる。
// **枠を広げてはいけない** — 顔を大きくするために枠の寸法を触ると上の幾何が崩れる。
// サイド枠・名前枠は px 固定で、名前の文字サイズだけが長さに応じて変わる
// (`fitBracketName`)。行数が変わっても枠の高さは動かないので、上の幾何の前提
// (カード高さが全部同じ)は保たれる。

/** カード幅。ラウンド見出しの列と揃えるため、見出し側にも同じ幅を使う。 */
const CARD_W = "w-40 sm:w-44";
/** コネクタ列の幅。見出しの間隔にも同じ幅を使う。 */
const CONN_W = "w-5";
/**
 * カード高。中身に関わらずこの高さに固定する(上のコメントを参照)。
 * 内訳は p-2.5(20) + 見出し行(約15) + サイド枠2つ(92×2) + サイドの間隔(12)。
 */
const CARD_H = "h-[232px]";
/** サイド枠の高さ。アイコンを全面に敷き、名前枠(NAME_BOX_H)をその上へ重ねる。 */
const SIDE_H = "h-[92px]";
/** 名前枠の高さ。1行(最大22px)でも2行(最大16px)でもこの高さに収まる。 */
const NAME_BOX_H = "h-[36px]";

/**
 * 優勝バナーは対戦カードを 1.2 倍した枠で組む(表の頂点なので一回り大きい)。
 * **名前の枠だけでなく倍率も揃える**こと — `fitBracketName` の第2引数に同じ値を渡す。
 */
const CHAMPION_SCALE = 1.2;
/** 優勝バナーの枠。サイド枠と同じ組み方(アイコンを全面、名前を下へ重ねる)。未確定の枠も同じ高さにする。 */
const CHAMPION_BOX_H = "h-[116px]";
/** 優勝の名前枠。1行(最大26.4px)でも2行(最大19.2px)でも収まる。 */
const CHAMPION_NAME_BOX_H = "h-[44px]";

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
  const blocks = groupPlacementBlocks(matches);

  // まだ敗退していない出場者/チームが勝った試合。決勝は専用の枠+優勝バナーを
  // 既に持つので、決勝の敗者を捕まえる計算には使うが結果には含めない
  // (findSurvivorMatchIds の finalMatchId 引数)。この集合に入っている試合だけ
  // MatchCard が生存ツリーの装飾(赤枠+走光)を出す。
  const survivorMatchIds = findSurvivorMatchIds(matches, final?.id);

  // 準決勝のサブツリー。roundCount が 1(参加2組)なら決勝しかないので左右は出さない。
  const hasWings = roundCount >= 2;

  return (
    <BracketScroller>
      <div className="min-w-max">
        <RoundHeadings roundCount={roundCount} index={index} hasWings={hasWings} />

        {/* pt は決勝の上に絶対配置する「優勝」バナーのぶん(見出し + 枠 + mb-2 で約146px)。 */}
        <div className="flex items-center pt-40">
          {hasWings && (
            <MatchNode
              round={roundCount - 1}
              position={0}
              mirror={false}
              index={index}
              survivorMatchIds={survivorMatchIds}
            />
          )}
          {hasWings && <StraightConnector />}

          <div className={`relative ${CARD_W} shrink-0`}>
            <div className="absolute inset-x-0 bottom-full mb-2">
              <Champion final={final} />
            </div>
            {final ? (
              <MatchCard match={final} mirror={false} isFinal survivorMatchIds={survivorMatchIds} />
            ) : (
              <EmptyCard isFinal />
            )}
          </div>

          {hasWings && <StraightConnector />}
          {hasWings && (
            <MatchNode
              round={roundCount - 1}
              position={1}
              mirror
              index={index}
              survivorMatchIds={survivorMatchIds}
            />
          )}
        </div>

        {blocks.length > 0 && (
        <PlacementSection blocks={blocks} index={index} survivorMatchIds={survivorMatchIds} />
      )}
      </div>
    </BracketScroller>
  );
}

/** 描画に必要なぶんだけのブロック情報。DTO から組み立てる。 */
type PlacementBlockView = {
  depth: number;
  rank: number;
  /** ブロックの決定戦の座標(このブロックの根) */
  root: { round: number; position: number };
  /** ブロックの葉のラウンド。再帰の停止条件に使う */
  minRound: number;
};

/**
 * 順位決定戦の行をブロックごとにまとめる。
 *
 * **round で分けない。** ブロックは本選と同じ座標空間にいて、決定戦は本選の決勝と
 * 同じラウンドにいる。切り出しの根拠は `placement.depth` だけ。
 */
function groupPlacementBlocks(matches: BracketMatchDto[]): PlacementBlockView[] {
  const byDepth = new Map<number, BracketMatchDto[]>();
  for (const match of matches) {
    if (!match.placement) continue;
    const list = byDepth.get(match.placement.depth);
    if (list) list.push(match);
    else byDepth.set(match.placement.depth, [match]);
  }

  return [...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, rows]) => {
      const maxRound = Math.max(...rows.map((r) => r.round));
      const root = rows.find((r) => r.round === maxRound)!;
      return {
        depth,
        rank: rows[0].placement!.rank,
        root: { round: root.round, position: root.position },
        minRound: Math.min(...rows.map((r) => r.round)),
      };
    });
}

/**
 * 順位決定戦。**本選の表とは完全に別のブロック**として決勝の下に置く。
 *
 * 本体の再帰レイアウトへ差し込まないのは幾何のため — 決勝カードの中心がずれると
 * 左右から来る接続線が刺さらなくなる(ファイル冒頭を参照)。ブロックは同じ座標空間に
 * いるので、`MatchNode` をそのまま根から呼べば完全二分木として正しく描ける。
 *
 * `survivorMatchIds` は `MatchNode` の必須 prop なので素通しする。**このブロックの
 * カードは実際には光らない** — ここへ来る出場者は本選で一度負けて `findSurvivorMatchIds`
 * の敗退キーに入っているため。順位決定戦は敗者復活ではないので、それが正しい。
 */
function PlacementSection({
  blocks,
  index,
  survivorMatchIds,
}: {
  blocks: PlacementBlockView[];
  index: MatchIndex;
  survivorMatchIds: Set<string>;
}) {
  return (
    <div className="mt-10 border-t border-white/10 pt-6">
      <h3 className="mb-4 text-[11px] font-bold tracking-[0.2em] text-gray-500">順位決定戦</h3>
      <div className="grid gap-8">
        {blocks.map((block) => {
          const root = index.get(key(block.root.round, block.root.position));
          const winner = root?.sides.find((s) => s.isWinner) ?? null;
          return (
            <div key={block.depth}>
              <div className="mb-2 flex items-center gap-2">
                <RoundLabel>{`${block.rank}位決定戦`}</RoundLabel>
                {winner && (
                  <span className="flex items-center gap-1.5 text-xs text-gray-300">
                    <span className="font-bold text-brand">{block.rank}位</span>
                    <SmallEntrantAvatars entrants={winner.entrants} />
                    <span className="truncate font-medium">{winner.name}</span>
                  </span>
                )}
              </div>
              <div className="flex items-center">
                <MatchNode
                  round={block.root.round}
                  position={block.root.position}
                  minRound={block.minRound}
                  mirror={false}
                  index={index}
                  survivorMatchIds={survivorMatchIds}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 順位決定戦の見出し行に出す小さいアイコン。**通常のドキュメントフローの中**で使うので、
 * `EntrantAvatars`（対戦カードの枠いっぱいへ絶対配置する専用コンポーネント）は使えない。
 */
function SmallEntrantAvatars({ entrants }: { entrants: BracketEntrantDto[] }) {
  const shown = entrants.slice(0, 2);
  const rest = entrants.length - shown.length;

  if (shown.length === 0) return null;

  return (
    <span className="flex shrink-0 items-center -space-x-1.5">
      {shown.map((e) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={e.participantId}
          src={`/api/public/avatar/${e.participantId}`}
          alt=""
          title={e.displayName}
          width={24}
          height={24}
          className="h-6 w-6 rounded-full border border-panel bg-white/5 object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ))}
      {rest > 0 && (
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full border border-panel bg-white/10 font-mono text-[9px] text-gray-300"
          title={entrants.slice(2).map((e) => e.displayName).join(" / ")}
        >
          +{rest}
        </span>
      )}
    </span>
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
  // **position 0 の行が存在するとは限らない。** 主催者が手動で配置した表では、空き枠が
  // 隣り合った枝の行がまるごと作られない。そのラウンドの任意の行からラベルを取る。
  const labels = new Map<number, string>();
  for (const match of index.values()) {
    if (!labels.has(match.round)) labels.set(match.round, match.roundLabel);
  }
  const label = (round: number) => labels.get(round) ?? `${round}回戦`;

  // 左ブロックは 1回戦 → 準決勝、右ブロックはその逆順。
  const wings = Array.from({ length: roundCount - 1 }, (_, i) => i + 1);

  return (
    <div className="flex items-end">
      {hasWings &&
        wings.map((round) => (
          <div key={`l${round}`} className="flex">
            <div className={`${CARD_W} shrink-0`}>
              <RoundLabel>{label(round)}</RoundLabel>
            </div>
            <div className={`${CONN_W} shrink-0`} />
          </div>
        ))}

      <div className={`${CARD_W} shrink-0`}>
        <RoundLabel highlight>{label(roundCount)}</RoundLabel>
      </div>

      {hasWings &&
        [...wings].reverse().map((round) => (
          <div key={`r${round}`} className="flex">
            <div className={`${CONN_W} shrink-0`} />
            <div className={`${CARD_W} shrink-0`}>
              <RoundLabel>{label(round)}</RoundLabel>
            </div>
          </div>
        ))}
    </div>
  );
}

function RoundLabel({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex justify-center">
      <span
        className={`${TAG_SKEW} border px-2.5 py-0.5 text-center text-[11px] font-bold tracking-wide ${
          highlight ? "border-brand/50 bg-brand/10 text-brand" : "border-white/10 text-gray-400"
        }`}
      >
        <span className={`inline-block ${TAG_UNSKEW}`}>{children}</span>
      </span>
    </div>
  );
}

/**
 * `minRound` は再帰の停止ラウンド。本選は 1(1回戦)まで降りるが、順位決定戦のブロックは
 * 葉が本選の途中のラウンドにいるので、そこで止めないと存在しない枠まで描いてしまう。
 */
function MatchNode({
  round,
  position,
  mirror,
  index,
  minRound = 1,
  survivorMatchIds,
}: {
  round: number;
  position: number;
  mirror: boolean;
  index: MatchIndex;
  minRound?: number;
  survivorMatchIds: Set<string>;
}) {
  const match = index.get(key(round, position));
  const card = (
    <div className={`${CARD_W} shrink-0`}>
      {match ? (
        <MatchCard match={match} mirror={mirror} survivorMatchIds={survivorMatchIds} />
      ) : (
        <EmptyCard mirror={mirror} />
      )}
    </div>
  );

  if (round <= minRound) {
    return <div className="flex items-center">{card}</div>;
  }

  return (
    <div className={`flex items-stretch ${mirror ? "flex-row-reverse" : ""}`}>
      {/* 子2つ。高さが等しいので、それぞれの中心が 25% / 75% に来る。 */}
      <div className="flex flex-col">
        <div className="flex flex-1 items-center py-1.5">
          <MatchNode
            round={round - 1}
            position={position * 2}
            mirror={mirror}
            index={index}
            minRound={minRound}
            survivorMatchIds={survivorMatchIds}
          />
        </div>
        <div className="flex flex-1 items-center py-1.5">
          <MatchNode
            round={round - 1}
            position={position * 2 + 1}
            mirror={mirror}
            index={index}
            minRound={minRound}
            survivorMatchIds={survivorMatchIds}
          />
        </div>
      </div>

      <PairConnector mirror={mirror} />

      <div className="flex items-center">{card}</div>
    </div>
  );
}

/** 子2つ(25% / 75%)を束ねて親(50%)へ繋ぐ線。エネルギーラインのような発光ラインにする。 */
function PairConnector({ mirror }: { mirror: boolean }) {
  const fromChildren = mirror ? "right-0" : "left-0";
  const spine = mirror ? "right-1/2" : "left-1/2";
  const line = "bg-brand/40 shadow-[0_0_6px_rgba(254,44,85,0.45)]";
  return (
    <div className={`relative ${CONN_W} shrink-0 self-stretch`} aria-hidden>
      <span className={`absolute ${fromChildren} top-1/4 h-px w-1/2 ${line}`} />
      <span className={`absolute ${fromChildren} bottom-1/4 h-px w-1/2 ${line}`} />
      <span className={`absolute ${spine} bottom-1/4 top-1/4 w-px ${line}`} />
      <span className={`absolute ${spine} top-1/2 h-px w-1/2 ${line}`} />
    </div>
  );
}

/** 準決勝と決勝の間。1対1なので横線だけでよい。 */
function StraightConnector() {
  return (
    <div className={`relative ${CONN_W} shrink-0`} aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-px bg-brand/40 shadow-[0_0_6px_rgba(254,44,85,0.45)]" />
    </div>
  );
}

/**
 * 決勝の上に出る優勝バナー。**対戦カードと同じ組み方(アイコンを全面、名前を下へ重ねる)を
 * 1.2倍(CHAMPION_SCALE)した枠**で、表の頂点であることをサイズで示す。
 *
 * 未確定の枠も同じ高さにしてある。優勝が決まった瞬間にバナーの高さが変わると、
 * 絶対配置の基準(決勝カードの上端)から上へ伸び縮みして表全体が跳ねて見えるため。
 */
function Champion({ final }: { final: BracketMatchDto | undefined }) {
  const winner = final?.sides.find((s) => s.isWinner) ?? null;
  const hasAvatar = (winner?.entrants.length ?? 0) > 0;

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="flex items-center gap-1.5 text-xs font-black tracking-[0.25em] text-brand">
        <TrophyIcon />
        優勝
      </span>
      {winner?.name ? (
        <div
          className={`motion-safe:animate-pulse relative flex ${CHAMPION_BOX_H} w-full flex-col overflow-hidden border-2 border-brand bg-gradient-to-b from-brand/20 to-brand/5 text-center shadow-[0_0_18px_-2px_rgba(254,44,85,0.65)] ${CARD_CLIP} ${
            hasAvatar ? "justify-end" : "justify-center"
          }`}
        >
          <EntrantAvatars entrants={winner.entrants} size="champion" />
          {/* アイコンが枠を覆うと優勝枠のブランド色が消えるので、上から薄く戻す。 */}
          {hasAvatar && (
            <span
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand/30 to-brand/5"
              aria-hidden
            />
          )}
          <div
            className={`relative z-10 px-2 ${
              hasAvatar ? "bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-3" : ""
            }`}
          >
            <FitName name={winner.name} boxH={CHAMPION_NAME_BOX_H} scale={CHAMPION_SCALE} />
          </div>
        </div>
      ) : (
        <div
          className={`flex ${CHAMPION_BOX_H} w-full items-center justify-center border border-dashed border-brand/40 px-2 text-center text-xs text-gray-600 ${CARD_CLIP}`}
        >
          未確定
        </div>
      )}
    </div>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor" aria-hidden>
      <path d="M6 2h12v2h3v3a4 4 0 0 1-4 4h-.35A6.02 6.02 0 0 1 13 15.9V18h3v2H8v-2h3v-2.1A6.02 6.02 0 0 1 7.35 11H7a4 4 0 0 1-4-4V4h3V2Zm0 4H5v1a2 2 0 0 0 2 2V6Zm12 0v3a2 2 0 0 0 2-2V6h-2Z" />
    </svg>
  );
}

/**
 * 名前を枠いっぱいまで拡げ、枠の中で上下中央に置く。枠の高さは固定で、
 * 1行に収まらない長さなら2行に折る(`fitBracketName`)。**枠の高さと `scale` は
 * 必ず対で渡すこと** — 片方だけ変えると2行目が枠からはみ出す。
 */
function FitName({ name, boxH, scale }: { name: string; boxH: string; scale?: number }) {
  const fit = fitBracketName(name, scale);

  return (
    <span className={`flex ${boxH} w-full items-center justify-center overflow-hidden`}>
      <span
        style={{ fontSize: `${fit.fontSizePx}px`, lineHeight: fit.lines === 2 ? 1.05 : 1.15 }}
        className={`w-full font-bold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.9)] ${
          fit.lines === 2 ? "line-clamp-2 [overflow-wrap:anywhere]" : "truncate"
        }`}
      >
        {name}
      </span>
    </span>
  );
}

/**
 * 対戦カード。**高さを固定している**(理由はファイル冒頭)。
 * そのため行数を増やせない — 不戦勝などの補足は状態の表示に畳んである。
 * 2人(2チーム)が両方揃うときだけ、中央に「VS」バッジを重ねる
 * (絶対配置なので高さの budget を消費しない)。
 */
function MatchCard({
  match,
  mirror,
  isFinal,
  survivorMatchIds,
}: {
  match: BracketMatchDto;
  mirror: boolean;
  isFinal?: boolean;
  survivorMatchIds: Set<string>;
}) {
  const decided =
    match.winnerDecidedBy && match.winnerDecidedBy !== "AGGREGATE"
      ? WINNER_DECIDED_BY_LABELS[match.winnerDecidedBy]
      : null;
  // 不戦勝は対戦相手がそもそも存在しない。相手側の「未確定」枠は出さず、本人だけを表示する。
  const byeWinner =
    match.winnerDecidedBy === "BYE" ? match.sides.find((s) => s.isWinner) : undefined;
  const isLive = match.status === "LIVE";
  // 決勝は対象外(findSurvivorMatchIds が結果集合から除いている)。専用の枠+優勝バナーで
  // 既に「ここが頂点」を示せているので、この試合カードにさらに走光を重ねない。
  const isSurvivorWin = survivorMatchIds.has(match.id);
  const clip = mirror ? CARD_CLIP_MIRROR : CARD_CLIP;

  const card = (
    <article
      className={`relative flex ${CARD_H} flex-col overflow-hidden border p-2.5 ${clip} ${
        isLive
          ? `border-red-500/70 bg-gradient-to-b from-red-500/15 to-transparent ${
              isFinal ? "border-2" : ""
            }`
          : isSurvivorWin
            ? "border-red-500/70 bg-gradient-to-b from-red-500/10 to-transparent"
            : isFinal
              ? "border-2 border-brand/60 bg-gradient-to-b from-brand/10 to-transparent shadow-[0_0_24px_-6px_rgba(254,44,85,0.45)]"
              : "border-white/10 bg-panel"
      }`}
    >
      {/* 生き残っているツリーをひと目で追えるように、勝った試合の上辺だけ光を走らせる。
          article 自身の clip-path(CARD_CLIP/CARD_CLIP_MIRROR)の内側に置くことで、
          mirror側の角の切り欠きにも自動で追従する(帯を別コンポーネントで clip し直す必要がない)。 */}
      {isSurvivorWin && <span className="survivor-track absolute inset-x-0 top-0 h-[3px]" aria-hidden />}
      <div
        className={`flex items-center justify-between gap-1 text-[10px] text-gray-500 ${
          mirror ? "flex-row-reverse" : ""
        }`}
      >
        {/* 対戦に個別の時刻は無い。行を増やさずに日程名だけ出す(カード高さは据え置き)。 */}
        <span className="shrink-0 truncate">{match.sessionLabel}</span>
        <span
          className={`truncate font-semibold ${isLive ? "text-red-400" : decided ? "text-brand" : ""}`}
        >
          {decided ?? MATCH_STATUS_LABELS[match.status] ?? match.status}
        </span>
      </div>

      {/* サイド枠は見出し行を除いた残り全部を使い、その中で上下中央に置く。
          不戦勝(枠が1つ)のときもカードの中央に来る。「VS」バッジは2枠の境目 =
          この枠の中央にいるので、gap-3 のぶんだけ名前・アイコンから逃げている。 */}
      <div className="relative flex flex-1 flex-col justify-center gap-3">
        {byeWinner ? (
          <SideRow side={byeWinner} position="top" />
        ) : (
          <>
            {match.sides.map((side, i) => (
              <SideRow key={side.id} side={side} position={i === 0 ? "top" : "bottom"} />
            ))}
            <span
              className={`pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 ${TAG_SKEW} border border-white/15 bg-[#0a0a0a] px-1.5 py-px text-[9px] font-black tracking-wide text-gray-400`}
            >
              <span className={`inline-block ${TAG_UNSKEW}`}>VS</span>
            </span>
          </>
        )}
      </div>
    </article>
  );

  // clip-path を持つ要素に filter を書くと影ごと切り落とされるので、外へにじむ赤い光は
  // clip-path を持たないラッパへ当てる(理由は globals.css の .live-glow)。
  return isLive ? <div className="live-glow">{card}</div> : card;
}

/**
 * アイコンを枠いっぱいに敷き、名前は枠の上下中央に重ねる。**枠の高さ(SIDE_H)と
 * 名前枠の高さ(NAME_BOX_H)は固定**で、名前の文字サイズだけが長さに応じて変わる
 * (`fitBracketName`)。1行で収まらない長さになると2行へ折れるが、枠の高さは動かない。
 *
 * 名前を中央に置くのは見た目のためだけでなく、**VSバッジを挟むスコアの置き場を空けるため**
 * (ファイル冒頭のコメントを参照)。名前枠の外側、上下に残る余白のうち VS に近い側
 * (`position`が"top"なら枠の下端、"bottom"なら枠の上端)へスコアを寄せる。
 *
 * **`overflow-hidden` が要る** — 枠より大きいアイコンのはみ出しをここで切る。付け忘れると
 * 上下のサイドへ顔が侵食する(親カードの overflow-hidden はカードの外しか切らない)。
 *
 * 出場者がまだ居ない枠にはアイコンを敷かない。敷くものが無いところへ下地だけ広げると、
 * 勝者の色(bg-brand/10)が塗り潰されて勝敗が読めなくなる。
 *
 * バトルスコアは TikTok 側の集計値。**帰属できたサイドにしか出さない**ので、片側だけ出ることがある。
 * アイコンの上に乗るので、読めるよう背景を敷いている。
 *
 * `hasLiveStreamer` はバトル前(SCHEDULED)の枠にだけ立つ(DTO側で保証済み)。「今まさに配信中」の
 * 目印として緑のリングで発光させる — LIVE中の対戦(カード全体が赤く光る `.live-glow`)と
 * 混同しないよう、こちらは点滅させず静的にしてある。
 */
function SideRow({ side, position }: { side: BracketSideDto; position: "top" | "bottom" }) {
  const hasAvatar = side.entrants.length > 0;
  const frame = `relative flex ${SIDE_H} flex-col items-center justify-center overflow-hidden text-center ${
    side.isWinner
      ? "bg-brand/10 ring-1 ring-inset ring-brand/40"
      : side.hasLiveStreamer
        ? "bg-emerald-500/10 ring-1 ring-emerald-400/80 shadow-[0_0_10px_rgba(52,211,153,0.55)]"
        : "bg-white/[0.04]"
  }`;

  if (!side.name) {
    return (
      <div className={frame}>
        <span className="text-xs text-gray-600">未確定</span>
      </div>
    );
  }

  return (
    <div className={frame}>
      <EntrantAvatars entrants={side.entrants} size="card" />

      {/* 名前はアイコンの上に重なるので、背後に黒帯を差して読めるようにする。 */}
      {hasAvatar && (
        <span
          className={`pointer-events-none absolute inset-x-0 top-1/2 ${NAME_BOX_H} -translate-y-1/2 bg-black/55`}
          aria-hidden
        />
      )}
      <div className="relative z-10 px-1.5">
        <FitName name={side.name} boxH={NAME_BOX_H} />
      </div>

      {side.tiktokScore !== null && (
        <span
          className={`absolute inset-x-0 z-20 flex justify-center ${
            position === "top" ? "bottom-1" : "top-1"
          }`}
        >
          <span className="rounded-sm bg-black/75 px-2 py-0.5 font-mono text-[13px] font-bold leading-none text-white">
            {formatNumber(side.tiktokScore)}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * ライバーのアイコン。**枠(サイド枠・優勝バナー)を埋める背景レイヤーとして絶対配置する。**
 *
 * 1人なら枠を丸ごと覆う。アイコンは正方形なので枠の幅に合わせると縦がはみ出し、
 * `object-cover` が上下を切り落とす。**中央ではなく上寄りで切る**(`object-[50%_30%]`) —
 * 枠の下半分は名前が覆うので、中央で切ると顔が名前の裏に来る。
 *
 * チーム戦は出場メンバー分あるので2つまで重ねて出し、残りは +N で表す。**こちらは丸のまま
 * 並べる**(枠を覆うのは1人のときだけ)。並べる数だけ直径を落とすのは、枠の幅が決まっていて、
 * 1人のときの大きさのまま並べると顔が枠の左右へ逃げて全員見えなくなるため。
 *
 * src はいつでも `/api/public/avatar/<participantId>`。**取得に失敗した場合も API 側が
 * プレースホルダ画像を返す**ので、ここで欠損や読み込み失敗を扱う必要がない
 * (TikTok の avatar URL は署名付きで約2日で失効するため、URL をここへ埋めない)。
 *
 * **参加者ごとの切り出し位置・ズーム(avatarOffsetX/Y/Zoom)を適用するのは1人表示(count===1)
 * だけ。** 2人以上の丸アイコン表示は `<img>` 自身に `rounded-full` を直接掛けていて
 * `overflow-hidden` のラッパが無いため、transform: scale() を当てると円がborderごと
 * 拡大されレイアウトからはみ出す(SmallEntrantAvatars も同様の理由で対象外)。
 * 対戦カードに表示されるプロフィール画像という要件の対象は1人表示の枠なので、
 * チーム戦の複数人アイコンには意図的に適用しない。
 */
function EntrantAvatars({
  entrants,
  size,
}: {
  entrants: BracketEntrantDto[];
  /** card = 対戦カードの中、champion = 決勝の上の「優勝」バナー(一回り大きい)。 */
  size: "card" | "champion";
}) {
  const champion = size === "champion";
  const shown = entrants.slice(0, 2);
  const rest = entrants.length - shown.length;
  // 実際に横へ並ぶ数(+N のバッジも1つと数える)。
  const count = shown.length + (rest > 0 ? 1 : 0);

  if (count === 0) return null;

  if (count === 1) {
    const only = shown[0];
    const frame = resolveAvatarFrame(only.avatarOffsetX, only.avatarOffsetY, only.avatarZoom);
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/public/avatar/${only.participantId}`}
        alt=""
        title={only.displayName}
        width={champion ? 176 : 156}
        height={champion ? 176 : 156}
        className="absolute inset-0 h-full w-full bg-white/5 object-cover"
        style={avatarFrameStyle(frame)}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    );
  }

  const box =
    count === 2
      ? champion
        ? "h-[76px] w-[76px]"
        : "h-[68px] w-[68px]"
      : champion
        ? "h-[58px] w-[58px]"
        : "h-[52px] w-[52px]";
  const px = count === 2 ? (champion ? 76 : 68) : champion ? 58 : 52;
  const overlap = count === 2 ? "-space-x-3" : "-space-x-2";
  const restText = champion ? "text-xs" : "text-[11px]";

  return (
    <span className={`absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center ${overlap}`}>
      {shown.map((e) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={e.participantId}
          src={`/api/public/avatar/${e.participantId}`}
          alt=""
          title={e.displayName}
          width={px}
          height={px}
          className={`${box} shrink-0 rounded-full border border-panel bg-white/5 object-cover`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ))}
      {rest > 0 && (
        <span
          className={`${box} flex shrink-0 items-center justify-center rounded-full border border-panel bg-white/10 font-mono ${restText} text-gray-300`}
          title={entrants.slice(2).map((e) => e.displayName).join(" / ")}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

/** 表に穴があるとき(データ不整合)の枠。通常は出ない。決勝枠は未確定でも装飾を保つため isFinal を受け取る。 */
function EmptyCard({ isFinal, mirror }: { isFinal?: boolean; mirror?: boolean } = {}) {
  const clip = mirror ? CARD_CLIP_MIRROR : CARD_CLIP;
  return (
    <div
      className={`flex ${CARD_H} items-center justify-center border border-dashed text-[10px] text-gray-600 ${clip} ${
        isFinal ? "border-brand/40" : "border-white/15"
      }`}
    >
      —
    </div>
  );
}
