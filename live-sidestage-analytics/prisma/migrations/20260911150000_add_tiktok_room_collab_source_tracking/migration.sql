-- AlterTable
ALTER TABLE "public"."TiktokRoom" ADD COLUMN     "lastCollabSourceAt" TIMESTAMP(3),
ADD COLUMN     "lastCollabSourceRoomId" TEXT;
-- CreateIndex
CREATE INDEX "TiktokRoom_lastCollabSourceRoomId_idx" ON "public"."TiktokRoom"("lastCollabSourceRoomId");
