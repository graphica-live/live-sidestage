-- live-sidestage-event を analytics へ統合したときの後片付け。
--
-- 統合前、event は別プロジェクト・別 DB ロールで動いており、analytics のデータは
-- 「列を絞った view + その view にだけ GRANT」という形でしか読めないようにしていた。
-- 統合後はイベント機能が analytics と同じプロセス・同じ接続で動くため、view は不要になった。
-- 読み取りは src/event/analytics-db.ts が public のテーブルを直接引く。
--
-- **これは掃除であって、必須の移行手順ではない。** view が残っていても新しいコードは
-- それを参照しないので何も壊れない。使われないオブジェクトが public に残るだけ。
--
-- 適用: view の所有者ロール(= 元の sql/event-integration.sql を流したロール。Railway の
-- マネージド Postgres なら既定の postgres)で1回実行する。真の superuser でなくてよい。
-- 何度流しても同じ結果になる(冪等)。DROP VIEW IF EXISTS なので、view が無ければ何も起きない。
--
--   psql "$DATABASE_URL_ADMIN" -f sql/drop-event-integration.sql
--
-- **必ずイベント機能を含む版をデプロイした後に実行すること。**
-- 先に view を落とすと、旧版のコードが動いている間だけ集計が失敗する。
-- 逆に view を残したままでも新しいコードは動くので、慌てて流す必要はない。
--
-- ロールバック: git から sql/event-integration.sql を復元して流し直す。

DROP VIEW IF EXISTS public.event_gift_v;
DROP VIEW IF EXISTS public.event_room_v;
DROP VIEW IF EXISTS public.event_streamer_v;
DROP VIEW IF EXISTS public.event_battle_v;

-- ロールを分けて運用していた場合のみ後片付けが要る。
-- (本番では結局ロール分割を適用しておらず、event スキーマの所有者も
--  analytics と同じロールのままなので、通常ここは NOTICE だけ出て終わる)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'event_web') THEN
    REVOKE ALL ON public."User" FROM event_web;
    REVOKE ALL ON public."Account" FROM event_web;
    REVOKE USAGE ON SCHEMA public FROM event_web;
    RAISE NOTICE 'revoked public grants from event_web (drop the role manually once nothing owns objects)';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'event_worker') THEN
    REVOKE USAGE ON SCHEMA public FROM event_worker;
    RAISE NOTICE 'revoked public grants from event_worker';
  END IF;
END
$$;
