import { describe, it, expect } from 'vitest';
import { scanMigrationContent } from '../src/lib/migration-safety';

describe('check-migration-safety: migration.sql の静的スキャン', () => {
  describe('破壊的DDLの検知', () => {
    it('DROP TABLE を検知する', () => {
      const content = `
        ALTER TABLE "public"."OldTable" DROP CONSTRAINT fk_something;
        DROP TABLE "public"."OldTable";
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('DROP TABLE');
    });

    it('DROP COLUMN を検知する', () => {
      const content = `
        ALTER TABLE "public"."users" DROP COLUMN deprecated_field;
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('DROP COLUMN');
    });

    it('ALTER COLUMN TYPE を検知する', () => {
      const content = `
        ALTER TABLE "public"."users" ALTER COLUMN email TYPE VARCHAR(500);
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('ALTER COLUMN TYPE');
    });

    it('SET NOT NULL を検知する', () => {
      const content = `
        ALTER TABLE "public"."users" ALTER COLUMN email SET NOT NULL;
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('SET NOT NULL');
    });

    it('RENAME (テーブル) を検知する', () => {
      const content = `
        ALTER TABLE "public"."users" RENAME TO "profiles";
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('RENAME');
    });

    it('DROP INDEX を検知する', () => {
      const content = `
        DROP INDEX "public"."users_email_idx";
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('DROP INDEX');
    });

    it('複数の破壊的DDLを検知する', () => {
      const content = `
        DROP TABLE "public"."old_table";
        ALTER TABLE "public"."users" DROP COLUMN deprecated;
        ALTER TABLE "public"."profiles" ALTER COLUMN name TYPE TEXT;
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('DROP TABLE');
      expect(warnings).toContain('DROP COLUMN');
      expect(warnings).toContain('ALTER COLUMN TYPE');
    });

    it('スキーマ間テーブル移動を検知する', () => {
      const content = `
        DROP TABLE IF EXISTS "public"."events";
        CREATE TABLE "event"."events" (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL
        );
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('DROP TABLE');
      // schema間テーブル移動は best-effort なので含まれるはず
      expect(warnings.some((w) => w.includes('schema間テーブル移動'))).toBe(true);
    });
  });

  describe('安全なmigrationの検知なし', () => {
    it('新規テーブル追加は警告しない', () => {
      const content = `
        CREATE TABLE "public"."new_table" (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX "new_table_name_idx" ON "public"."new_table" (name);
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toHaveLength(0);
    });

    it('新規カラム追加は警告しない', () => {
      const content = `
        ALTER TABLE "public"."users" ADD COLUMN new_field VARCHAR(255);
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toHaveLength(0);
    });

    it('新規インデックス追加は警告しない', () => {
      const content = `
        CREATE INDEX "users_email_idx" ON "public"."users" (email);
        CREATE UNIQUE INDEX "users_handle_idx" ON "public"."users" (handle);
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toHaveLength(0);
    });

    it('制約追加は警告しない', () => {
      const content = `
        ALTER TABLE "public"."users" ADD CONSTRAINT fk_profile FOREIGN KEY (profile_id) REFERENCES "public"."profiles"(id);
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toHaveLength(0);
    });

    it('DROP TABLE IF EXISTS は破壊的DDLとして警告する(テーブル名が異なっても)', () => {
      const content = `
        DROP TABLE IF EXISTS "public"."temp_migration_table";
        CREATE TABLE "public"."users_backup" (
          id SERIAL PRIMARY KEY,
          data JSONB
        );
      `;
      const warnings = scanMigrationContent(content);
      // この場合、DROP TABLE が検知される可能性があるが、
      // スキーマ間テーブル移動ではないので DROP TABLE の警告だけ
      expect(warnings).toContain('DROP TABLE');
    });
  });

  describe('コメント・ホワイトスペース対応', () => {
    it('SQL コメントを含むmigrationをスキャンする', () => {
      const content = `
        -- 古いテーブルを削除
        DROP TABLE "public"."legacy_table";

        -- 新しいテーブルを作成
        CREATE TABLE "public"."new_table" (
          id SERIAL PRIMARY KEY
        );
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('DROP TABLE');
    });

    it('複数行の ALTER を含むmigrationをスキャンする', () => {
      const content = `
        ALTER TABLE "public"."users"
          DROP COLUMN old_field,
          ADD COLUMN new_field TEXT;
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('DROP COLUMN');
    });

    it('大文字小文字を区別しないでスキャンする', () => {
      const content = `
        drop table "public"."old_table";
        alter table "public"."users" drop column deprecated;
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('DROP TABLE');
      expect(warnings).toContain('DROP COLUMN');
    });
  });

  describe('既存アーカイブのmigrationを検知できる', () => {
    it('破壊的DDLを含むアーカイブmigrationの例: drop_gift_edits', () => {
      // 実際のmigrationから抽出した例
      const content = `
        DROP TABLE "public"."GiftEdit";
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('DROP TABLE');
    });

    it('破壊的DDLを含むアーカイブmigrationの例: drop_tiktok_battle_raw', () => {
      // 実際のmigrationから抽出した例
      const content = `
        DROP TABLE "public"."TiktokBattleRaw";
      `;
      const warnings = scanMigrationContent(content);
      expect(warnings).toContain('DROP TABLE');
    });
  });
});
