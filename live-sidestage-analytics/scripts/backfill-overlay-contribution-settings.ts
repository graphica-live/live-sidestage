// **2026-09-10 Batch04完了により死亡(実行不能)。** Streamer側の旧9列(overlayThreshold等)を
// `prisma/migrations/20260910040000_drop_streamer_overlay_columns` で削除済みのため、以下のSQLが
// 参照する列は本番にもう存在しない。本番backfillは完了・全件検証済み(Streamer/overlay_contribution_settings
// の件数一致・欠損0件を確認)につき再実行の必要はない。削除せず履歴として残す
// (`scripts/migrate-tiktok-userid-reset.ts` と同じ扱い)。
//
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
// - 完了判定は「挿入前のsettings件数 + 今回のinsert件数 === 挿入後のsettings件数」という
//   決定的な比較で行う("Streamer"件数との比較はしない)。2クエリの間に新規Streamerが
//   作成されるとフォールスポジティブになるうえ、Streamer側の値変更(ドリフト)を検知できない
//   ため。ドリフト自体は本スクリプトの責務外(運用手順側で対処。runbook参照)。
//
// 使い方:
//   npx tsx scripts/backfill-overlay-contribution-settings.ts --dry-run   # 対象件数の確認のみ(書き込みなし)
//   npx tsx scripts/backfill-overlay-contribution-settings.ts             # 実行
//
import { prisma } from "../src/lib/prisma";

const TAG = "[backfill-overlay-contribution-settings]";
const MIGRATION_LOCK_KEY = 891_402_713n;

// count系はすべてBigIntのまま返す。件数比較(完了判定)はBigIntの厳密比較(!==)で行い、
// Number()への変換はログ表示のときだけ行う(Number.MAX_SAFE_INTEGERを超える精度損失を避ける)。
async function countStreamers(): Promise<bigint> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*)::bigint AS count FROM "Streamer"`,
  );
  return rows[0].count;
}

async function countSettings(): Promise<bigint> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*)::bigint AS count FROM overlay_contribution_settings`,
  );
  return rows[0].count;
}

async function countMissing(): Promise<bigint> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
    SELECT count(*)::bigint AS count
    FROM "Streamer" s
    WHERE NOT EXISTS (
      SELECT 1 FROM overlay_contribution_settings o WHERE o."streamerId" = s.id
    )
  `);
  return rows[0].count;
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

  let insertedCount = 0n;

  if (missing === 0n) {
    console.log(`${TAG} 未backfillの行はありません。実行をスキップします。`);
  } else {
    insertedCount = await prisma.$transaction(
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
        return BigInt(inserted);
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }

  // 完了判定は「挿入前のsettings件数 + 今回のinsert件数 === 挿入後のsettings件数」という
  // 決定的な比較で行う。"Streamer"件数との比較はrace conditionを生むうえ(2クエリの間の新規
  // Streamer作成を誤って「一致」判定してしまう)、backfill実行〜cutoverの間のデータドリフト
  // (新規Streamer登録やStreamer側の値変更が新テーブルへ未反映であること)を検知できないため
  // 採用しない。不一致はサイレントに握り潰さず、exit code 1で異常終了させる。
  const settingsCountAfter = await countSettings();
  const expectedSettingsCountAfter = settingsCountBefore + insertedCount;

  console.log(
    `${TAG} 実行後件数確認: overlay_contribution_settings(実行前)=${settingsCountBefore} + ` +
      `insert件数=${insertedCount} = 期待値${expectedSettingsCountAfter} / 実測値=${settingsCountAfter}`,
  );

  if (expectedSettingsCountAfter !== settingsCountAfter) {
    console.error(
      `${TAG} 件数不一致を検出しました(期待値=${expectedSettingsCountAfter} / ` +
        `実測値=${settingsCountAfter})。原因を確認してください` +
        `(insert中の同時書き込み、または一部行の挿入失敗)。`,
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
