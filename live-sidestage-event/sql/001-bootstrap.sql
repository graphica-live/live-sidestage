-- LIVE Sidestage Event — スキーマとロールの初期化
--
-- 適用: PostgreSQL の superuser(Railway なら既定の postgres ロール)で1回だけ実行する。
-- 冪等なので再実行しても壊れない。DB を復元・clone したら再適用が要る。
--
--   psql "$DATABASE_URL_ADMIN" -f sql/001-bootstrap.sql
--
-- 適用順:
--   1. このファイル(event スキーマとロールを作る)
--   2. live-sidestage-analytics/sql/event-integration.sql(analytics 側の view と GRANT)
--   3. event の migration(event_migrator で `prisma db push`)
--   4. event の web / worker をデプロイ
-- ロールバックは逆順。
--
-- パスワードはこのファイルに書かない。適用後に別途設定する:
--   ALTER ROLE event_migrator PASSWORD '...';
--   ALTER ROLE event_web      PASSWORD '...';
--   ALTER ROLE event_worker   PASSWORD '...';

-- ============================================================
-- ロール
-- ============================================================
-- 3つに分ける理由: 単一ロールだと web も worker も password hash・OAuth トークン・
-- Streamer.apiKey まで読めてしまうため。用途ごとに最小権限を与える。

DO $$
BEGIN
  -- event スキーマの所有者。マイグレーション専用。アプリからは使わない。
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'event_migrator') THEN
    CREATE ROLE event_migrator LOGIN;
  END IF;

  -- Web プロセス。NextAuth の最小 DML + event スキーマの読み書き。
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'event_web') THEN
    CREATE ROLE event_web LOGIN;
  END IF;

  -- 集計ワーカー。analytics の view を読むだけ + event スキーマの読み書き。
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'event_worker') THEN
    CREATE ROLE event_worker LOGIN;
  END IF;
END
$$;

-- ============================================================
-- event スキーマ
-- ============================================================
CREATE SCHEMA IF NOT EXISTS event AUTHORIZATION event_migrator;

GRANT USAGE ON SCHEMA event TO event_web, event_worker;

-- event_migrator が今後作るテーブル・シーケンスに、自動で権限が付くようにする
ALTER DEFAULT PRIVILEGES FOR ROLE event_migrator IN SCHEMA event
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO event_web, event_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE event_migrator IN SCHEMA event
  GRANT USAGE, SELECT ON SEQUENCES TO event_web, event_worker;

-- 既に存在するテーブルにも付与する(再適用時)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA event TO event_web, event_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA event TO event_web, event_worker;

-- ============================================================
-- public スキーマ(analytics 所有)への最小アクセス
-- ============================================================
-- テーブルへの直接 SELECT は与えない。列を絞った view 経由でのみ読む。
-- view の定義と GRANT は live-sidestage-analytics/sql/event-integration.sql にある。
GRANT USAGE ON SCHEMA public TO event_web, event_worker;
