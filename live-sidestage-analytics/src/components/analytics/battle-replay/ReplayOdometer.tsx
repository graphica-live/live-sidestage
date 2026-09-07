"use client";

// コンボの個数。最終値をいきなり出さず、1 から刻みに合わせて上げる。
//
// comp の CSS は `steps(N)` の keyframe アニメーションだが、**実装では transform を
// elapsedMs から直接与える**。アニメーションは壁時計基準なので、シーク・速度変更のたびに
// 表示値と再生位置がずれる(「描画は elapsedMs の純関数」という設計の唯一の例外を作ってしまう)。
// 見た目(1em の窓をリールが送られる)は同じ。

/**
 * リールに載せる最大段数。TikTok の連打は ×999 まであり、その数だけ `<span>` を作ると
 * 30Hz の再描画で数千ノードを調停することになる。超えた分は数値だけを出す(見た目の
 * 送りは失われるが、値は同じ刻みで上がる)。
 */
const MAX_REEL_STEPS = 12;

export function ReplayOdometer({ value, total }: { value: number; total: number }) {
  const steps = Math.max(1, Math.floor(total));
  if (steps <= 1) return <>1</>;
  const current = Math.min(steps, Math.max(1, Math.floor(value)));
  if (steps > MAX_REEL_STEPS) return <>{current}</>;
  const digits = Array.from({ length: steps }, (_, i) => i + 1);
  return (
    <span className="replay-odo" aria-label={`${current}`}>
      <span
        className="replay-reel"
        style={{
          animation: "none",
          transform: `translateY(${-(current - 1)}em)`,
          transition: "transform 120ms linear",
        }}
      >
        {digits.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </span>
    </span>
  );
}
