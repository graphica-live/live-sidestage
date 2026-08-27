// 純粋関数。矩形2つ(source/target)から黄色破線矢印のSVGパスを計算する。DOMには一切触れない。
//
// 既存の接続線(AdminBracketTree.tsx / BracketTree.tsx の PairConnector)は、再帰ツリーの
// サブツリー内でしか座標を持てない絶対配置spanなので、任意の2枠(東西ブロック跨ぎ・
// 同一ラウンドの遠い枠)を結ぶには使えない。この関数はツリー根に敷く独立overlay SVGが
// 呼び出す(`FeederFlowOverlay.tsx`、DOM実測は呼び出し側の責務)。
//
// **すべての座標をrootの実寸(bounds)へclampする。** 同一カラム内の近接交換は制御点が
// 外側へ膨らみやすいが、外へ出すと公開ページの `BracketScroller`(マウント時に一度だけ
// 実寸を測って固定サイズのwrapperを作る)の計測とズレたりSVGのviewBoxでクリップされたり
// するため、常に `[0, bounds.width] x [0, bounds.height]` の内側に収める。

export type FlowRect = { x: number; y: number; w: number; h: number };
export type FlowBounds = { width: number; height: number };

export type FlowPath = {
  d: string;
  headX: number;
  headY: number;
  /** 矢じり(marker-end用ではなく自前描画する場合)の向き。度数法、+x軸基準。 */
  headAngleDeg: number;
};

const GAP = 4;
const MIN_HANDLE = 28;
const MAX_HANDLE = 140;
const HANDLE_RATIO = 0.35;
/** 同一カラム時、近接する矢印を並行にずらす1段あたりの追加膨らみ。 */
const BOW_STEP = 14;
const BASE_BULGE = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * source(実際に勝ち上がってくる対戦) → target(現在その参加者が表示されている枠)の
 * 矢印パスを計算する。
 *
 * `bowIndex` は同一カラム時に複数の矢印が重なるのを避けるための並行ずらし(0,1,2…)。
 * 呼び出し側が `from`/`to` のキーで決定的にソートして割り当てること。
 */
export function buildFlowPath(
  source: FlowRect,
  target: FlowRect,
  bounds: FlowBounds,
  bowIndex = 0
): FlowPath {
  const sourceCx = source.x + source.w / 2;
  const targetCx = target.x + target.w / 2;
  const sameColumn = Math.abs(sourceCx - targetCx) < Math.min(source.w, target.w) * 0.5;
  const goingRight = targetCx >= sourceCx;

  let tailX: number;
  let tailY: number;
  let headX: number;
  let headY: number;
  let c1x: number;
  let c1y: number;
  let c2x: number;
  let c2y: number;

  if (!sameColumn) {
    tailX = goingRight ? source.x + source.w + GAP : source.x - GAP;
    tailY = source.y + source.h / 2;
    headX = goingRight ? target.x - GAP : target.x + target.w + GAP;
    headY = target.y + target.h / 2;

    const dx = clamp(Math.abs(headX - tailX) * HANDLE_RATIO, MIN_HANDLE, MAX_HANDLE);
    c1x = tailX + (goingRight ? dx : -dx);
    c1y = tailY;
    c2x = headX - (goingRight ? dx : -dx);
    c2y = headY;
  } else {
    // 水平ハンドルは縦線に退化するので、rootの中心から遠い側(木の外側)へ小さく膨らませる。
    const outward = sourceCx < bounds.width / 2 ? -1 : 1;
    const bulge = BASE_BULGE + bowIndex * BOW_STEP;

    tailX = sourceCx + (outward * source.w) / 2;
    tailY = source.y + source.h / 2;
    headX = targetCx + (outward * target.w) / 2;
    headY = target.y + target.h / 2;

    c1x = tailX + outward * bulge;
    c1y = tailY;
    c2x = headX + outward * bulge;
    c2y = headY;
  }

  const clampX = (v: number) => clamp(v, 0, bounds.width);
  const clampY = (v: number) => clamp(v, 0, bounds.height);

  tailX = clampX(tailX);
  tailY = clampY(tailY);
  headX = clampX(headX);
  headY = clampY(headY);
  c1x = clampX(c1x);
  c1y = clampY(c1y);
  c2x = clampX(c2x);
  c2y = clampY(c2y);

  const headAngleDeg = (Math.atan2(headY - c2y, headX - c2x) * 180) / Math.PI;

  return {
    d: `M ${tailX} ${tailY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${headX} ${headY}`,
    headX,
    headY,
    headAngleDeg,
  };
}
