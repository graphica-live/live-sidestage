import { prisma } from "@/lib/prisma";

// 監視対象は public/event の実テーブルのみ。Prismaの内部管理テーブルと、
// この記録自体を格納するテーブルは対象から除外する(自己参照ノイズを避けるため)。
const EXCLUDED_TABLES = new Set(["_prisma_migrations", "DbStatsSnapshot"]);

type TableRef = { schemaName: string; tableName: string };

type CountRow = { count: bigint };
type SizeRow = { size: bigint };

async function listTables(): Promise<TableRef[]> {
  const rows = await prisma.$queryRaw<{ table_schema: string; table_name: string }[]>`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema IN ('public', 'event')
      AND table_type = 'BASE TABLE'
  `;

  return rows
    .map((r) => ({ schemaName: r.table_schema, tableName: r.table_name }))
    .filter((t) => !EXCLUDED_TABLES.has(t.tableName));
}

// テーブル数54件・1日1回の実行なので逐次COUNT(*)で正確な件数を取る(並列化やreltuples概算は
// 1日1回バッチというワークロードには過剰設計と判断し見送った)。
async function countRows(ref: TableRef): Promise<bigint> {
  const rows = await prisma.$queryRawUnsafe<CountRow[]>(
    `SELECT COUNT(*)::bigint AS count FROM "${ref.schemaName}"."${ref.tableName}"`
  );
  return rows[0]?.count ?? 0n;
}

async function tableSizeBytes(ref: TableRef): Promise<bigint> {
  const rows = await prisma.$queryRawUnsafe<SizeRow[]>(
    `SELECT pg_total_relation_size(format('%I.%I', $1, $2))::bigint AS size`,
    ref.schemaName,
    ref.tableName
  );
  return rows[0]?.size ?? 0n;
}

/** その日(JST暦日)の全テーブルの件数・サイズを記録する。既に記録済みのテーブルは上書きする。 */
export async function collectDbStats(runDate: Date): Promise<{ tables: number }> {
  const tables = await listTables();

  for (const ref of tables) {
    const [rowCount, totalBytes] = await Promise.all([countRows(ref), tableSizeBytes(ref)]);

    await prisma.dbStatsSnapshot.upsert({
      where: {
        runDate_schemaName_tableName: {
          runDate,
          schemaName: ref.schemaName,
          tableName: ref.tableName,
        },
      },
      create: {
        runDate,
        schemaName: ref.schemaName,
        tableName: ref.tableName,
        rowCount,
        totalBytes,
      },
      update: { rowCount, totalBytes },
    });
  }

  return { tables: tables.length };
}
