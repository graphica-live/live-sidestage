-- CreateTable
CREATE TABLE "gift_edits" (
    "id" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "giftName" TEXT NOT NULL,
    "totalDiamonds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_edits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gift_edits_giftId_key" ON "gift_edits"("giftId");

-- AddForeignKey
ALTER TABLE "gift_edits" ADD CONSTRAINT "gift_edits_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "gifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
