-- CreateTable
CREATE TABLE "public"."tiktok_room_collab_sources" (
    "id" TEXT NOT NULL,
    "watchedRoomId" TEXT NOT NULL,
    "sourceRoomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tiktok_room_collab_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tiktok_room_collab_sources_sourceRoomId_idx" ON "public"."tiktok_room_collab_sources"("sourceRoomId");

-- CreateIndex
CREATE INDEX "tiktok_room_collab_sources_lastSeenAt_idx" ON "public"."tiktok_room_collab_sources"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "tiktok_room_collab_sources_watchedRoomId_sourceRoomId_key" ON "public"."tiktok_room_collab_sources"("watchedRoomId", "sourceRoomId");

-- AddForeignKey
ALTER TABLE "public"."tiktok_room_collab_sources" ADD CONSTRAINT "tiktok_room_collab_sources_watchedRoomId_fkey" FOREIGN KEY ("watchedRoomId") REFERENCES "public"."TiktokRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
