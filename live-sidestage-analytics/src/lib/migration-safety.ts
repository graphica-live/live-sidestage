/**
 * migration.sql の破壊的DDL検知ロジック
 *
 * これはテスト可能なピュア関数として提供される。
 * scripts/check-migration-safety.mjs から使われる。
 */

/**
 * 破壊的DDLパターンを定義
 */
export const destructivePatterns = [
  { name: 'DROP TABLE', pattern: /DROP\s+TABLE\s+/i },
  { name: 'DROP COLUMN', pattern: /DROP\s+COLUMN\s+/i },
  { name: 'ALTER COLUMN TYPE', pattern: /ALTER\s+COLUMN\s+.+\s+TYPE\s+/i },
  { name: 'SET NOT NULL', pattern: /SET\s+NOT\s+NULL/i },
  { name: 'RENAME', pattern: /ALTER\s+TABLE\s+.+\s+RENAME\s+/i },
  { name: 'DROP INDEX', pattern: /DROP\s+INDEX\s+/i },
];

/**
 * migration.sql の内容をスキャンし、破壊的DDLを検知する
 *
 * @param {string} content - migration.sql ファイルの内容
 * @returns {string[]} 検知されたパターン名の配列
 */
export function scanMigrationContent(content: string): string[] {
  const warnings: string[] = [];

  for (const { name, pattern } of destructivePatterns) {
    if (pattern.test(content)) {
      warnings.push(name);
    }
  }

  // スキーマ間テーブル移動を検知（best-effort）
  // DROP TABLE と同名テーブルの別スキーマでの CREATE TABLE が両方ある場合
  const dropTableMatches = [
    ...content.matchAll(
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:(?:\w+|\"\w+\")\.)?"?(\w+)"?/gi
    ),
  ];
  if (dropTableMatches.length > 0) {
    const droppedTableNames = dropTableMatches.map((m) => m[1].toLowerCase());
    for (const tableName of droppedTableNames) {
      // 同じ名前のテーブルが別スキーマで CREATE されているか
      // ダブルクォート形式と非クォート形式の両方に対応
      if (
        new RegExp(
          `CREATE\\s+TABLE\\s+(?:\\w+|"\\w+")\\."?${tableName}"?`,
          'i'
        ).test(content)
      ) {
        if (!warnings.includes('schema間テーブル移動')) {
          warnings.push('schema間テーブル移動（推定）');
        }
      }
    }
  }

  return warnings;
}
