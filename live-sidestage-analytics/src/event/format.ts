// 表示フォーマッタ。client component からも値で import されるため、
// prisma / sharp を引く public-event.ts からは独立させておく
// (public-event.ts に置くと "use client" 側のバンドルへ sharp が入り、
// next build が node:child_process 等を解決できずに落ちる)。

/** 3桁区切り。BigInt 由来の文字列をそのまま整形する(Number へ落とさない)。 */
export function formatNumber(value: string): string {
  const [int, frac] = value.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const digits = sign ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${sign}${grouped}.${frac}` : `${sign}${grouped}`;
}

/** ポイントの小数部が .00 なら落とす(実数=ポイントのイベントで冗長なため)。 */
export function formatPoints(value: string): string {
  const trimmed = value.endsWith(".00") ? value.slice(0, -3) : value;
  return formatNumber(trimmed);
}
