-- AlterTable
ALTER TABLE "public"."RefreshToken" ADD COLUMN "client" TEXT NOT NULL DEFAULT 'mobile';

-- AlterTable
ALTER TABLE "public"."RefreshTokenReplay" ADD COLUMN "client" TEXT NOT NULL DEFAULT 'mobile';
