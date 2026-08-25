import { formatScaledPoints } from "./scoring";
import { MAX_PARTICIPANTS } from "./validation";

// リスナー貢献の「参加者ごとの内訳」の保存形式。
//
// 公開ページのリスナー貢献欄は、複数の枠へ投げたリスナーについて
// 「どの枠へいくら入れたか」を並べる。その材料を集計時に確定させて
// EventContribution(scope=EVENT) の JSON 列へ置く。
//
// 書き手(aggregate.ts)と読み手(public-event.ts)で形が食い違うと静かに壊れるので、
// シリアライズ・パース・上限をこの1ファイルに閉じ込めて unit テストで固定する。

/** 集計中の内訳。points は **100倍された内部整数**(scoring.ts の規約)。 */
export type ListenerBreakdownEntry = {
  participantId: string;
  diamonds: bigint;
  /** 100倍されたポイント。保存時に formatScaledPoints() を通す */
  points: bigint;
};

/** 公開ページへ渡す1件。参加者名は載せない(クライアントが参加者一覧から引く)。 */
export type ContributionBreakdownDto = {
  participantId: string;
  diamonds: string;
  /** Decimal 文字列("250.50")。100倍された内部値ではない */
  points: string;
};

/**
 * 1リスナーぶんの内訳の上限。
 *
 * 参加者数そのものが `MAX_PARTICIPANTS` で頭打ちなので、実質は全件保存になる
 * (「ほか N 人」の省略を出さないための上限。防御的に置いてあるだけ)。
 */
export const MAX_BREAKDOWN_ENTRIES = MAX_PARTICIPANTS;

/** ダイヤ(整数)とポイント(小数2桁まで)の文字列形式。パース時に必ず通す。 */
const DIAMONDS_PATTERN = /^\d{1,30}$/;
const POINTS_PATTERN = /^\d{1,30}(?:\.\d{1,2})?$/;

/** JSON 列へ入れる形。キーを短くしているのは、10秒ごとに全行を書き換えるため。 */
type StoredEntry = { p: string; d: string; pt: string };

/**
 * 保存形へ変換する。**ポイントは 100倍された内部値なので必ず formatScaledPoints() を通す**
 * (そのまま文字列にすると公開ページで 100倍の値が出る)。
 */
export function serializeBreakdown(entries: ListenerBreakdownEntry[]): StoredEntry[] {
  return entries.slice(0, MAX_BREAKDOWN_ENTRIES).map((e) => ({
    p: e.participantId,
    d: e.diamonds.toString(),
    pt: formatScaledPoints(e.points),
  }));
}

/**
 * 保存形を公開ページ用へ戻す。
 *
 * **`null` を返すのは「内訳を持たない行」**（内訳に未対応だった頃の集計が書いた行、
 * または形が壊れている行）。読み側はそのとき従来表示へフォールバックする。
 * 「投げた枠が0件」と「内訳を持たない」を区別したいので `[]` へ丸めない。
 *
 * 中身は信用しない — 不正な要素は落とし、participantId の重複は最初の1件だけ採る。
 */
export function parseBreakdown(value: unknown): ContributionBreakdownDto[] | null {
  if (!Array.isArray(value)) return null;

  const seen = new Set<string>();
  const parsed: ContributionBreakdownDto[] = [];

  for (const raw of value) {
    if (parsed.length >= MAX_BREAKDOWN_ENTRIES) break;
    if (!raw || typeof raw !== "object") continue;

    const { p, d, pt } = raw as Record<string, unknown>;
    if (typeof p !== "string" || p.length === 0 || seen.has(p)) continue;
    if (typeof d !== "string" || !DIAMONDS_PATTERN.test(d)) continue;
    if (typeof pt !== "string" || !POINTS_PATTERN.test(pt)) continue;

    seen.add(p);
    parsed.push({ participantId: p, diamonds: d, points: pt });
  }

  return parsed;
}
