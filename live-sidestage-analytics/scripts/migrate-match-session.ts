// 対戦の個別時間枠(EventMatch.scheduledStartAt/scheduledEndAt)を廃止し、
// 開催日程(EventSession)への割り当て(EventMatch.sessionId)へ移す一度きりの移行スクリプト。
//
// `prisma db push` は「既存データがある非NULL列の追加」を実行できず、そのまま本番へ
// デプロイするとコンテナ起動のたびに db push が失敗してクラッシュループする。
// migrate-shared-tiktok-room.ts と同じく、db push の直前(Dockerfile CMD)で
//   1) 日程を持たないイベントに外枠から1日程を作る
//   2) nullable 列の追加(sessionId / decidedAt)
//   3) 既存データからのバックフィル(予定枠を含む日程へ割り当て、決着時刻を作る)
//   4) NOT NULL 化・複合UNIQUE/FK/INDEX の追加・旧列の nullable 化
// を1トランザクションで完結させ、その後の db push が差分なしで通る状態を作る。
//
// **旧列(scheduledStartAt/scheduledEndAt)は DROP しない。** 新コードも当面は
// 「割り当てた日程の窓」を書き込み続ける(dual-write)。ローリング更新やロールバックで
// 旧コードが同時に動いても、必須列が null で落ちないようにするため。
//
// 冪等: sessionId 列があり NULL 行が無ければ何もせず終了するので、コンテナ起動のたびに
// 実行しても安全。web が複数同時に起動しても、先頭で advisory lock を取るので二重に走らない。
import { prisma } from "../src/lib/prisma";

const TAG = "[migrate-match-session]";

/** このスクリプト専用の advisory lock キー(他の移行・集計と衝突しない任意の定数)。 */
const MIGRATION_LOCK_KEY = 728_311_004n;

async function tableExists(table: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'event' AND table_name = ${table}
    ) AS exists`;
  return rows[0]?.exists === true;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'event' AND table_name = ${table} AND column_name = ${column}
    ) AS exists`;
  return rows[0]?.exists === true;
}

/**
 * 移行が要るか。**新規DB(テーブルがまだ無い)では何もしない** —
 * db push がこれから schema どおりに作るので、こちらが先回りする必要がない。
 */
async function needsMigration(): Promise<boolean> {
  if (!(await tableExists("EventMatch")) || !(await tableExists("EventSession"))) return false;
  // 旧列が無ければ、この移行より後に作られたDB。
  if (!(await columnExists("EventMatch", "scheduledStartAt"))) return false;
  if (!(await columnExists("EventMatch", "sessionId"))) return true;

  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM event."EventMatch" WHERE "sessionId" IS NULL`;
  if (Number(rows[0]?.count ?? 0) > 0) return true;

  // 列はあるが制約が未適用(前回 db push で NOT NULL が外れた等)なら、もう一度整える。
  const notNull = await prisma.$queryRaw<{ is_nullable: string }[]>`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'event' AND table_name = 'EventMatch' AND column_name = 'sessionId'`;
  return notNull[0]?.is_nullable === "YES";
}

async function main() {
  if (!(await needsMigration())) {
    console.log(`${TAG} 移行は不要です。スキップします。`);
    return;
  }

  console.log(`${TAG} 移行を開始します。`);

  await prisma.$transaction(
    async (tx) => {
      // **先頭でロックを取る。** web が複数同時に起動すると、外枠から作る日程が
      // イベントごとに二重に入りうる。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY}::bigint)`;

      // ロック待ちの間に別プロセスが終わらせているかもしれないので、もう一度見る。
      const already = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count
         FROM information_schema.columns
         WHERE table_schema = 'event' AND table_name = 'EventMatch'
           AND column_name = 'sessionId' AND is_nullable = 'NO'`
      );
      if (Number(already[0]?.count ?? 0) > 0) {
        console.log(`${TAG} 別プロセスが先に完了させていました。`);
        return;
      }

      // --- Phase 1: 日程を持たないイベントに、外枠から1日程を作る ---
      // この機能より前に作られたイベントは EventSession を持たず、外枠 [startAt, endAt) を
      // 1日程とみなして動いていた。対戦を日程へ紐づけるには実体が要る。
      await tx.$executeRawUnsafe(`
        INSERT INTO event."EventSession" ("id", "eventId", "name", "startAt", "endAt", "createdAt")
        SELECT gen_random_uuid()::text, e."id", NULL, e."startAt", e."endAt", NOW()
        FROM event."Event" e
        WHERE NOT EXISTS (SELECT 1 FROM event."EventSession" s WHERE s."eventId" = e."id")
      `);

      // --- Phase 2: nullable 列を足す ---
      await tx.$executeRawUnsafe(
        `ALTER TABLE event."EventMatch" ADD COLUMN IF NOT EXISTS "sessionId" TEXT`
      );
      await tx.$executeRawUnsafe(
        `ALTER TABLE event."EventMatch" ADD COLUMN IF NOT EXISTS "decidedAt" TIMESTAMP(3)`
      );

      // --- Phase 3: 日程の割り当て ---
      // (a) 予定枠を**完全に含む**日程。旧実装はこの条件を満たす枠しか作らせなかったので、
      //     通常はここで全件埋まる。
      await tx.$executeRawUnsafe(`
        UPDATE event."EventMatch" m
        SET "sessionId" = s."id"
        FROM event."EventSession" s
        WHERE m."sessionId" IS NULL
          AND s."eventId" = m."eventId"
          AND m."scheduledStartAt" >= s."startAt"
          AND m."scheduledEndAt" <= s."endAt"
      `);

      // (b) 含む日程が無い行(主催者が後から日程を縮めた VOID / NO_SHOW など)は、
      //     **重なりが最大の日程**へ寄せる。重なりも無ければ最も近い日程。
      //     ここで落とすと、消せない古い行1つで本番のデプロイが永久に止まる。
      // **相関副問い合わせで書く。** `UPDATE ... FROM LATERAL (...)` は更新対象の別名を
      // 参照できない(Postgres: invalid reference to FROM-clause entry)。
      await tx.$executeRawUnsafe(`
        UPDATE event."EventMatch" m
        SET "sessionId" = (
          SELECT s."id"
          FROM event."EventSession" s
          WHERE s."eventId" = m."eventId"
          ORDER BY
            GREATEST(
              0,
              EXTRACT(EPOCH FROM (
                LEAST(s."endAt", m."scheduledEndAt") - GREATEST(s."startAt", m."scheduledStartAt")
              ))
            ) DESC,
            ABS(EXTRACT(EPOCH FROM (s."startAt" - m."scheduledStartAt"))) ASC,
            s."startAt" ASC
          LIMIT 1
        )
        WHERE m."sessionId" IS NULL
      `);

      // --- Phase 4: 決着時刻 ---
      // ライフの適用順に使う。**決着していない行には入れない**(null = 未決着)。
      // 自動検知の実測終了があればそれ、無ければ手動確定の代替として旧予定終了を使う
      // (旧 life-points.ts の `detectedEndAt ?? scheduledEndAt` と同じ順序を保つ)。
      await tx.$executeRawUnsafe(`
        UPDATE event."EventMatch"
        SET "decidedAt" = COALESCE("detectedEndAt", "scheduledEndAt")
        WHERE "decidedAt" IS NULL
          AND "status" IN ('DETECTED', 'FINISHED')
      `);

      // --- Phase 5: 捏造された終了時刻の後始末 ---
      // 旧実装は終了を観測できないバトルに**予定終了時刻**を入れていた
      // (`detectedEndSource = 'scheduled'`)。新しい規則ではその値は作らないし、
      // その区間で計算した勝敗・バトル倍率は根拠がない。検知を外して主催者へ回す。
      // 主催者が自分で確定した行(MANUAL / DRAW / BYE)には触らない。
      await tx.$executeRawUnsafe(`
        UPDATE event."EventMatch"
        SET "detectedBattleId" = NULL,
            "detectedStartAt" = NULL,
            "detectedEndAt" = NULL,
            "detectionConfidence" = NULL,
            "detectedEndSource" = NULL,
            "decidedAt" = NULL,
            "winnerSideId" = NULL,
            "winnerDecidedBy" = NULL,
            "status" = 'NEEDS_REVIEW',
            "rules" = jsonb_set(
              COALESCE("rules", '{}'::jsonb), '{reviewReason}', '"END_UNKNOWN"'::jsonb, true
            )
        WHERE "detectedEndSource" = 'scheduled'
          AND ("winnerDecidedBy" IS NULL OR "winnerDecidedBy" = 'AGGREGATE')
      `);

      // --- Phase 6: 制約を付ける ---
      const orphans = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count FROM event."EventMatch" WHERE "sessionId" IS NULL`
      );
      if (Number(orphans[0]?.count ?? 0) > 0) {
        // 日程を1件も作れなかったイベント(Phase 1 が通っていれば起きない)。
        throw new Error(
          `開催日程へ割り当てられない対戦が ${orphans[0]?.count} 件あります。移行を中止しました。`
        );
      }

      await tx.$executeRawUnsafe(
        `ALTER TABLE event."EventMatch" ALTER COLUMN "sessionId" SET NOT NULL`
      );
      // 複合FKの参照先。sessionId 単独の FK だと他イベントの日程を指せてしまう。
      await tx.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "EventSession_eventId_id_key" ON event."EventSession"("eventId", "id")`
      );
      await tx.$executeRawUnsafe(`
        ALTER TABLE event."EventMatch"
        DROP CONSTRAINT IF EXISTS "EventMatch_eventId_sessionId_fkey"
      `);
      await tx.$executeRawUnsafe(`
        ALTER TABLE event."EventMatch"
        ADD CONSTRAINT "EventMatch_eventId_sessionId_fkey"
        FOREIGN KEY ("eventId", "sessionId") REFERENCES event."EventSession"("eventId", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE
      `);
      await tx.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "EventMatch_eventId_sessionId_idx" ON event."EventMatch"("eventId", "sessionId")`
      );
      await tx.$executeRawUnsafe(
        `DROP INDEX IF EXISTS event."EventMatch_eventId_scheduledStartAt_idx"`
      );

      // --- Phase 7: 旧列は残したまま NOT NULL だけ外す ---
      // 新コードは日程の窓を書き込み続ける(dual-write)が、値を持たない経路が出ても
      // 落ちないようにしておく。
      await tx.$executeRawUnsafe(
        `ALTER TABLE event."EventMatch" ALTER COLUMN "scheduledStartAt" DROP NOT NULL`
      );
      await tx.$executeRawUnsafe(
        `ALTER TABLE event."EventMatch" ALTER COLUMN "scheduledEndAt" DROP NOT NULL`
      );
    },
    { timeout: 120_000, maxWait: 30_000 }
  );

  console.log(`${TAG} 移行が完了しました。`);
}

main()
  .catch((err) => {
    console.error(`${TAG} 移行に失敗しました:`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
