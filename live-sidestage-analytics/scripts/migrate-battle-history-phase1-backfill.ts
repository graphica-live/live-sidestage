// バトル履歴データ構造刷新(Phase1 Expand段階)のバックフィルスクリプト。
// schema.prisma への新列・新テーブル追加(db push、加算のみで安全)が適用済みであること前提。
//
// 対象:
//   - BattleTeam: 旧BattleHistoryごとにside("self"|"opponent")基準で2チーム分を生成
//   - BattleHistoryParticipant: battleTeamId/roomId/isSelf/uniqueIdSnapshot/nicknameSnapshot/
//     officialScore/observedGiftTotal/captureStatus等を埋める
//   - BattleHistoryGiftEvent: 自room(self participant)分のみ、Gift原本(receivedAtがwindow内)
//     から個々のギフトイベントを再構築する。相手room分は旧構造では元々記録されていないため対象外。
//
// 冪等: BattleHistory単位で、既にbattleTeamIdが埋まっている(=処理済み)なら丸ごとスキップする。
// BattleHistoryごとに1トランザクションで処理し(全体を1トランザクションにするとロック時間が
// 見積もれないため)、失敗した行だけログに残して次へ進む。
//
// **Cutover(読み出し側を新構造基準へ切り替える)直前にもう一度実行すること。** Phase1時点では
// 確定処理(battle-history-finalize.ts)がまだ旧形式のまま書き続けるため、初回実行後もCutoverまでの
// 間に新規確定したバトルは未処理のまま残る(冪等なので再実行すれば拾われる)。
import { prisma } from "../src/lib/prisma";

const TAG = "[migrate-battle-history-phase1-backfill]";

async function main() {
  console.log(`${TAG} 開始します。`);

  const rooms = await prisma.tiktokRoom.findMany({
    where: { hostUserId: { not: null } },
    select: { id: true, hostUserId: true },
  });
  // hostUserIdはunique制約が無く、改名合流前の重複Roomが存在しうる(schema.prismaの
  // TiktokRoom.hostUserIdコメント参照)。重複を検出したら安全側に倒し、その
  // hostUserIdは解決不能(null)として扱う(誤ったroomIdを割り当てるより望ましい)。
  const hostUserIdCounts = new Map<string, number>();
  for (const r of rooms) {
    if (!r.hostUserId) continue;
    hostUserIdCounts.set(r.hostUserId, (hostUserIdCounts.get(r.hostUserId) ?? 0) + 1);
  }
  const roomIdByHostUserId = new Map<string, string>();
  const hostUserIdByRoomId = new Map<string, string>();
  for (const r of rooms) {
    if (!r.hostUserId) continue;
    hostUserIdByRoomId.set(r.id, r.hostUserId);
    if (hostUserIdCounts.get(r.hostUserId) === 1) {
      roomIdByHostUserId.set(r.hostUserId, r.id);
    } else {
      console.warn(`${TAG} hostUserId=${r.hostUserId} が複数Roomで重複。roomId解決を諦めます。`);
    }
  }

  const targets = await prisma.battleHistory.findMany({
    where: { participants: { some: { battleTeamId: null } } },
    select: { id: true },
  });

  console.log(`${TAG} 対象BattleHistory: ${targets.length}件`);

  let ok = 0;
  let failed = 0;

  for (const { id: battleHistoryId } of targets) {
    try {
      await migrateOne(battleHistoryId, roomIdByHostUserId, hostUserIdByRoomId);
      ok++;
    } catch (err) {
      failed++;
      console.error(`${TAG} battleHistoryId=${battleHistoryId} 失敗:`, err);
    }
  }

  console.log(`${TAG} 完了。成功=${ok} 失敗=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

async function migrateOne(
  battleHistoryId: string,
  roomIdByHostUserId: Map<string, string>,
  hostUserIdByRoomId: Map<string, string>,
) {
  await prisma.$transaction(
    async (tx) => {
      const battleHistory = await tx.battleHistory.findUniqueOrThrow({
        where: { id: battleHistoryId },
        select: { id: true, roomId: true, windowStart: true, windowEnd: true, selfScore: true, opponentScore: true },
      });

      const participants = await tx.battleHistoryParticipant.findMany({
        where: { battleHistoryId },
        select: {
          id: true,
          side: true,
          anchorId: true,
          displayId: true,
          nickName: true,
          score: true,
          battleTeamId: true,
        },
      });

      // 既に処理済み(冪等)
      if (participants.length > 0 && participants.every((p) => p.battleTeamId !== null)) {
        return;
      }

      const selfTeam = await tx.battleTeam.create({
        data: { battleHistoryId, externalTeamId: null, officialScore: battleHistory.selfScore },
      });
      const opponentTeam = await tx.battleTeam.create({
        data: { battleHistoryId, externalTeamId: null, officialScore: battleHistory.opponentScore },
      });

      // GiftEvent(自room分のギフト)の帰属先は、旧構造のGiftが常にbattleHistory.roomId
      // (=このRoomのhostUserId)視点で保存されているため、side="self"の中でも
      // hostUserIdと一致するparticipantに決定的に紐付ける必要がある。チーム戦(2v2等)では
      // side="self"のparticipantが複数存在しうるため、for文中の最後の1人への上書き(非決定的)
      // にしてはいけない。
      const selfCandidates = participants.filter((p) => p.side === "self");
      const selfRoomHostUserId = hostUserIdByRoomId.get(battleHistory.roomId);
      const primarySelf =
        selfCandidates.find((p) => p.anchorId === selfRoomHostUserId) ??
        [...selfCandidates].sort((a, b) => a.anchorId.localeCompare(b.anchorId))[0] ??
        null;
      const selfParticipantId = primarySelf?.id ?? null;

      for (const p of participants) {
        const isSelf = p.side === "self";
        const roomId = isSelf ? battleHistory.roomId : roomIdByHostUserId.get(p.anchorId) ?? null;

        await tx.battleHistoryParticipant.update({
          where: { id: p.id },
          data: {
            battleTeamId: isSelf ? selfTeam.id : opponentTeam.id,
            isSelf,
            roomId,
            uniqueIdSnapshot: p.displayId,
            nicknameSnapshot: p.nickName,
            officialScore: p.score,
            captureStatus: "unavailable",
            captureCoverage: null,
          },
        });
      }

      // 自room分のギフトイベントをGift原本から再構築する。相手room分は旧構造で
      // 元々記録されていないため対象外(過去バトルは新構造でもopponent側のGiftEventが空のまま)。
      if (selfParticipantId) {
        const existingCount = await tx.battleHistoryGiftEvent.count({
          where: { participantId: selfParticipantId },
        });

        if (existingCount === 0) {
          const gifts = await tx.gift.findMany({
            where: {
              roomId: battleHistory.roomId,
              receivedAt: { gte: battleHistory.windowStart, lte: battleHistory.windowEnd },
            },
            select: {
              id: true,
              receivedAt: true,
              uniqueId: true,
              nickname: true,
              giftId: true,
              giftName: true,
              repeatCount: true,
              diamondCount: true,
              totalDiamonds: true,
              multiplierType: true,
              multiplierValue: true,
            },
          });

          if (gifts.length > 0) {
            await tx.battleHistoryGiftEvent.createMany({
              data: gifts.map((g) => ({
                participantId: selfParticipantId!,
                occurredAt: g.receivedAt,
                senderUniqueIdSnapshot: g.uniqueId,
                senderNicknameSnapshot: g.nickname,
                senderTiktokUserId: null,
                giftId: g.giftId,
                giftNameSnapshot: g.giftName,
                repeatCount: g.repeatCount,
                diamondCount: g.diamondCount,
                totalDiamonds: g.totalDiamonds,
                multiplierType: g.multiplierType,
                multiplierValue: g.multiplierValue,
                sourceGiftId: g.id,
              })),
            });
          }

          const observedGiftTotal = gifts.reduce((sum, g) => sum + g.totalDiamonds, 0);
          await tx.battleHistoryParticipant.update({
            where: { id: selfParticipantId },
            data: { observedGiftTotal },
          });
        }
      }
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

main()
  .catch((err) => {
    console.error(`${TAG} 想定外の失敗:`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
