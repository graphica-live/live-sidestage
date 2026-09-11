-- 注意: 本番デプロイは `prisma db push --accept-data-loss` を使用しており、このファイルは
-- 実行されない(db pushはmigrationsフォルダを読まない)。
--
-- このmigrationは prisma/schema.prisma に対する6コミット分のmigration drift
-- (git履歴には反映済みだがmigrationファイルが作られていなかった変更)を、
-- 事後的に記録として整合させるためだけに作成した。本番Postgresは既に
-- `prisma db pull` / `prisma migrate diff` で schema.prisma と差分ゼロと確認済みで、
-- このファイルが実行対象になることも想定していない。
--
-- 対象コミット(コミット順):
--   0b87fb6 TiktokBattleItemUse新規追加
--   5f36a1c バトル履歴データ構造刷新Phase1(最大の変更)
--   77b3ef8 旧テーブルBattleHistoryContributor削除(Phase3 Contract完了)
--   b5ea4f8 TiktokIdMergeJob, TiktokIdMergeLog新規追加(Phase2)
--   78b13e5 TiktokRoomへhostUserId関連カラム追加
--   f1bea55 TiktokIdMergeLogへacknowledgedAt追加(b5ea4f8作成のTiktokIdMergeLogへ
--            直接含めて記録する。本番未実行のCREATE TABLEを2段階に分ける意味がないため)

-- =========================================================================
-- 0b87fb6: TiktokBattleItemUse新規追加
-- =========================================================================

CREATE TABLE "tiktok_battle_item_uses" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "cardType" INTEGER NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "senderUniqueId" TEXT NOT NULL,
    "senderNickname" TEXT NOT NULL,
    "senderProfilePictureUrl" TEXT,
    "targetHostUserId" TEXT NOT NULL,
    "msgId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tiktok_battle_item_uses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tiktok_battle_item_uses_roomId_battleId_idx" ON "tiktok_battle_item_uses"("roomId", "battleId");
CREATE INDEX "tiktok_battle_item_uses_roomId_msgId_idx" ON "tiktok_battle_item_uses"("roomId", "msgId");

ALTER TABLE "tiktok_battle_item_uses" ADD CONSTRAINT "tiktok_battle_item_uses_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TiktokRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- 5f36a1c: バトル履歴データ構造刷新Phase1
-- =========================================================================

-- RoomMonitorLease新規テーブル
CREATE TABLE "room_monitor_leases" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "room_monitor_leases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "room_monitor_leases_roomId_reason_referenceId_key" ON "room_monitor_leases"("roomId", "reason", "referenceId");
CREATE INDEX "room_monitor_leases_roomId_releasedAt_expiresAt_idx" ON "room_monitor_leases"("roomId", "releasedAt", "expiresAt");

ALTER TABLE "room_monitor_leases" ADD CONSTRAINT "room_monitor_leases_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TiktokRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RoomConnectionInterval新規テーブル
CREATE TABLE "room_connection_intervals" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "disconnectReason" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_connection_intervals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "room_connection_intervals_roomId_startedAt_idx" ON "room_connection_intervals"("roomId", "startedAt");
CREATE INDEX "room_connection_intervals_roomId_endedAt_idx" ON "room_connection_intervals"("roomId", "endedAt");

ALTER TABLE "room_connection_intervals" ADD CONSTRAINT "room_connection_intervals_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TiktokRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Giftへmultiplierフィールド追加
ALTER TABLE "gifts" ADD COLUMN "multiplierType" INTEGER;
ALTER TABLE "gifts" ADD COLUMN "multiplierValue" INTEGER;

-- TiktokBattleBonusMission新規テーブル
CREATE TABLE "tiktok_battle_bonus_missions" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "targetType" INTEGER NOT NULL,
    "progressTarget" INTEGER NOT NULL,
    "rewardMultiple" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "taskResult" INTEGER,
    "rewardStartedAt" TIMESTAMP(3),
    "rewardEndedAt" TIMESTAMP(3),
    "rewardSum" INTEGER,

    CONSTRAINT "tiktok_battle_bonus_missions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tiktok_battle_bonus_missions_roomId_battleId_idx" ON "tiktok_battle_bonus_missions"("roomId", "battleId");

ALTER TABLE "tiktok_battle_bonus_missions" ADD CONSTRAINT "tiktok_battle_bonus_missions_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TiktokRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TiktokBattleArmiesSnapshot新規テーブル
CREATE TABLE "tiktok_battle_armies_snapshots" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anchorId" TEXT NOT NULL,
    "score" TEXT NOT NULL,

    CONSTRAINT "tiktok_battle_armies_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tiktok_battle_armies_snapshots_roomId_battleId_occurredAt_idx" ON "tiktok_battle_armies_snapshots"("roomId", "battleId", "occurredAt");

ALTER TABLE "tiktok_battle_armies_snapshots" ADD CONSTRAINT "tiktok_battle_armies_snapshots_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TiktokRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BattleHistoryへopeningMultiplier系フィールド追加
ALTER TABLE "battle_histories" ADD COLUMN "openingMultiplier" INTEGER;
ALTER TABLE "battle_histories" ADD COLUMN "openingMultiplierBasisGiftId" TEXT;

-- BattleTeam新規テーブル
CREATE TABLE "battle_teams" (
    "id" TEXT NOT NULL,
    "battleHistoryId" TEXT NOT NULL,
    "externalTeamId" TEXT,
    "officialScore" TEXT,

    CONSTRAINT "battle_teams_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "battle_teams_battleHistoryId_idx" ON "battle_teams"("battleHistoryId");

ALTER TABLE "battle_teams" ADD CONSTRAINT "battle_teams_battleHistoryId_fkey" FOREIGN KEY ("battleHistoryId") REFERENCES "battle_histories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BattleHistoryParticipantへ大量フィールド追加+新リレーション
ALTER TABLE "battle_history_participants" ADD COLUMN "battleTeamId" TEXT;
ALTER TABLE "battle_history_participants" ADD COLUMN "roomId" TEXT;
ALTER TABLE "battle_history_participants" ADD COLUMN "isSelf" BOOLEAN;
ALTER TABLE "battle_history_participants" ADD COLUMN "uniqueIdSnapshot" TEXT;
ALTER TABLE "battle_history_participants" ADD COLUMN "nicknameSnapshot" TEXT;
ALTER TABLE "battle_history_participants" ADD COLUMN "officialScore" TEXT;
ALTER TABLE "battle_history_participants" ADD COLUMN "observedGiftTotal" INTEGER;
ALTER TABLE "battle_history_participants" ADD COLUMN "captureStatus" TEXT;
ALTER TABLE "battle_history_participants" ADD COLUMN "captureCoverage" DOUBLE PRECISION;
ALTER TABLE "battle_history_participants" ADD COLUMN "captureStartedLateMs" INTEGER;
ALTER TABLE "battle_history_participants" ADD COLUMN "captureEndedEarlyMs" INTEGER;
ALTER TABLE "battle_history_participants" ADD COLUMN "captureGapMs" INTEGER;
ALTER TABLE "battle_history_participants" ADD COLUMN "monitoringStartedAt" TIMESTAMP(3);
ALTER TABLE "battle_history_participants" ADD COLUMN "firstConnectedAt" TIMESTAMP(3);
ALTER TABLE "battle_history_participants" ADD COLUMN "lastDisconnectedAt" TIMESTAMP(3);

CREATE INDEX "battle_history_participants_battleTeamId_idx" ON "battle_history_participants"("battleTeamId");

ALTER TABLE "battle_history_participants" ADD CONSTRAINT "battle_history_participants_battleTeamId_fkey" FOREIGN KEY ("battleTeamId") REFERENCES "battle_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BattleHistoryGiftEvent新規テーブル
CREATE TABLE "battle_history_gift_events" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "senderUniqueIdSnapshot" TEXT NOT NULL,
    "senderNicknameSnapshot" TEXT NOT NULL,
    "senderTiktokUserId" TEXT,
    "giftId" INTEGER NOT NULL,
    "giftNameSnapshot" TEXT NOT NULL,
    "repeatCount" INTEGER NOT NULL,
    "diamondCount" INTEGER NOT NULL,
    "totalDiamonds" INTEGER NOT NULL,
    "multiplierType" INTEGER,
    "multiplierValue" INTEGER,
    "sourceGiftId" TEXT NOT NULL,

    CONSTRAINT "battle_history_gift_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "battle_history_gift_events_participantId_occurredAt_idx" ON "battle_history_gift_events"("participantId", "occurredAt");
CREATE INDEX "battle_history_gift_events_participantId_senderUniqueIdSn_idx" ON "battle_history_gift_events"("participantId", "senderUniqueIdSnapshot");

ALTER TABLE "battle_history_gift_events" ADD CONSTRAINT "battle_history_gift_events_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "battle_history_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BattleHistoryItemCardEvent新規テーブル
CREATE TABLE "battle_history_item_card_events" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "cardType" INTEGER NOT NULL,
    "senderUniqueIdSnapshot" TEXT,
    "senderNicknameSnapshot" TEXT,
    "senderTiktokUserId" TEXT,

    CONSTRAINT "battle_history_item_card_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "battle_history_item_card_events_participantId_occurredAt_idx" ON "battle_history_item_card_events"("participantId", "occurredAt");

ALTER TABLE "battle_history_item_card_events" ADD CONSTRAINT "battle_history_item_card_events_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "battle_history_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BattleHistoryBonusMission新規テーブル
CREATE TABLE "battle_history_bonus_missions" (
    "id" TEXT NOT NULL,
    "battleHistoryId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "targetType" INTEGER NOT NULL,
    "progressTarget" INTEGER NOT NULL,
    "rewardMultiple" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "taskResult" INTEGER,
    "rewardStartedAt" TIMESTAMP(3),
    "rewardEndedAt" TIMESTAMP(3),
    "rewardSum" INTEGER,

    CONSTRAINT "battle_history_bonus_missions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "battle_history_bonus_missions_battleHistoryId_idx" ON "battle_history_bonus_missions"("battleHistoryId");
CREATE INDEX "battle_history_bonus_missions_participantId_idx" ON "battle_history_bonus_missions"("participantId");

ALTER TABLE "battle_history_bonus_missions" ADD CONSTRAINT "battle_history_bonus_missions_battleHistoryId_fkey" FOREIGN KEY ("battleHistoryId") REFERENCES "battle_histories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "battle_history_bonus_missions" ADD CONSTRAINT "battle_history_bonus_missions_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "battle_history_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- 77b3ef8: 旧テーブルBattleHistoryContributor削除(Phase3 Contract完了)
-- =========================================================================

DROP TABLE IF EXISTS "battle_history_contributors";

-- =========================================================================
-- b5ea4f8 + f1bea55: TiktokIdMergeJob, TiktokIdMergeLog新規追加(Phase2)
-- (f1bea55のacknowledgedAtは本番未実行のCREATE TABLEへ直接含めて記録する)
-- =========================================================================

CREATE TABLE "TiktokIdMergeJob" (
    "id" TEXT NOT NULL,
    "streamerId" TEXT NOT NULL,
    "tiktokId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TiktokIdMergeJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TiktokIdMergeJob_streamerId_key" ON "TiktokIdMergeJob"("streamerId");
CREATE INDEX "TiktokIdMergeJob_status_nextAttemptAt_idx" ON "TiktokIdMergeJob"("status", "nextAttemptAt");

CREATE TABLE "TiktokIdMergeLog" (
    "id" TEXT NOT NULL,
    "streamerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "oldTiktokId" TEXT,
    "newTiktokId" TEXT NOT NULL,
    "oldRoomId" TEXT,
    "survivingRoomId" TEXT,
    "hostUserId" TEXT,
    "hostUserIdFilledAt" TIMESTAMP(3),
    "stats" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TiktokIdMergeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TiktokIdMergeLog_streamerId_createdAt_idx" ON "TiktokIdMergeLog"("streamerId", "createdAt");

-- =========================================================================
-- 78b13e5: TiktokRoomへhostUserId関連カラム追加
-- =========================================================================

ALTER TABLE "TiktokRoom" ADD COLUMN "hostUserIdFilledAt" TIMESTAMP(3);
ALTER TABLE "TiktokRoom" ADD COLUMN "hostUserIdBackfillGaveUpAt" TIMESTAMP(3);
ALTER TABLE "TiktokRoom" ADD COLUMN "hostUserIdAttemptedAt" TIMESTAMP(3);

CREATE INDEX "TiktokRoom_hostUserId_idx" ON "TiktokRoom"("hostUserId");
