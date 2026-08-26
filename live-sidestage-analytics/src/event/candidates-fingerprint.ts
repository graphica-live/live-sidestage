/**
 * 候補一覧の「見た目」の指紋の元になる文字列。楽観的排他に使う。
 *
 * ID集合だけでなく、内容の変化(終了時刻確定・confidence変化等)も検知する必要がある
 * ため、既存の `expectedMatchIds`(表の同一性だけを保証するパターン)は流用しない。
 *
 * **ハッシュ化はここでは行わない。** サーバー側(`route.ts`)は Node.js の `crypto`、
 * クライアント側(`MatchManager.tsx`)は Web Crypto API(`crypto.subtle.digest`)と
 * 実行環境が異なるため、rawの文字列生成だけをここに共通化し、ハッシュ化は呼び出し側に
 * 委ねる(このファイルはクライアントコンポーネントからも import されるので、
 * Node.js 専用モジュールに依存させない)。
 */
export function buildCandidatesFingerprintInput(
  candidates: { id: string; endedAt: Date | null; confidence: string; ambiguous: boolean }[]
): string {
  const sorted = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted
    .map((c) => `${c.id}:${c.endedAt?.getTime() ?? "null"}:${c.confidence}:${c.ambiguous}`)
    .join("|");
}
