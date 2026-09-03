import { saveHostUserIdOnce } from "./tiktok-host-id";
import { normalizeTiktokId } from "./tiktok-room";

// TikTok ID(ハンドル)変更に伴うデータ合流の正本。
//
// この段階(Phase 0)では、合流の判定材料である `TiktokRoom.hostUserId` を集めるための
// 純粋関数と、バトル履歴からの逆引きだけを置く。合流本体は後続フェーズで足す。
//
// **なぜバトル履歴から逆引きできるか**: `tiktok_battles.hostProfiles` は anchorId(数値 userId)
// をキーに `{displayId, nickName, avatarUrl}` を持ち、**両サイド分が同時に配信される**
// (CLAUDE.md「相手の TikTok ハンドル・表示名・アイコンは、相手が analytics 未登録でも取れる」)。
// つまり自分の room の battle レコードの中に「自分の displayId → 自分の anchorId」の対応が
// 入っている。ここから引けば **TikTok への問い合わせを1回も増やさずに** hostUserId が埋まる。
//
// しかも配信当時の記録なので、後から TikTok を引き直す方式が持つ弱点(ハンドルの持ち主が
// 入れ替わっていても気づけない)を持たない。

/** `tiktok_battles.hostProfiles` の1エントリ。必要なのは displayId だけ。 */
type HostProfileLike = { displayId?: unknown };

/**
 * バトルの `hostProfiles`(anchorId -> profile)群から、指定ハンドルの anchorId を引く。**純粋関数。**
 *
 * - `displayId` は `normalizeTiktokId` で正規化して比較する(`@` 付き・大文字が混じる)
 * - **一致する anchorId が2種類以上あったら null を返す。** どちらが本人か決められない状態で
 *   推測すると、誤った hostUserId が fill-once され二度と直せない。合流の判定材料なので、
 *   曖昧なら「材料なし」に倒すのが正しい
 * - anchorId は数値文字列(`anchorIdStr`)。形式が違うものは無視する
 */
export function findHostUserIdFromBattleProfiles(
  rows: { hostProfiles: unknown }[],
  tiktokId: string
): string | null {
  const target = normalizeTiktokId(tiktokId);
  if (target.length === 0) return null;

  const matched = new Set<string>();

  for (const row of rows) {
    const profiles = row.hostProfiles;
    if (typeof profiles !== "object" || profiles === null || Array.isArray(profiles)) continue;

    for (const [anchorId, profile] of Object.entries(profiles as Record<string, unknown>)) {
      if (!/^\d{1,32}$/.test(anchorId)) continue;
      if (typeof profile !== "object" || profile === null) continue;

      const displayId = (profile as HostProfileLike).displayId;
      if (typeof displayId !== "string") continue;
      if (normalizeTiktokId(displayId) !== target) continue;

      matched.add(anchorId);
      // 2種類見つかった時点で確定しない。以降を見ても結論は変わらない。
      if (matched.size > 1) return null;
    }
  }

  return matched.size === 1 ? [...matched][0] : null;
}

/**
 * 一度処理済みの roomId。**同じ room へ何度も UPDATE を撃たないためだけの最適化。**
 *
 * `linkMicArmies` はバトル中ずっと数秒おきに飛ぶので、候補が見つかるたびに書きに行くと
 * 同じ更新を繰り返す。正しさはこの Set ではなく DB 側の where 条件が担保している
 * (プロセスをまたげば重複するが、書き込みは冪等)。
 */
const battleFillAttempted = new Set<string>();

/** テスト用。 */
export function clearBattleFillCache(): void {
  battleFillAttempted.clear();
}

/**
 * バトルの `hostProfiles` から自 room の `hostUserId` を fill-once する。
 *
 * **TikTok への問い合わせは発生しない**(受信済みの payload だけを見る)。
 *
 * 書き込みは `tiktok-host-id.ts` の `saveHostUserIdOnce()` を通す。**where 条件を書き写さない** —
 * fill-once と「一度 `user_not_found` を観測した room には書かない」という規律は、
 * 経路ごとの善意ではなく共有関数1つで担保する(理由は
 * TiktokRoom.hostUserIdBackfillGaveUpAt のコメント)。
 *
 * **失敗しても投げない。** 呼び出し元(バトル保存)にとっては付随処理で、`void` で
 * 呼ばれるため throw すると worker プロセスの unhandledRejection になる。
 * 純粋関数の呼び出しごと try で包むのはそのため。
 */
export async function fillHostUserIdFromBattle(
  roomId: string,
  tiktokId: string,
  hostProfiles: unknown
): Promise<void> {
  if (battleFillAttempted.has(roomId)) return;

  try {
    const anchorId = findHostUserIdFromBattleProfiles([{ hostProfiles }], tiktokId);
    if (anchorId === null) return;

    battleFillAttempted.add(roomId);
    try {
      await saveHostUserIdOnce(roomId, anchorId);
    } catch (err) {
      // 次のバトルで拾い直せるように、キャッシュから外してから報告する。
      battleFillAttempted.delete(roomId);
      throw err;
    }
  } catch (err) {
    console.error(`[tiktok-id-migration] @${tiktokId} の hostUserId 補完に失敗:`, err);
  }
}
