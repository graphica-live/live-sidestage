// 陣営色(`battle-colors.ts` の生HEX)を、ステージ面のグラデーションで使える rgba へ落とす。
// **色そのものは決めない**(正本は `assignFactionColors`)。透明度を足すだけ。

export function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return `rgba(154, 158, 166, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** セル背景。comp の `radial-gradient(120% 100% at 50% 0%, <陣営色 42%>, rgba(13,15,19,.95))`。 */
export function cellBackground(color: string): string {
  return `radial-gradient(120% 100% at 50% 0%, ${hexToRgba(color, 0.42)}, rgba(13, 15, 19, 0.95))`;
}
