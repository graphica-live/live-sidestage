-- ギフト履歴の手動編集機能(GiftEdit)を撤去。編集UI・PATCH API・表示時の上書きロジックを
-- コードから削除したため、テーブルも落とす。元データ(gifts)には手を加えない。
--
-- 注意: 本番デプロイは `prisma db push --accept-data-loss` を使用しており、このファイルは
-- 実行されない(db pushはmigrationsフォルダを読まない)。web起動時のdb pushで
-- gift_edits の行はデータごと消える(ユーザー承認済み)。

DROP TABLE IF EXISTS "public"."gift_edits";
