import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { saveHostUserIdOnce } from "./tiktok-host-id";
import { normalizeTiktokId, resolveRoomForStreamer, TIKTOK_ID_PATTERN } from "./tiktok-room";
import { fetchTiktokProfile, checkAccountExistence } from "./tiktok-profile";
import { isStreamerRegistrationExistenceCheckDisabled } from "./tiktok-existence";

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

// ============================================================================
// Phase 2 — 合流コア
//
// TikTok ID(ハンドル)変更を検知し、同じ数値 userId を持つ別ハンドルの room を
// 確認なしで自動合流(ABSORB)する。全体設計は
// C:\Users\joegr\.claude\plans\tiktokid-orweb-id-id-1-id-rippling-moore.md を正本とする。
//
// 登録/変更を書く3経路(mobile POST/PATCH, verify/generate)は `upsertTiktokIdMergeJob()` で
// ジョブを積むだけで判定は一切行わない。判定・TikTok照会・合流実行は event-worker の
// `mergeTick()` が `runMergeJob()` を通して非同期に行う。
// ============================================================================

type TxClient = Prisma.TransactionClient;

/**
 * `Streamer.tiktokId` を書くのと同じトランザクション内で呼ぶ。合流の判断は一切行わず、
 * ジョブを1行 upsert するだけ(TikTok への追加の問い合わせは発生しない)。
 *
 * **update 句を明示する。** `upsertRoom` と同じ `update: {}` 流儀で書くと、一度
 * `done`/`failed` になった行が2回目以降の ID 変更で再 pending 化されず、以後の合流が
 * 一切走らなくなる。
 */
export async function upsertTiktokIdMergeJob(
  tx: TxClient,
  streamerId: string,
  tiktokId: string
): Promise<void> {
  const now = new Date();
  await tx.tiktokIdMergeJob.upsert({
    where: { streamerId },
    update: { tiktokId, status: "pending", attempts: 0, nextAttemptAt: now, lastError: null },
    create: { streamerId, tiktokId, status: "pending", nextAttemptAt: now },
  });
}

/**
 * 新ハンドルの入口実在確認(仕様0)。**書き込み前に呼ぶ。**
 *
 * - `MISSING`(user_not_found明示) → 拒否
 * - `UNVERIFIED`(レート制限・障害) → **通す(fail-open)**。打ち間違い防止であって
 *   セキュリティ境界ではなく、TikTok 側の不調で新規登録を丸ごと止める方が被害が大きい
 * - `EXISTS` → 通す。取れた userId を返す(呼び出し側の fill-once 判断に使う)
 */
export type EntryExistenceCheck =
  | { rejected: false; userId: string | null }
  | { rejected: true };

export async function checkNewHandleAtEntry(tiktokId: string): Promise<EntryExistenceCheck> {
  if (isStreamerRegistrationExistenceCheckDisabled()) return { rejected: false, userId: null };
  const check = await checkAccountExistence(tiktokId);
  if (check.verdict === "MISSING") return { rejected: true };
  return { rejected: false, userId: check.userId };
}

/**
 * 入口での hostUserId fill を、新規作成 room または Gift 0件の room に限定して行う。
 *
 * **データ入りの room への fill は Phase 0 / mergeTick の規律つき経路に任せる。** squatter が
 * 放棄済みハンドルを取得して登録すると、共有 room 設計で既存 room(Gift 入り・
 * `hostUserId: null`)へ attach されうる。実在確認は当然 `EXISTS` になるので、無条件に
 * fill すると squatter の userId が fill-once されてしまう(fill-once ゆえ恒久的な誤合流の
 * 弾になる)。急ぐ理由が無いのはデータ入り room 側であり、埋め損ねて失うのは自動合流だけ
 * (サポート救済可能)なので、保守側に倒す。
 */
export async function fillHostUserIdAtEntryIfEligible(
  roomId: string,
  userId: string
): Promise<void> {
  const giftCount = await prisma.gift.count({ where: { roomId }, take: 1 });
  if (giftCount > 0) return;
  await saveHostUserIdOnce(roomId, userId);
}

/** `TiktokIdMergeLog.outcome` の取りうる値。 */
export type MergeOutcome =
  | "MERGED"
  | "NO_CANDIDATE"
  | "BLOCKED_OLD_HANDLE_ALIVE"
  | "BLOCKED_HOST_MISMATCH"
  | "EVENT_ACTIVE"
  | "SELF_NOT_FOUND"
  | "DEFERRED";

async function recordMergeLog(data: {
  streamerId: string;
  userId: string;
  outcome: MergeOutcome;
  oldTiktokId?: string | null;
  newTiktokId: string;
  oldRoomId?: string | null;
  survivingRoomId?: string | null;
  hostUserId?: string | null;
  hostUserIdFilledAt?: Date | null;
  stats?: unknown;
}): Promise<void> {
  try {
    await prisma.tiktokIdMergeLog.create({
      data: {
        streamerId: data.streamerId,
        userId: data.userId,
        outcome: data.outcome,
        oldTiktokId: data.oldTiktokId ?? null,
        newTiktokId: data.newTiktokId,
        oldRoomId: data.oldRoomId ?? null,
        survivingRoomId: data.survivingRoomId ?? null,
        hostUserId: data.hostUserId ?? null,
        hostUserIdFilledAt: data.hostUserIdFilledAt ?? null,
        stats: data.stats === undefined ? undefined : (data.stats as Prisma.InputJsonValue),
      },
    });
  } catch (err) {
    console.error("[tiktok-id-migration] マージログの記録に失敗:", err);
  }
}

/** 候補 room(同じ hostUserId を持つ、現 room 以外の room)を探す。 */
async function detectMergeCandidates(
  hostUserId: string,
  excludeRoomId: string
): Promise<{ id: string; tiktokId: string; hostUserId: string | null }[]> {
  return prisma.tiktokRoom.findMany({
    where: { hostUserId, id: { not: excludeRoomId } },
    select: { id: true, tiktokId: true, hostUserId: true },
  });
}

export type AbsorbStats = {
  giftsMoved: number;
  giftsDiscarded: number;
  giftEditsDiscarded: number;
  likeTalliesMerged: number;
  likeTalliesMoved: number;
  likeTalliesDiscarded: number;
  battlesMoved: number;
  battlesDiscarded: number;
  battleHistoriesMoved: number;
  battleHistoriesDiscarded: number;
  agencyWatchesMoved: number;
  agencyWatchesDiscarded: number;
  eventParticipantsMoved: number;
  eventParticipantsDiscarded: number;
  eventRoomLeasesMoved: number;
  eventRoomLeasesDiscarded: number;
  streamersMoved: number;
};

export type AbsorbOutcome =
  | { kind: "merged"; stats: AbsorbStats }
  | { kind: "event_active" }
  | { kind: "lock_unavailable" }
  /** TOCTOU 再確認で room が消えていた/hostUserId が変わっていた。呼び出し側は次周回に回す。 */
  | { kind: "stale" };

/**
 * 候補 room(O)を現ハンドルの room(N)へ ABSORB する。**候補1件ごとに1トランザクション**
 * (全候補を1つの tx に詰めると Gift 数万件×複数候補で tx timeout を超えうるうえ、
 * 1件でも EVENT_ACTIVE なら全部やり直しになるため)。
 *
 * 呼び出し前提: O・N とも `hostUserId === expectedHostUserId` であることを呼び出し側が
 * 確認済み(3条件のうち2つ)。旧ハンドルが MISSING であることの確認(3つ目)も
 * 呼び出し側の責務(TikTok 照会をこの関数に持ち込まない)。
 */
export async function absorbRooms(
  survivingRoomId: string,
  candidateRoomId: string,
  expectedHostUserId: string,
  newTiktokIdRaw: string
): Promise<AbsorbOutcome> {
  return prisma.$transaction(
    async (tx) => {
      // room 単位の advisory lock。デッドロック回避のため roomId の辞書順で取る。
      const [first, second] = [survivingRoomId, candidateRoomId].sort();
      const lock1 = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
        first
      );
      if (!lock1[0]?.locked) return { kind: "lock_unavailable" as const };
      const lock2 = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
        second
      );
      if (!lock2[0]?.locked) return { kind: "lock_unavailable" as const };

      // TOCTOU 再確認: 両 room が存在するか。安全性を担保するのは candidate 側の
      // hostUserId 一致だけでよい(合流可否は候補側の3条件が担保する設計。呼び出し元の
      // runMergeJob 参照)。survivor 側にも一致を要求すると、ハンドル再利用で survivor の
      // 保存済み hostUserId が意図的に(fill-once規律により)更新されない mismatch ケースで
      // 絶対に一致せず、MISSING 候補が存在するかぎり毎回 stale になり合流が構造的に
      // 成立しない永久ループになる。
      const [survivor, candidate] = await Promise.all([
        tx.tiktokRoom.findUnique({
          where: { id: survivingRoomId },
          select: { id: true, hostUserId: true },
        }),
        tx.tiktokRoom.findUnique({
          where: { id: candidateRoomId },
          select: { id: true, hostUserId: true },
        }),
      ]);
      if (!survivor || !candidate) return { kind: "stale" as const };
      if (candidate.hostUserId !== expectedHostUserId) {
        return { kind: "stale" as const };
      }

      // EVENT_ACTIVE 判定: 未 finalize のイベントの EventParticipant、
      // または未解放(releasedAt: null)の EventRoomLease が候補 room を参照していないか。
      const activeParticipants = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count
           FROM event."EventParticipant" ep
           JOIN event."Event" e ON e."id" = ep."eventId"
          WHERE ep."roomId" = $1 AND e."finalizedAt" IS NULL`,
        candidateRoomId
      );
      if (Number(activeParticipants[0]?.count ?? 0) > 0) {
        return { kind: "event_active" as const };
      }
      const activeLeases = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count
           FROM event."EventRoomLease"
          WHERE "roomId" = $1 AND "releasedAt" IS NULL`,
        candidateRoomId
      );
      if (Number(activeLeases[0]?.count ?? 0) > 0) {
        return { kind: "event_active" as const };
      }

      const stats: AbsorbStats = {
        giftsMoved: 0,
        giftsDiscarded: 0,
        giftEditsDiscarded: 0,
        likeTalliesMerged: 0,
        likeTalliesMoved: 0,
        likeTalliesDiscarded: 0,
        battlesMoved: 0,
        battlesDiscarded: 0,
        battleHistoriesMoved: 0,
        battleHistoriesDiscarded: 0,
        agencyWatchesMoved: 0,
        agencyWatchesDiscarded: 0,
        eventParticipantsMoved: 0,
        eventParticipantsDiscarded: 0,
        eventRoomLeasesMoved: 0,
        eventRoomLeasesDiscarded: 0,
        streamersMoved: 0,
      };

      // --- 1. Gift ---
      // orderId は本番で 100% null。IS NOT DISTINCT FROM は使わない
      // (NULL同士を「一致」と評価するため、新roomにNULL-orderIdのGiftが1件でもあると
      //  旧roomのGiftが1件も移動されず、続くDELETEで全滅する)。
      const giftsMoved = await tx.$executeRawUnsafe(
        `UPDATE public."gifts" g SET "roomId" = $1
           WHERE g."roomId" = $2
             AND (g."orderId" IS NULL
                  OR NOT EXISTS (
                    SELECT 1 FROM public."gifts" d
                     WHERE d."roomId" = $1 AND d."orderId" = g."orderId"
                  ))`,
        survivingRoomId,
        candidateRoomId
      );
      stats.giftsMoved = giftsMoved;

      const remainingGifts = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM public."gifts" WHERE "roomId" = $1`,
        candidateRoomId
      );
      stats.giftsDiscarded = remainingGifts.length;
      if (remainingGifts.length > 0) {
        const editCount = await tx.$queryRawUnsafe<{ count: bigint }[]>(
          `SELECT COUNT(*)::bigint AS count FROM public."gift_edits" WHERE "giftId" = ANY($1::text[])`,
          remainingGifts.map((r) => r.id)
        );
        stats.giftEditsDiscarded = Number(editCount[0]?.count ?? 0);
      }
      await tx.$executeRawUnsafe(`DELETE FROM public."gifts" WHERE "roomId" = $1`, candidateRoomId);

      // --- 2. LikeTally ---
      // 衝突(roomId,dayKey,uniqueId)は合算 → 衝突行DELETE → 残り(非衝突)を移動。
      const merged = await tx.$executeRawUnsafe(
        `UPDATE public.like_tallies s
            SET "totalLikes" = s."totalLikes" + o."totalLikes", "updatedAt" = now()
           FROM public.like_tallies o
          WHERE s."roomId" = $1 AND o."roomId" = $2
            AND s."dayKey" = o."dayKey" AND s."uniqueId" = o."uniqueId"`,
        survivingRoomId,
        candidateRoomId
      );
      stats.likeTalliesMerged = merged;
      await tx.$executeRawUnsafe(
        `DELETE FROM public.like_tallies o
          USING public.like_tallies s
          WHERE o."roomId" = $2 AND s."roomId" = $1
            AND s."dayKey" = o."dayKey" AND s."uniqueId" = o."uniqueId"`,
        survivingRoomId,
        candidateRoomId
      );
      const likeTalliesMoved = await tx.$executeRawUnsafe(
        `UPDATE public.like_tallies SET "roomId" = $1 WHERE "roomId" = $2`,
        survivingRoomId,
        candidateRoomId
      );
      stats.likeTalliesMoved = likeTalliesMoved;

      // --- 3. TiktokBattle(unique [roomId,battleId]) ---
      // 衝突は endedAt IS NOT NULL を優先して残す(同条件ならN=survivor優先)。
      const battleConflicts = await tx.$queryRawUnsafe<
        { oId: string; nId: string | null; oEndedAt: Date | null; nEndedAt: Date | null }[]
      >(
        `SELECT o."id" AS "oId", n."id" AS "nId", o."endedAt" AS "oEndedAt", n."endedAt" AS "nEndedAt"
           FROM public."tiktok_battles" o
           LEFT JOIN public."tiktok_battles" n
             ON n."roomId" = $1 AND n."battleId" = o."battleId"
          WHERE o."roomId" = $2`,
        survivingRoomId,
        candidateRoomId
      );
      for (const row of battleConflicts) {
        if (row.nId === null) {
          // 衝突なし。roomId を付け替える。
          await tx.$executeRawUnsafe(`UPDATE public."tiktok_battles" SET "roomId" = $1 WHERE "id" = $2`, survivingRoomId, row.oId);
          stats.battlesMoved++;
          continue;
        }
        // 衝突。O の方が情報が多ければ(endedAt あり、N は無し)入れ替えてから O を消す。
        const preferOld = row.oEndedAt !== null && row.nEndedAt === null;
        if (preferOld) {
          await tx.$executeRawUnsafe(
            `UPDATE public."tiktok_battles" o
                SET "action" = old."action", "startedAt" = old."startedAt",
                    "startedAtEstimated" = old."startedAtEstimated", "endedAt" = old."endedAt",
                    "durationSec" = old."durationSec", "hostUserIds" = old."hostUserIds",
                    "hostDisplayIds" = old."hostDisplayIds", "hostScores" = old."hostScores",
                    "hostProfiles" = old."hostProfiles", "hostTeams" = old."hostTeams",
                    "raw" = old."raw", "updatedAt" = now()
               FROM public."tiktok_battles" old
              WHERE o."id" = $1 AND old."id" = $2`,
            row.nId,
            row.oId
          );
        }
        await tx.$executeRawUnsafe(`DELETE FROM public."tiktok_battles" WHERE "id" = $1`, row.oId);
        stats.battlesDiscarded++;
      }

      // --- 4. BattleHistory(unique [roomId,battleId]) ---
      // 衝突は sourceUpdatedAt が大きい方を残す(同値ならN=survivor優先)。
      const historyConflicts = await tx.$queryRawUnsafe<
        { oId: string; nId: string | null; oUpdatedAt: Date; nUpdatedAt: Date | null }[]
      >(
        `SELECT o."id" AS "oId", n."id" AS "nId", o."sourceUpdatedAt" AS "oUpdatedAt", n."sourceUpdatedAt" AS "nUpdatedAt"
           FROM public."battle_histories" o
           LEFT JOIN public."battle_histories" n
             ON n."roomId" = $1 AND n."battleId" = o."battleId"
          WHERE o."roomId" = $2`,
        survivingRoomId,
        candidateRoomId
      );
      for (const row of historyConflicts) {
        if (row.nId === null) {
          await tx.$executeRawUnsafe(`UPDATE public."battle_histories" SET "roomId" = $1 WHERE "id" = $2`, survivingRoomId, row.oId);
          stats.battleHistoriesMoved++;
          continue;
        }
        const preferOld = row.nUpdatedAt === null || row.oUpdatedAt > row.nUpdatedAt;
        if (preferOld) {
          // O を残す側にするため、N の子行を先に消してから O の roomId を N の battleId 位置へ差し替える。
          await tx.$executeRawUnsafe(`DELETE FROM public."battle_histories" WHERE "id" = $1`, row.nId);
          await tx.$executeRawUnsafe(`UPDATE public."battle_histories" SET "roomId" = $1 WHERE "id" = $2`, survivingRoomId, row.oId);
        } else {
          await tx.$executeRawUnsafe(`DELETE FROM public."battle_histories" WHERE "id" = $1`, row.oId);
        }
        stats.battleHistoriesDiscarded++;
      }

      // --- 5. AgencyWatch(unique [agencyId,roomId]) ---
      // 同じ事務所が両方監視していたら O 側を削除、それ以外は roomId を N へ。
      await tx.$executeRawUnsafe(
        `DELETE FROM public."AgencyWatch" o
          WHERE o."roomId" = $2
            AND EXISTS (SELECT 1 FROM public."AgencyWatch" n WHERE n."roomId" = $1 AND n."agencyId" = o."agencyId")`,
        survivingRoomId,
        candidateRoomId
      );
      const watchesMoved = await tx.$executeRawUnsafe(
        `UPDATE public."AgencyWatch" SET "roomId" = $1 WHERE "roomId" = $2`,
        survivingRoomId,
        candidateRoomId
      );
      stats.agencyWatchesMoved = watchesMoved;

      // --- 5.5 EventParticipant(finalize済みイベント参加分のみ残っている想定。
      //     未finalizeは上の EVENT_ACTIVE 判定で弾き済み) ---
      // roomId を N へ付け替える(tiktokId は表示名と独立の論理参照なので触らない)。
      // unique[eventId,roomId] 衝突(同じイベントに新旧ハンドルで二重登録されていた)は O 側を削除。
      await tx.$executeRawUnsafe(
        `DELETE FROM event."EventParticipant" o
          WHERE o."roomId" = $2
            AND EXISTS (SELECT 1 FROM event."EventParticipant" n WHERE n."roomId" = $1 AND n."eventId" = o."eventId")`,
        survivingRoomId,
        candidateRoomId
      );
      const participantsMoved = await tx.$executeRawUnsafe(
        `UPDATE event."EventParticipant" SET "roomId" = $1 WHERE "roomId" = $2`,
        survivingRoomId,
        candidateRoomId
      );
      stats.eventParticipantsMoved = participantsMoved;

      // --- 6. EventRoomLease(解放済みのみ残っている想定。未解放は上で EVENT_ACTIVE 判定済み) ---
      // roomId・tiktokId を N へ付け替え、unique[eventId,roomId] 衝突なら O 側の行を削除。
      await tx.$executeRawUnsafe(
        `DELETE FROM event."EventRoomLease" o
          WHERE o."roomId" = $2
            AND EXISTS (SELECT 1 FROM event."EventRoomLease" n WHERE n."roomId" = $1 AND n."eventId" = o."eventId")`,
        survivingRoomId,
        candidateRoomId
      );
      const leasesMoved = await tx.$executeRawUnsafe(
        `UPDATE event."EventRoomLease" SET "roomId" = $1, "tiktokId" = $3 WHERE "roomId" = $2`,
        survivingRoomId,
        candidateRoomId,
        normalizeTiktokId(newTiktokIdRaw)
      );
      stats.eventRoomLeasesMoved = leasesMoved;

      // --- 7. Streamer ---
      // roomId と tiktokId を同時に書き換える(片方だけだと resolveRoomForStreamer が
      // 食い違いを検知して空の新roomへ自己修復的に付け替え、履歴を無言で失わせる)。
      const streamersMoved = await tx.streamer.updateMany({
        where: { roomId: candidateRoomId },
        data: { roomId: survivingRoomId, tiktokId: newTiktokIdRaw },
      });
      stats.streamersMoved = streamersMoved.count;

      // Streamer.room は optional relation で onDelete 未指定 = SetNull。
      // 削除直前に0件であることを確認する(手順7と9の間に O へ attach された新規登録が
      // 黙って roomId:null に落ちるのを検知するため。0件でなければロールバックさせる)。
      const remainingStreamers = await tx.streamer.count({ where: { roomId: candidateRoomId } });
      if (remainingStreamers > 0) {
        throw new Error(
          `absorbRooms: room ${candidateRoomId} に Streamer が ${remainingStreamers}件残っている(削除直前の競合)`
        );
      }

      await tx.tiktokRoom.delete({ where: { id: candidateRoomId } });

      return { kind: "merged" as const, stats };
    },
    { timeout: 60_000, maxWait: 10_000 }
  );
}

// --- ジョブ実行(mergeTick から呼ばれる) ---

/** `EXISTS`(旧ハンドル生存)を理由に保留した回数の上限。超えたら failed に落とす。 */
export const MERGE_JOB_MAX_ATTEMPTS = Number(process.env.TIKTOK_ID_MERGE_MAX_ATTEMPTS ?? 10);

/**
 * `EXISTS` は改名直後の一時的な予約・リダイレクトである可能性がある(未検証の仮定を
 * 前提にしない)。24h バックオフで数回(計7〜30日)再確認してから failed に落とす。
 */
const OLD_HANDLE_ALIVE_RETRY_MS = 24 * 60 * 60 * 1000;
/** イベント終了待ちの再確認間隔。 */
const EVENT_ACTIVE_RETRY_MS = 60 * 60 * 1000;
/** advisory lock 不可・TOCTOU stale・現ハンドル未確定時の短い再試行間隔。 */
const TRANSIENT_RETRY_MS = 5 * 60 * 1000;

export type MergeJobLike = { id: string; streamerId: string; tiktokId: string; attempts: number };

/**
 * pending な1ジョブを処理する。**失敗しても投げない**(呼び出し元の周を止めない)。
 *
 * 実行順序は固定(mobile PATCH が streamer.update() と resolveRoomForStreamer() を
 * 非トランザクションで別ステートメントに分けているため、mergeTick 実行時点で
 * Streamer.roomId が旧room のままだったり null だったりしうる):
 *   1. 現ハンドルの形式検証
 *   2. room 整合性ガード(Streamer.roomId が現ハンドルの room を指しているか確認・修復)
 *   3. 現ハンドルの userId を毎回 TikTok から確定(保存済み値を無条件に信用しない)
 *   4. 候補探索・実在確認・ABSORB 実行
 */
export async function runMergeJob(job: MergeJobLike): Promise<void> {
  const now = new Date();

  const streamer = await prisma.streamer.findUnique({
    where: { id: job.streamerId },
    select: { id: true, tiktokId: true, roomId: true },
  });

  // CAS: 処理開始時と同じ tiktokId のときだけ完了を書く。処理中に新しい tiktokId で
  // 別の upsert が走っていたら(A→B→C の連続変更)、この完了書き込みで新しい pending を
  // 握り潰さない。
  const finish = (
    status: "pending" | "done" | "failed",
    nextAttemptAt: Date,
    opts?: { consumeAttempt?: boolean; lastError?: string }
  ) =>
    prisma.tiktokIdMergeJob.updateMany({
      where: { id: job.id, tiktokId: job.tiktokId },
      data: {
        status,
        nextAttemptAt,
        ...(opts?.consumeAttempt ? { attempts: { increment: 1 } } : {}),
        lastError: opts?.lastError ?? null,
        updatedAt: now,
      },
    });

  if (!streamer) {
    // Streamer 自体が消えている(退会等)。合流対象が無いので終える。
    await finish("done", now);
    return;
  }

  const currentHandleRaw = streamer.tiktokId;
  const currentHandle = normalizeTiktokId(currentHandleRaw);

  if (!TIKTOK_ID_PATTERN.test(currentHandle)) {
    await finish("failed", now, { consumeAttempt: true, lastError: "invalid tiktokId format" });
    return;
  }

  let roomId = streamer.roomId;
  let room = roomId
    ? await prisma.tiktokRoom.findUnique({
        where: { id: roomId },
        select: { id: true, tiktokId: true, hostUserId: true },
      })
    : null;
  if (!room || normalizeTiktokId(room.tiktokId) !== currentHandle) {
    roomId = await resolveRoomForStreamer(streamer.id);
    room = await prisma.tiktokRoom.findUnique({
      where: { id: roomId },
      select: { id: true, tiktokId: true, hostUserId: true },
    });
  }
  if (!room) {
    await finish("pending", new Date(now.getTime() + TRANSIENT_RETRY_MS));
    return;
  }

  // 現ハンドルの userId を確定する。保存済みの値があっても毎回突き合わせる
  // (ハンドル再利用で前の持ち主の userId が残っている可能性があるため)。
  const profileResult = await fetchTiktokProfile(currentHandle);

  if (!profileResult.ok) {
    if (profileResult.reason === "NOT_FOUND" && profileResult.explicitNotFound === true) {
      await recordMergeLog({
        streamerId: streamer.id,
        userId: "unknown",
        outcome: "SELF_NOT_FOUND",
        newTiktokId: currentHandleRaw,
        survivingRoomId: room.id,
      });
      await finish("failed", now, {
        consumeAttempt: true,
        lastError: "self handle not found on TikTok",
      });
      return;
    }
    // レート制限・一時エラー。保留して次周回で再試行する(attempts は消費しない)。
    await finish("pending", new Date(now.getTime() + TRANSIENT_RETRY_MS));
    return;
  }
  if (profileResult.profile.userId === null) {
    await finish("pending", new Date(now.getTime() + TRANSIENT_RETRY_MS));
    return;
  }
  const currentUserId = profileResult.profile.userId;

  let hostUserIdFilledAt: Date | null = null;
  if (room.hostUserId === null) {
    await saveHostUserIdOnce(room.id, currentUserId);
    hostUserIdFilledAt = now;
  } else if (room.hostUserId !== currentUserId) {
    // ハンドル再利用の正常系。**保存値には触れず候補探索は続行する。** ここで打ち切ると、
    // 新しい正当な持ち主自身の合流(自分の旧ハンドル room)まで恒久ブロックされる。
    await recordMergeLog({
      streamerId: streamer.id,
      userId: currentUserId,
      outcome: "BLOCKED_HOST_MISMATCH",
      newTiktokId: currentHandleRaw,
      survivingRoomId: room.id,
      hostUserId: room.hostUserId,
    });
  }

  const candidates = await detectMergeCandidates(currentUserId, room.id);
  if (candidates.length === 0) {
    await recordMergeLog({
      streamerId: streamer.id,
      userId: currentUserId,
      outcome: "NO_CANDIDATE",
      newTiktokId: currentHandleRaw,
      survivingRoomId: room.id,
      hostUserId: currentUserId,
      hostUserIdFilledAt,
    });
    await finish("done", now);
    return;
  }

  let hasBlockedAlive = false;
  let hasEventActive = false;
  let hasTransientRetry = false;
  let hasUnverified = false;

  // 仕様4: 候補が複数あれば全部処理する(単一候補への限定はしない)。
  for (const candidate of candidates) {
    const existence = await checkAccountExistence(candidate.tiktokId);

    if (existence.verdict === "UNVERIFIED") {
      // 「消えている」と扱わない(fail-closed)。次周回で再試行する。
      hasUnverified = true;
      continue;
    }

    if (existence.verdict === "EXISTS") {
      hasBlockedAlive = true;
      await recordMergeLog({
        streamerId: streamer.id,
        userId: currentUserId,
        outcome: "BLOCKED_OLD_HANDLE_ALIVE",
        oldTiktokId: candidate.tiktokId,
        newTiktokId: currentHandleRaw,
        oldRoomId: candidate.id,
        survivingRoomId: room.id,
        hostUserId: currentUserId,
      });
      continue;
    }

    // MISSING。3条件が揃ったので合流を実行する。
    const result = await absorbRooms(room.id, candidate.id, currentUserId, currentHandleRaw);
    if (result.kind === "merged") {
      await recordMergeLog({
        streamerId: streamer.id,
        userId: currentUserId,
        outcome: "MERGED",
        oldTiktokId: candidate.tiktokId,
        newTiktokId: currentHandleRaw,
        oldRoomId: candidate.id,
        survivingRoomId: room.id,
        hostUserId: currentUserId,
        hostUserIdFilledAt,
        stats: result.stats,
      });
    } else if (result.kind === "event_active") {
      hasEventActive = true;
      await recordMergeLog({
        streamerId: streamer.id,
        userId: currentUserId,
        outcome: "EVENT_ACTIVE",
        oldTiktokId: candidate.tiktokId,
        newTiktokId: currentHandleRaw,
        oldRoomId: candidate.id,
        survivingRoomId: room.id,
        hostUserId: currentUserId,
      });
    } else {
      // lock_unavailable / stale。ログは残さず次周回で自然に再試行する。
      hasTransientRetry = true;
    }
  }

  if (hasUnverified || hasTransientRetry) {
    await finish("pending", new Date(now.getTime() + TRANSIENT_RETRY_MS));
    return;
  }
  if (hasEventActive) {
    // EVENT_ACTIVE でスキップしたジョブの nextAttemptAt は必ず進める(先頭詰まりの回避)。
    await finish("pending", new Date(now.getTime() + EVENT_ACTIVE_RETRY_MS));
    return;
  }
  if (hasBlockedAlive) {
    const nextAttempts = job.attempts + 1;
    if (nextAttempts >= MERGE_JOB_MAX_ATTEMPTS) {
      await finish("failed", now, {
        consumeAttempt: true,
        lastError: "old handle still alive after max attempts",
      });
    } else {
      await finish("pending", new Date(now.getTime() + OLD_HANDLE_ALIVE_RETRY_MS), {
        consumeAttempt: true,
      });
    }
    return;
  }

  // 残った候補は全て MERGED(または最初から0件のNO_CANDIDATEは上で処理済み)。
  await finish("done", now);
}

/** pending なジョブを拾って処理する。event-worker の mergeTick() から呼ばれる。 */
export async function processPendingMergeJobs(
  maxPerRun: number
): Promise<{ processed: number }> {
  const jobs = await prisma.tiktokIdMergeJob.findMany({
    where: { status: "pending", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: maxPerRun,
    select: { id: true, streamerId: true, tiktokId: true, attempts: true },
  });

  for (const job of jobs) {
    try {
      await runMergeJob(job);
    } catch (err) {
      console.error(`[tiktok-id-migration] job ${job.id} の処理に失敗:`, err);
      // tx timeout 等の例外が連続するジョブは attempts 上限に達したら failed に落とす
      // (runMergeJob 内の一時エラー・UNVERIFIED は意図的に attempts を消費せず無期限再試行するが、
      // 例外は明確な異常なので同じ扱いにしない)。
      const nextAttempts = job.attempts + 1;
      const giveUp = nextAttempts >= MERGE_JOB_MAX_ATTEMPTS;
      await prisma.tiktokIdMergeJob
        .updateMany({
          where: { id: job.id, tiktokId: job.tiktokId },
          data: {
            status: giveUp ? "failed" : "pending",
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + TRANSIENT_RETRY_MS),
            lastError: err instanceof Error ? err.message : String(err),
            updatedAt: new Date(),
          },
        })
        .catch(() => {});
    }
  }

  return { processed: jobs.length };
}
