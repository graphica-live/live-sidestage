-- DropIndex
DROP INDEX "public"."Streamer_apiKey_key";

-- AlterTable
ALTER TABLE "public"."Streamer" DROP COLUMN "apiKey";
