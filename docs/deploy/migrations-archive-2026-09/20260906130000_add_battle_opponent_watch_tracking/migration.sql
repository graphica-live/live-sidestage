-- AlterTable
ALTER TABLE "public"."TiktokRoom" ADD COLUMN     "watchSource" TEXT,
ADD COLUMN     "watchSourceAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."tiktok_battles" ADD COLUMN     "opponentWatch" JSONB NOT NULL DEFAULT '{}';
