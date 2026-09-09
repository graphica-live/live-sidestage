// Streamer に残っている overlay 貢献リスト表示設定9列(overlayDisplayReference等)を、
// 新テーブル OverlayContributionSettings へコピーする一回限りのbackfillスクリプト。
//
// 背景: `prisma/plans/20260909-streamer-overlay-settings-extraction.md` Batch 02。
// OverlayContributionSettings はBatch01でschema追加・本番デプロイ済みだが、
// アプリケーションコードはまだ書き込んでいない(orphanな空テーブル)。cutover(Batch03)前に
// 既存の配信者カスタム値(threshold/goalCount/align等)を失わないよう全件コピーしておく必要がある。
//
// **本番DBへの実行はユーザーの明示的な指示があってから行うこと**(書き込みを伴う)。
//
// 設計:
//
// - 移行対象は「まだ overlay_contribution_settings 行を持たない Streamer」のみ
//   (`ON CONFLICT ("streamerId") DO NOTHING` で冪等。複数回実行しても安全)。
// - 物理列名の大文字小文字・クォートは
//   `prisma/migrations/20260910020000_add_overlay_contribution_settings/migration.sql` に
//   合わせている(streamerId, displayReference, displayDate, threshold, goalCount, visibleRows,
//   nameMaxWidth, align, headingBackground, displaySpeed, updatedAt)。
// - advisory lock で同時実行を防ぐ(migrate-subscription-provider.tsと同じパターン)。
// - 実行後、"Streamer" の件数と overlay_contribution_settings の件数が一致することを
//   スクリプト自身が確認し、不一致ならexit code 1で終了する(サイレント成功にしない)。
//
// 使い方:
//   npx tsx scripts/backfill-overlay-contribution-settings.ts --dry-run   # 対象件数の確認のみ(書き込みなし)
//   npx tsx scripts/backfill-overlay-contribution-settings.ts             # 実行
//
import { prisma } from "../src/lib/prisma";

const TAG = "[backfill-overlay-contribution-settings]";
const MIGRATION_LOCK_KEY = 891_402_713n;

async function countStreamers(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*)::bigint AS count FROM "Streamer"`,
  );
  return Number(rows[0].count);
}

async function countSettings(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*)::bigint AS count FROM overlay_contribution_settings`,
  );
  return Number(rows[0].count);
}

async function countMissing(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
    SELECT count(*)::bigint AS count
    FROM "Streamer" s
    WHERE NOT EXISTS (
      SELECT 1 FROM overlay_contribution_settings o WHERE o."streamerId" = s.id
    )
  `);
  return Number(rows[0].count);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(`${TAG} 開始${dryRun ? "(ドライラン: 書き込みなし)" : ""}`);

  const streamerCount = await countStreamers();
  const settingsCountBefore = await countSettings();
  const missing = await countMissing();

  console.log(
    `${TAG} Streamer件数=${streamerCount} / overlay_contribution_settings件数(実行前)=${settingsCountBefore} / ` +
      `未backfill件数=${missing}`,
  );

  if (dryRun) {
    console.log(`${TAG} ドライラン完了。書き込みは行っていません。`);
    return;
  }

  if (missing === 0) {
    console.log(`${TAG} 未backfillの行はありません。実行をスキップします。`);
  } else {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY}::bigint)`;

        const inserted = await tx.$executeRawUnsafe(`
          INSERT INTO overlay_contribution_settings
            ("streamerId", "displayReference", "displayDate", "threshold", "goalCount",
             "visibleRows", "nameMaxWidth", "align", "headingBackground", "displaySpeed", "updatedAt")
          SELECT
            s.id, s."overlayDisplayReference", s."overlayDisplayDate", s."overlayThreshold", s."overlayGoalCount",
            s."overlayVisibleRows", s."overlayNameMaxWidth", s."overlayAlign", s."overlayHeadingBackground",
            s."overlayDisplaySpeed", now()
          FROM "Streamer" s
          ON CONFLICT ("streamerId") DO NOTHING
        `);

        console.log(`${TAG} ${inserted}件をbackfillしました。`);
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }

  // 書き込み後、"Streamer" と overlay_contribution_settings の件数が一致することを確認する。
  // 不一致はサイレントに握り潰さず、exit code 1で異常終了させる。
  const streamerCountAfter = await countStreamers();
  const settingsCountAfter = await countSettings();

  console.log(
    `${TAG} 実行後件数確認: Streamer=${streamerCountAfter} / overlay_contribution_settings=${settingsCountAfter}`,
  );

  if (streamerCountAfter !== settingsCountAfter) {
    console.error(
      `${TAG} 件数不一致を検出しました(Streamer=${streamerCountAfter} / ` +
        `overlay_contribution_settings=${settingsCountAfter})。原因を確認してください` +
        `(backfill実行中に新規Streamerが作成された可能性、または一部行の挿入失敗)。`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`${TAG} 完了。件数が一致しました。`);
}

main()
  .catch((err) => {
    console.error(`${TAG} 失敗しました:`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
