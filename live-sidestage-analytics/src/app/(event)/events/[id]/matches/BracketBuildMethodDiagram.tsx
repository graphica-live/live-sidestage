// 「シード順から作る」/「手動で配置する」の説明用の図解。
//
// `BracketMethodDiagram.tsx`(不戦勝の配分方式の図解)と同じ流儀で、**説明専用の素朴な SVG**に
// している。本番のトーナメント表(`AdminBracketTree` / 公開の `BracketTree`)は
// カード高さ固定・完全二分木前提という幾何の制約を持つが、この図はそれを一切引き継がない。

const BOX_W = 30;
const BOX_H = 16;
const ROW_GAP = 6;
const PAD = 4;

/** 葉4つ → 2 → 決勝、の3列。x はこの図の中だけの座標。 */
const LEAF_X = PAD;
const MID_X = 78;
const FINAL_X = 130;

function leafY(index: number): number {
  return PAD + index * (BOX_H + ROW_GAP);
}

/** 葉2つ(index*2, index*2+1)の中点。 */
function midY(index: number): number {
  return (leafY(index * 2) + leafY(index * 2 + 1)) / 2;
}

const FINAL_Y = (midY(0) + midY(1)) / 2;
const HEIGHT = leafY(3) + BOX_H + PAD;
const WIDTH = FINAL_X + BOX_W + PAD;

function Box({
  x,
  y,
  label,
  variant = "filled",
}: {
  x: number;
  y: number;
  label?: string;
  variant?: "filled" | "empty" | "highlight";
}) {
  return (
    <>
      <rect
        x={x}
        y={y}
        width={BOX_W}
        height={BOX_H}
        rx={4}
        className={
          variant === "filled"
            ? "fill-panel stroke-border"
            : variant === "highlight"
              ? "fill-brand/15 stroke-brand"
              : "fill-transparent stroke-border"
        }
        strokeWidth={1}
        strokeDasharray={variant === "empty" ? "3 2" : undefined}
      />
      {label && (
        <text
          x={x + BOX_W / 2}
          y={y + BOX_H / 2 + 3}
          textAnchor="middle"
          className={variant === "highlight" ? "fill-brand text-[8px]" : "fill-gray-200 text-[8px]"}
        >
          {label}
        </text>
      )}
    </>
  );
}

/** 葉 → 中間 → 決勝 のコネクタ。説明用なので直線でよい。 */
function Connectors() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <line
          key={`l${i}`}
          x1={LEAF_X + BOX_W}
          y1={leafY(i) + BOX_H / 2}
          x2={MID_X}
          y2={midY(Math.floor(i / 2)) + BOX_H / 2}
          className="stroke-border"
          strokeWidth={1}
        />
      ))}
      {[0, 1].map((i) => (
        <line
          key={`m${i}`}
          x1={MID_X + BOX_W}
          y1={midY(i) + BOX_H / 2}
          x2={FINAL_X}
          y2={FINAL_Y + BOX_H / 2}
          className="stroke-border"
          strokeWidth={1}
        />
      ))}
    </>
  );
}

/** シード順の入力(順位の並び)を表す左の列と、そこから表への矢印。 */
const LIST_W = 22;
const LIST_X = PAD;
const ARROW_X = LIST_X + LIST_W + 4;
const SEED_OFFSET = ARROW_X + 16;

/**
 * シード順から作る図。強い順に並べた4組が、上位どうしが早く当たらない位置
 * (①対④ / ②対③)へ自動で割り振られる様子。左が入力(順位)、右が出来上がる表。
 */
function SeedDiagram() {
  const seeded = ["①", "④", "②", "③"];
  const arrowY = (leafY(1) + leafY(2)) / 2 + BOX_H / 2;
  return (
    <svg
      viewBox={`0 0 ${WIDTH + SEED_OFFSET} ${HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label="強い順に並べた4組が、1回戦で①対④・②対③になるよう自動で振り分けられる図"
    >
      {["①", "②", "③", "④"].map((label, i) => (
        <g key={label}>
          <rect
            x={LIST_X}
            y={leafY(i)}
            width={LIST_W}
            height={BOX_H}
            rx={4}
            className="fill-panel stroke-border"
            strokeWidth={1}
          />
          <text
            x={LIST_X + LIST_W / 2}
            y={leafY(i) + BOX_H / 2 + 3}
            textAnchor="middle"
            className="fill-gray-200 text-[8px]"
          >
            {label}
          </text>
        </g>
      ))}

      {/* 「並べた順」→「表」への自動振り分け。 */}
      <line
        x1={ARROW_X}
        y1={arrowY}
        x2={ARROW_X + 12}
        y2={arrowY}
        className="stroke-brand"
        strokeWidth={1}
      />
      <path
        d={`M${ARROW_X + 15} ${arrowY} L${ARROW_X + 9} ${arrowY - 3} L${ARROW_X + 9} ${arrowY + 3} Z`}
        className="fill-brand"
      />
      <text x={ARROW_X + 7} y={arrowY - 6} textAnchor="middle" className="fill-brand text-[7px]">
        自動
      </text>

      <g transform={`translate(${SEED_OFFSET} 0)`}>
        <Connectors />
        {seeded.map((label, i) => (
          <Box key={i} x={LEAF_X} y={leafY(i)} label={label} />
        ))}
        {[0, 1].map((i) => (
          <Box key={i} x={MID_X} y={midY(i)} variant="empty" />
        ))}
        <Box x={FINAL_X} y={FINAL_Y} label="優勝" variant="highlight" />
      </g>
    </svg>
  );
}

/**
 * 手動で配置する図。左の未配置のエントリーを、空欄の枠へドラッグして置く様子。
 * ドラッグ中のカードとカーソルを重ねて「自分で置く」ことを示す。
 */
function ManualDiagram() {
  const dropRow = 2;
  const dropY = leafY(dropRow);
  const chipY = leafY(1);
  return (
    <svg
      viewBox={`0 0 ${WIDTH + SEED_OFFSET} ${HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label="未配置のエントリーを、空欄のトーナメント表の枠へドラッグして置く図"
    >
      {["A", "B"].map((label, i) => (
        <g key={label}>
          <rect
            x={LIST_X}
            y={leafY(i * 2)}
            width={LIST_W}
            height={BOX_H}
            rx={8}
            className="fill-panel stroke-border"
            strokeWidth={1}
          />
          <text
            x={LIST_X + LIST_W / 2}
            y={leafY(i * 2) + BOX_H / 2 + 3}
            textAnchor="middle"
            className="fill-gray-200 text-[8px]"
          >
            {label}
          </text>
        </g>
      ))}

      {/* 掴んでいる最中の「C」。未配置の列から枠へ運ぶ途中を表す。 */}
      <rect
        x={LIST_X + 8}
        y={chipY}
        width={LIST_W}
        height={BOX_H}
        rx={8}
        className="fill-brand/20 stroke-brand"
        strokeWidth={1}
      />
      <text
        x={LIST_X + 8 + LIST_W / 2}
        y={chipY + BOX_H / 2 + 3}
        textAnchor="middle"
        className="fill-brand text-[8px]"
      >
        C
      </text>
      <path
        d={`M${LIST_X + 8 + LIST_W} ${chipY + BOX_H / 2} Q${SEED_OFFSET - 6} ${chipY + BOX_H / 2} ${SEED_OFFSET + LEAF_X - 3} ${dropY + BOX_H / 2}`}
        className="fill-none stroke-brand"
        strokeWidth={1}
        strokeDasharray="3 2"
      />

      <g transform={`translate(${SEED_OFFSET} 0)`}>
        <Connectors />
        <Box x={LEAF_X} y={leafY(0)} variant="empty" />
        <Box x={LEAF_X} y={leafY(1)} variant="empty" />
        <Box x={LEAF_X} y={dropY} variant="highlight" />
        <Box x={LEAF_X} y={leafY(3)} variant="empty" />
        {[0, 1].map((i) => (
          <Box key={i} x={MID_X} y={midY(i)} variant="empty" />
        ))}
        <Box x={FINAL_X} y={FINAL_Y} variant="empty" />

        {/* ドラッグ中のカーソル。置こうとしている枠の上に重ねる。 */}
        <g transform={`translate(${LEAF_X + BOX_W / 2} ${dropY + BOX_H - 5})`}>
          <path
            d="M0 0 L0 11 L2.6 8.4 L4.4 12 L6.2 11.1 L4.4 7.6 L8 7.6 Z"
            className="fill-white stroke-black/60"
            strokeWidth={0.6}
          />
        </g>
      </g>
    </svg>
  );
}

export function BracketBuildMethodDiagram({ kind }: { kind: "SEED" | "MANUAL" }) {
  return kind === "SEED" ? <SeedDiagram /> : <ManualDiagram />;
}
