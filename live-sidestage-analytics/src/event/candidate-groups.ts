// 検知バトル候補(EventMatchBattleCandidate)を「合算グループ」単位でまとめる純粋関数。
//
// **このファイルは何も import しない。** クライアントコンポーネント(`MatchManager.tsx`)から
// 直接 import するので、`match-status.ts` / `match-detect.ts` と同じ制約を守る。
//
// 勝敗確定(`match-results.ts`)・API検証(`route.ts`)・公開表示(`match-detail.ts`)・
// 管理画面UI(`MatchManager.tsx`)のすべてがここの関数を共有し、「連続する同じ
// combinedGroupId を1ゲームとしてまとめる」という定義を1箇所に閉じる。

export type GroupableCandidate = {
  id: string;
  startedAt: string | Date;
  battleId: string;
  combinedGroupId: string | null;
};

/**
 * startedAt→battleId で決定的にソートする。全箇所(API検証・UI表示・fingerprint・
 * グループ化)で共有し順序を揃える。startedAt が同時刻の場合だけ battleId で決める
 * (battleId は TikTok 側の不透明な文字列 ID で、同時刻の衝突はまず起きないが、
 * 決定的な全順序にするためのタイブレークとして使う)。
 */
export function sortCandidatesDeterministically<T extends { startedAt: string | Date; battleId: string }>(
  candidates: T[]
): T[] {
  return [...candidates].sort((a, b) => {
    const ta = new Date(a.startedAt).getTime();
    const tb = new Date(b.startedAt).getTime();
    return ta !== tb ? ta - tb : a.battleId.localeCompare(b.battleId);
  });
}

/**
 * startedAt 昇順の候補配列を、隣接する同じ combinedGroupId ごとにまとめる。
 * combinedGroupId が null の候補は単独の1要素グループになる。
 *
 * **呼び出し側は必ず startedAt 昇順で渡すこと**(`sortCandidatesDeterministically` を
 * 先に通す)。非隣接(間に別の combinedGroupId を挟む)な同一IDは別グループとして扱う —
 * 連続性は書き込み側(`validateCandidateGroups`)が検証して防ぐ前提。
 */
export function groupByCombinedGroup<T extends GroupableCandidate>(
  candidatesSortedByStartedAt: T[]
): T[][] {
  const groups: T[][] = [];
  let currentKey: string | null = null;
  for (const c of candidatesSortedByStartedAt) {
    const sameGroup = c.combinedGroupId !== null && c.combinedGroupId === currentKey;
    if (sameGroup) {
      groups[groups.length - 1].push(c);
    } else {
      groups.push([c]);
      currentKey = c.combinedGroupId;
    }
  }
  return groups;
}

/**
 * UIの「前の候補と合算する」フラグ集合から groups を導出する。
 *
 * **構造的にグループの厳密な分割しか作れない**(id重複・非連続が原理的に発生しない):
 * checked な候補を startedAt 順に並べ、mergeWithPreviousIds に入っている候補だけを
 * 直前のグループへ連結する。低ダイヤ非表示トグルで行が隠れても checkedIds/mergeWithPreviousIds
 * は変わらないので、導出結果は表示状態と無関係に安定する。
 */
export function deriveGroupsFromSelection<T extends GroupableCandidate>(
  candidates: T[],
  checkedIds: ReadonlySet<string>,
  mergeWithPreviousIds: ReadonlySet<string>
): string[][] {
  const checkedSorted = sortCandidatesDeterministically(candidates.filter((c) => checkedIds.has(c.id)));
  const groups: string[][] = [];
  for (const c of checkedSorted) {
    if (mergeWithPreviousIds.has(c.id) && groups.length > 0) {
      groups[groups.length - 1].push(c.id);
    } else {
      groups.push([c.id]);
    }
  }
  return groups;
}

export type GroupValidationError =
  | { code: "INVALID_SHAPE" }
  | { code: "GROUP_DUPLICATE_ID" }
  | { code: "GROUP_ID_MISMATCH" }
  | { code: "GROUP_NOT_CONTIGUOUS" };

/**
 * API側の groups 検証。**「候補の厳密な分割」であることを構造的に確認する**
 * (各IDが全グループを通じてちょうど1回だけ現れる／非配列・非文字列・空配列を拒否／
 * candidateIds の集合と完全一致／各グループが startedAt→battleId 順で連続区間を成す)。
 *
 * `rawGroups === undefined` は旧クライアント互換(全部単独グループとして扱う)。
 */
export function validateCandidateGroups(
  rawGroups: unknown,
  candidateIds: string[],
  byId: Map<string, { startedAt: Date; battleId: string }>
): { ok: true; groups: string[][] } | { ok: false; error: GroupValidationError } {
  if (rawGroups === undefined) {
    return { ok: true, groups: candidateIds.map((id) => [id]) };
  }
  if (!Array.isArray(rawGroups)) return { ok: false, error: { code: "INVALID_SHAPE" } };

  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const g of rawGroups) {
    if (!Array.isArray(g) || g.length === 0 || g.some((id) => typeof id !== "string")) {
      return { ok: false, error: { code: "INVALID_SHAPE" } };
    }
    for (const id of g) {
      if (seen.has(id)) return { ok: false, error: { code: "GROUP_DUPLICATE_ID" } };
      seen.add(id);
    }
    groups.push(g as string[]);
  }

  const candidateIdSet = new Set(candidateIds);
  if (seen.size !== candidateIds.length || [...seen].some((id) => !candidateIdSet.has(id))) {
    return { ok: false, error: { code: "GROUP_ID_MISMATCH" } };
  }

  const sortedIds = sortCandidatesDeterministically(
    candidateIds.map((id) => ({ id, ...byId.get(id)! }))
  ).map((c) => c.id);
  const positionOf = new Map(sortedIds.map((id, i) => [id, i]));

  for (const group of groups) {
    const positions = group.map((id) => positionOf.get(id)!).sort((a, b) => a - b);
    const expected = new Set(sortedIds.slice(positions[0], positions[0] + group.length));
    if (group.some((id) => !expected.has(id))) {
      return { ok: false, error: { code: "GROUP_NOT_CONTIGUOUS" } };
    }
  }
  return { ok: true, groups };
}
