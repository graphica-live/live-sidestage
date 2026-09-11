// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// Wave1-B: 5件のCHECK制約(migration.sql)の検証。`prisma db push` は CHECK 制約を
// 表現できない(schema.prisma に @@check 属性が無い)ため、このファイルは migration.sql の
// 内容をテスト内のトランザクションへ直接適用し、違反行が実際に拒否されることを確認する。
//
// 各テストは1トランザクション内で「制約追加 → 違反INSERT/UPDATE(拒否されることを期待) →
// ROLLBACK」を完結させる。commit しないため、他の並行テストファイルの書き込みには一切
// 影響しない(analytics-vitest-cross-file-interference.md の教訓どおり、グローバルDDLは
// 同一トランザクション内に閉じ込める)。
//
// 注: CI は `prisma migrate deploy` で制約が既に存在するため、tx 内で各 ADD CONSTRAINT 前に
// DROP CONSTRAINT IF EXISTS を実行し直す。これにより二重適用による制約名衝突エラーを回避できる。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

const MIGRATION_SQL = readFileSync(
  path.join(__dirname, "..", "..", "prisma", "migrations", "20260911160000_add_wave1b_check_constraints", "migration.sql"),
  "utf-8"
);

class RollbackSentinel extends Error {}

const MIGRATION_STATEMENTS = MIGRATION_SQL.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

// migration.sql から制約削除文を抽出(CI で migrate deploy済みの場合に備えて既存制約を削除)
const CONSTRAINT_DROP_STATEMENTS = (() => {
  const lines = MIGRATION_SQL.split("\n");
  const drops: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ALTER TABLE で始まる行を検出
    const tableMatch = line.match(/ALTER TABLE\s+"([^"]+)"\.?"([^"]+)"/);
    if (tableMatch) {
      const schemaName = tableMatch[1];
      const tableName = tableMatch[2];

      // 次の行を確認して ADD CONSTRAINT を探す
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const constraintMatch = lines[j].match(/ADD CONSTRAINT\s+"([^"]+)"/);
        if (constraintMatch) {
          const constraintName = constraintMatch[1];
          drops.push(`ALTER TABLE "${schemaName}"."${tableName}" DROP CONSTRAINT IF EXISTS "${constraintName}"`);
          break;
        }
      }
    }
  }

  return drops;
})();

async function runInRolledBackTx(fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>) {
  await expect(
    prisma.$transaction(async (tx) => {
      // DROP CONSTRAINT IF EXISTS を先に実行して既存制約を削除(migrate deploy済みの場合)
      for (const dropStmt of CONSTRAINT_DROP_STATEMENTS) {
        await tx.$executeRawUnsafe(dropStmt);
      }
      // その後で ADD CONSTRAINT を実行
      for (const stmt of MIGRATION_STATEMENTS) {
        await tx.$executeRawUnsafe(stmt);
      }
      await fn(tx);
      throw new RollbackSentinel();
    })
  ).rejects.toThrow(RollbackSentinel);
}

const uid = () => `itest_w1b_${Date.now()}_${Math.random().toString(36).slice(2)}`;

describe("Wave1-B CHECK制約", () => {
  it("battle_history_participants.captureCoverage は 0〜1の範囲外を拒否する", async () => {
    await runInRolledBackTx(async (tx) => {
      const roomId = uid();
      await tx.$executeRaw`
        INSERT INTO public."TiktokRoom" (id, "tiktokHandle", "hostTiktokUid", "createdAt", "monitoringSuspended")
        VALUES (${roomId}, ${uid()}, ${uid()}, NOW(), true)
      `;

      const battleHistoryId = uid();
      await tx.$executeRaw`
        INSERT INTO public.battle_histories
          (id, "roomId", "battleId", "windowStart", "windowEnd", status, "sourceUpdatedAt", "finalizedAt")
        VALUES (${battleHistoryId}, ${roomId}, ${uid()}, NOW(), NOW(), 'FINISHED', NOW(), NOW())
      `;

      // 範囲内は成功する
      await tx.$executeRaw`
        INSERT INTO public.battle_history_participants
          (id, "battleHistoryId", side, position, "tiktokUid", "captureCoverage")
        VALUES (${uid()}, ${battleHistoryId}, 'self', 0, ${uid()}, 0.5)
      `;

      // 範囲外(1.5)は拒否される
      await expect(
        tx.$executeRaw`
          INSERT INTO public.battle_history_participants
            (id, "battleHistoryId", side, position, "tiktokUid", "captureCoverage")
          VALUES (${uid()}, ${battleHistoryId}, 'self', 1, ${uid()}, 1.5)
        `
      ).rejects.toThrow();
    });
  });

  it("EventMatchSide.sideIndex は 0/1 以外を拒否する", async () => {
    await runInRolledBackTx(async (tx) => {
      const eventId = uid();
      const sessionId = uid();
      const matchId = uid();
      await tx.$executeRaw`
        INSERT INTO event."Event"
          (id, slug, title, "ownerPrincipalId", format, "entryMode", "startAt", "endAt", "updatedAt")
        VALUES (${eventId}, ${uid()}, 'test', ${uid()}, 'DEATHMATCH', 'SELF', NOW(), NOW(), NOW())
      `;
      await tx.$executeRaw`
        INSERT INTO event."EventSession" (id, "eventId", "startAt", "endAt")
        VALUES (${sessionId}, ${eventId}, NOW(), NOW())
      `;
      await tx.$executeRaw`
        INSERT INTO event."EventMatch" (id, "eventId", "sessionId")
        VALUES (${matchId}, ${eventId}, ${sessionId})
      `;

      await tx.$executeRaw`
        INSERT INTO event."EventMatchSide" (id, "matchId", "sideIndex") VALUES (${uid()}, ${matchId}, 0)
      `;

      await expect(
        tx.$executeRaw`
          INSERT INTO event."EventMatchSide" (id, "matchId", "sideIndex") VALUES (${uid()}, ${matchId}, 2)
        `
      ).rejects.toThrow();
    });
  });

  it("EventLifePoint.current は max を超えられない", async () => {
    await runInRolledBackTx(async (tx) => {
      const eventId = uid();
      await tx.$executeRaw`
        INSERT INTO event."Event"
          (id, slug, title, "ownerPrincipalId", format, "entryMode", "startAt", "endAt", "updatedAt")
        VALUES (${eventId}, ${uid()}, 'test', ${uid()}, 'DEATHMATCH', 'SELF', NOW(), NOW(), NOW())
      `;

      await tx.$executeRaw`
        INSERT INTO event."EventLifePoint" (id, "eventId", "subjectType", "subjectId", current, max)
        VALUES (${uid()}, ${eventId}, 'PARTICIPANT', ${uid()}, 3, 3)
      `;

      await expect(
        tx.$executeRaw`
          INSERT INTO event."EventLifePoint" (id, "eventId", "subjectType", "subjectId", current, max)
          VALUES (${uid()}, ${eventId}, 'PARTICIPANT', ${uid()}, 5, 3)
        `
      ).rejects.toThrow();
    });
  });

  it("overlay_timer_state は running=true のとき endsAt 必須", async () => {
    await runInRolledBackTx(async (tx) => {
      const principalId1 = uid();
      const principalId2 = uid();
      await tx.$executeRaw`INSERT INTO "User" (id) VALUES (${principalId1})`;
      await tx.$executeRaw`INSERT INTO "User" (id) VALUES (${principalId2})`;

      const streamerId = uid();
      await tx.$executeRaw`
        INSERT INTO "Streamer" (id, "principalId", "tiktokUid", "tiktokHandle", "verificationCode")
        VALUES (${streamerId}, ${principalId1}, ${uid()}, ${uid()}, ${uid()})
      `;

      await tx.$executeRaw`
        INSERT INTO public.overlay_timer_state ("streamerId", running, "endsAt", "updatedAt")
        VALUES (${streamerId}, true, NOW(), NOW())
      `;

      const streamerId2 = uid();
      await tx.$executeRaw`
        INSERT INTO "Streamer" (id, "principalId", "tiktokUid", "tiktokHandle", "verificationCode")
        VALUES (${streamerId2}, ${principalId2}, ${uid()}, ${uid()}, ${uid()})
      `;
      await expect(
        tx.$executeRaw`
          INSERT INTO public.overlay_timer_state ("streamerId", running, "endsAt", "updatedAt")
          VALUES (${streamerId2}, true, NULL, NOW())
        `
      ).rejects.toThrow();
    });
  });

  it("EventMatchBattleCandidate.combinedGroupId が非null なら organizerSelected も true", async () => {
    await runInRolledBackTx(async (tx) => {
      const eventId = uid();
      const sessionId = uid();
      const matchId = uid();
      await tx.$executeRaw`
        INSERT INTO event."Event"
          (id, slug, title, "ownerPrincipalId", format, "entryMode", "startAt", "endAt", "updatedAt")
        VALUES (${eventId}, ${uid()}, 'test', ${uid()}, 'DEATHMATCH', 'SELF', NOW(), NOW(), NOW())
      `;
      await tx.$executeRaw`
        INSERT INTO event."EventSession" (id, "eventId", "startAt", "endAt")
        VALUES (${sessionId}, ${eventId}, NOW(), NOW())
      `;
      await tx.$executeRaw`
        INSERT INTO event."EventMatch" (id, "eventId", "sessionId")
        VALUES (${matchId}, ${eventId}, ${sessionId})
      `;

      await tx.$executeRaw`
        INSERT INTO event."EventMatchBattleCandidate"
          (id, "matchId", "battleId", "startedAt", confidence, "organizerSelected", "combinedGroupId", "updatedAt")
        VALUES (${uid()}, ${matchId}, ${uid()}, NOW(), 'exact', true, ${uid()}, NOW())
      `;

      await expect(
        tx.$executeRaw`
          INSERT INTO event."EventMatchBattleCandidate"
            (id, "matchId", "battleId", "startedAt", confidence, "organizerSelected", "combinedGroupId", "updatedAt")
          VALUES (${uid()}, ${matchId}, ${uid()}, NOW(), 'exact', false, ${uid()}, NOW())
        `
      ).rejects.toThrow();
    });
  });
});
