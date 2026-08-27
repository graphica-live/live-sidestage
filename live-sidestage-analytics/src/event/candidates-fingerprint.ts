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
  candidates: { id: string; startedAt: Date; endedAt: Date | null; confidence: string; ambiguous: boolean }[]
): string {
  const sorted = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted
    .map(
      (c) =>
        `${c.id}:${c.startedAt.getTime()}:${c.endedAt?.getTime() ?? "null"}:${c.confidence}:${c.ambiguous}`
    )
    .join("|");
}

/**
 * 「主催者が下した選択(organizerSelected/combinedGroupId)」の指紋。`buildCandidatesFingerprintInput`
 * が守るのは検知データそのもの(startedAt/endedAt/confidence/ambiguous)の鮮度で、選択状態の
 * 鮮度は守らない。`resetCandidates` と、既に candidatesConfirmedByOrganizer 済みの対戦への
 * 再 `selectCandidateGroups` は、この指紋も照合する(古いタブからの選択解除・上書きを防ぐ)。
 *
 * combinedGroupId は crypto.randomUUID() でサーバーが発行する不透明値なので、同じ
 * グループ分割でも再選択のたびに値が変わる。**生の値ではなく「そのグループの先頭候補ID」
 * を代表値として正規化してから比較する**(candidates は id 昇順で処理するので、同じ分割は
 * 常に同じ代表値になる)。
 */
export function buildSelectionFingerprintInput(
  candidates: { id: string; organizerSelected: boolean; combinedGroupId: string | null }[]
): string {
  const sorted = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const representative = new Map<string, string>();
  return sorted
    .map((c) => {
      let normalized = "-";
      if (c.combinedGroupId) {
        if (!representative.has(c.combinedGroupId)) representative.set(c.combinedGroupId, c.id);
        normalized = representative.get(c.combinedGroupId)!;
      }
      return `${c.id}:${c.organizerSelected}:${normalized}`;
    })
    .join("|");
}
