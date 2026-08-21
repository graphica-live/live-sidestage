-- live-sidestage-event 向けの読み取り用 view と GRANT
--
-- このファイルは analytics のテーブル定義に依存する。
-- **prisma/schema.prisma の列を変えたら、ここも追随させること。**
--
-- 適用: superuser で実行する。live-sidestage-event/sql/001-bootstrap.sql を先に適用して
-- event_web / event_worker ロールが存在している必要がある。
--
--   psql "$DATABASE_URL_ADMIN" -f sql/event-integration.sql
--
-- 設計の意図:
--   event サービスには analytics のテーブルへの直接 SELECT を与えない。
--   表単位の SELECT を与えると、Streamer の apiKey / verificationCode / overlayToken や
--   User.password、Account の access/refresh token まで読めてしまうため。
--   必要な列だけを view に出し、view にだけ SELECT を与える。

-- ============================================================
-- ギフト(イベントの集計対象)
-- ============================================================
-- gift_edits(手動編集・非表示)は反映しない。編集は編集した本人のビューにしか
-- 影響しない仕様なので、これを混ぜるとイベントの公式スコアが人によって変わってしまう。
CREATE OR REPLACE VIEW public.event_gift_v AS
  SELECT "roomId",
         "uniqueId",
         nickname,
         "profileImageUrl",
         "repeatCount",
         "totalDiamonds",
         "receivedAt",
         "timeSource"
  FROM public.gifts;

-- ============================================================
-- TikTok ルーム(参加者の紐付け先)
-- ============================================================
CREATE OR REPLACE VIEW public.event_room_v AS
  SELECT id,
         "tiktokId",
         "listenerStatus",
         "listenerUpdatedAt"
  FROM public."TiktokRoom";

-- ============================================================
-- 配信者(参加者が会員登録済みか・BIO認証済みかの参考情報)
-- ============================================================
-- apiKey / verificationCode / overlayToken は出さない。
CREATE OR REPLACE VIEW public.event_streamer_v AS
  SELECT "userId",
         "tiktokId",
         "roomId",
         verified
  FROM public."Streamer";

GRANT SELECT ON public.event_gift_v    TO event_web, event_worker;
GRANT SELECT ON public.event_room_v    TO event_web, event_worker;
GRANT SELECT ON public.event_streamer_v TO event_web, event_worker;

-- ============================================================
-- NextAuth(event_web のみ)
-- ============================================================
-- event は analytics と同じ User/Account を使うことで User.id を共通にする。
-- UPDATE は列を限定して password を触らせない。
-- DELETE はどちらのロールにも与えない — User の DELETE は FK cascade で
-- Streamer とその GiftEdit まで巻き添えにする。
GRANT SELECT, INSERT ON public."User" TO event_web;
GRANT UPDATE (name, email, "emailVerified", image) ON public."User" TO event_web;
GRANT SELECT, INSERT ON public."Account" TO event_web;

-- ============================================================
-- フェーズ4で追加する(tiktok_battles テーブルを作った後に有効化)
-- ============================================================
-- CREATE OR REPLACE VIEW public.event_battle_v AS
--   SELECT "roomId", "battleId", action, complete, "startedAt", "endedAt",
--          "hostUniqueIds", "hostScores", raw, "updatedAt"
--   FROM public.tiktok_battles;
-- GRANT SELECT ON public.event_battle_v TO event_web, event_worker;
