import type { BracketMethod } from "@/event/bracket";

// トーナメント方式の説明カード用の簡易図解。5人(奇数の最小構成)を例に、
// 不戦勝(BYE)がどう配分されるかを見せる。実際の公開トーナメント表(BracketTree.tsx)
// とは別物 — あちらは実データを描く本番コンポーネントで、幾何の制約(カード高固定・
// 完全二分木前提)が厳しいため、説明用のこの図はあえて素朴な直線コネクタで作り、
// 本番コンポーネントの制約を一切引き継がない。

type Slot = {
  kind: "bye" | "match";
  labels: string[];
  /** 前の列における、この枠に勝ち上がる枠のindex。1回戦(最初の列)は無し */
  feeders?: number[];
};

const BOX_W = 64;
const BOX_H = 26;
const ROW_GAP = 10;
const COL_GAP = 46;
const PAD = 6;

// 標準シード方式: 不戦勝を1回戦に集中させる(5人なら①②③が同時に不戦勝)。
const STANDARD_COLUMNS: Slot[][] = [
  [
    { kind: "bye", labels: ["①"] },
    { kind: "match", labels: ["④", "⑤"] },
    { kind: "bye", labels: ["②"] },
    { kind: "bye", labels: ["③"] },
  ],
  [
    { kind: "match", labels: ["①", "④⑤"], feeders: [0, 1] },
    { kind: "match", labels: ["②", "③"], feeders: [2, 3] },
  ],
  [{ kind: "match", labels: ["勝者", "勝者"], feeders: [0, 1] }],
];

// 段階的不戦勝方式: 各ラウンドの同時不戦勝は最大1人(5人なら1回戦は⑤のみ)。
// 実装は「参加者を先頭から詰め、余りをBYEにする」座標に忠実に構築するため、
// 不戦勝を引いた枠(この例では⑤)がそのまま次のラウンドでも不戦勝になることがある
// — 標準方式と違うのは「同時に複数人が不戦勝になることはない」点で、
// 「同じ人が複数ラウンドで不戦勝にならない」ことまでは保証しない。
const STAGED_COLUMNS: Slot[][] = [
  [
    { kind: "match", labels: ["①", "②"] },
    { kind: "match", labels: ["③", "④"] },
    { kind: "bye", labels: ["⑤"] },
  ],
  [
    { kind: "match", labels: ["①②", "③④"], feeders: [0, 1] },
    { kind: "bye", labels: ["⑤"], feeders: [2] },
  ],
  [{ kind: "match", labels: ["勝者", "勝者"], feeders: [0, 1] }],
];

function layout(columns: Slot[][]) {
  const centers: number[][] = [];
  columns.forEach((col, c) => {
    centers.push(
      col.map((slot, i) => {
        if (c === 0 || !slot.feeders) return PAD + i * (BOX_H + ROW_GAP) + BOX_H / 2;
        const ys = slot.feeders.map((f) => centers[c - 1][f]);
        return ys.reduce((a, b) => a + b, 0) / ys.length;
      })
    );
  });
  return centers;
}

export function BracketMethodDiagram({ method }: { method: BracketMethod }) {
  const columns = method === "STAGED_BYE" ? STAGED_COLUMNS : STANDARD_COLUMNS;
  const centers = layout(columns);

  const maxRows = Math.max(...columns.map((c) => c.length));
  // +14 は不戦勝の枠の下に出す「不戦勝」ラベルぶんの余白。
  const height = PAD * 2 + maxRows * (BOX_H + ROW_GAP) - ROW_GAP + 14;
  const width = PAD * 2 + columns.length * BOX_W + (columns.length - 1) * COL_GAP;

  const colX = (c: number) => PAD + c * (BOX_W + COL_GAP);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full max-w-[280px]"
      role="img"
      aria-label={
        method === "STAGED_BYE"
          ? "段階的不戦勝方式: 5人の場合、1回戦は⑤のみ不戦勝、準決勝でも⑤が不戦勝になる図(同時に複数人が不戦勝になることはない)"
          : "標準シード方式: 5人の場合、1回戦で①②③が同時に不戦勝になる図"
      }
    >
      {/* コネクタ(直線)。本番のトーナメント表とは別の、説明用の素朴な線。 */}
      {columns.map((col, c) =>
        c === 0
          ? null
          : col.map((slot, i) =>
              (slot.feeders ?? []).map((f) => (
                <line
                  key={`${c}-${i}-${f}`}
                  x1={colX(c - 1) + BOX_W}
                  y1={centers[c - 1][f]}
                  x2={colX(c)}
                  y2={centers[c][i]}
                  className="stroke-border"
                  strokeWidth={1}
                />
              ))
            )
      )}

      {columns.map((col, c) =>
        col.map((slot, i) => {
          const y = centers[c][i] - BOX_H / 2;
          const x = colX(c);
          const isBye = slot.kind === "bye";
          return (
            <g key={`${c}-${i}`}>
              <rect
                x={x}
                y={y}
                width={BOX_W}
                height={BOX_H}
                rx={5}
                className={isBye ? "fill-transparent stroke-brand/50" : "fill-panel stroke-border"}
                strokeWidth={1}
                strokeDasharray={isBye ? "3 2" : undefined}
              />
              {slot.labels.length === 1 ? (
                <text
                  x={x + BOX_W / 2}
                  y={y + BOX_H / 2 + 3}
                  textAnchor="middle"
                  className="fill-gray-200 text-[9px]"
                >
                  {slot.labels[0]}
                </text>
              ) : (
                <>
                  <text
                    x={x + BOX_W / 2}
                    y={y + BOX_H / 2 - 3}
                    textAnchor="middle"
                    className="fill-gray-200 text-[8px]"
                  >
                    {slot.labels[0]}
                  </text>
                  <text
                    x={x + BOX_W / 2}
                    y={y + BOX_H / 2 + 9}
                    textAnchor="middle"
                    className="fill-gray-500 text-[7px]"
                  >
                    vs {slot.labels[1]}
                  </text>
                </>
              )}
              {isBye && (
                <text
                  x={x + BOX_W / 2}
                  y={y + BOX_H + 9}
                  textAnchor="middle"
                  className="fill-brand text-[7px]"
                >
                  不戦勝
                </text>
              )}
            </g>
          );
        })
      )}
    </svg>
  );
}
