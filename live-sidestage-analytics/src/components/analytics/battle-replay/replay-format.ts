// 再生UIの表示整形。**DOM も React も引かない純関数だけ**を置く(vitest で固定するため)。

/**
 * 貢献値の省略表記。**すべて切り捨て**(四捨五入しない)。
 *
 * - `< 1,000` → そのまま (`0` `380`)
 * - `1,000〜9,999` → k + 小数第1位 (`1.2k` `9.9k`)
 * - `10,000〜999,999` → k + 小数なし (`31k` `412k`)
 * - `1,000,000〜9,999,999` → M + 小数第1位 (`1.8M`)
 * - `10,000,000〜` → M + 小数なし (`12M`)
 *
 * **生値が正本で、これは表示専用。** 並べ替え・比較は生値で行う。
 * スコアバーと個人スコア(TikTok公式スコア)には使わない。
 */
export function formatShortAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const cut = (unit: number, decimals: number) => {
    const factor = 10 ** decimals;
    return (Math.floor((value / unit) * factor) / factor).toFixed(decimals);
  };
  if (value >= 10_000_000) return `${cut(1_000_000, 0)}M`;
  if (value >= 1_000_000) return `${cut(1_000_000, 1)}M`;
  if (value >= 10_000) return `${cut(1_000, 0)}k`;
  if (value >= 1_000) return `${cut(1_000, 1)}k`;
  return String(Math.floor(value));
}

/** `mm:ss`。負値と NaN は 0 に丸める(シーク中に -1ms が来ても表示が壊れないように)。 */
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * 貢献者アイコンのリップル倍率。コイン額から 1.5〜2.8。
 * 配信者側(`--replay-ripple`)と同じ変数へ入れるが、こちらは1回のギフト額で決まる。
 */
export function rippleScaleForCoins(coins: number): number {
  const safe = Math.max(coins, 1);
  const ratio = Math.min(1, Math.log10(safe) / 6);
  return Number((1.5 + ratio * 1.3).toFixed(2));
}

/**
 * 再生モードのモーダルタイトル。1vs1 は `{自分} vs {相手}`、それ以外は `{自分} × N人バトル`
 * (N は自分以外の人数)。陣営が解決できていないバトルでは自分の名前だけを返す。
 */
export function replayTitleOf(
  teams: { isSelf: boolean; participants: { label: string }[] }[]
): string {
  const self = teams.find((team) => team.isSelf)?.participants[0]?.label ?? "自分";
  const others = teams.filter((team) => !team.isSelf).flatMap((team) => team.participants);
  if (others.length === 0) return self;
  if (others.length === 1) return `${self} vs ${others[0].label}`;
  return `${self} × ${others.length}人バトル`;
}

/** イニシャル(アバターが無いときの代替)。絵文字・サロゲートペアで割らない。 */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return [...trimmed][0] ?? "?";
}
