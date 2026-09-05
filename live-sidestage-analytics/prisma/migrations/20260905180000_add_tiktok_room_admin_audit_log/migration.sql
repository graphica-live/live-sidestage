-- CreateTable
CREATE TABLE "public"."tiktok_room_admin_audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tiktokId" TEXT NOT NULL,
    "operatorEmail" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tiktok_room_admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tiktok_room_admin_audit_logs_roomId_idx" ON "public"."tiktok_room_admin_audit_logs"("roomId");

-- CreateIndex
CREATE INDEX "tiktok_room_admin_audit_logs_createdAt_idx" ON "public"."tiktok_room_admin_audit_logs"("createdAt");
