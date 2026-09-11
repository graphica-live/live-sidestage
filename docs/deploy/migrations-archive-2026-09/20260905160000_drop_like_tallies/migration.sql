-- いいね(Like)の日次累計テーブル(LikeTally)を撤去。pruning(7日超過分削除)が呼び出し元なく
-- 実質無期限蓄積していたこと、当日分しか読まれない一時集計であることから、DB永続化自体をやめ
-- プロセス内インメモリストア(src/lib/overlay/like-tally-store.ts)へ置き換えた(ユーザー承認済み)。
--
-- 注意: 本番デプロイは `prisma db push --accept-data-loss` を使用しており、このファイルは
-- 実行されない(db pushはmigrationsフォルダを読まない)。web起動時のdb pushで
-- like_tallies の行はデータごと消える(当日分の一時データのみで保全対象外、ユーザー承認済み)。

DROP TABLE IF EXISTS "public"."like_tallies";
