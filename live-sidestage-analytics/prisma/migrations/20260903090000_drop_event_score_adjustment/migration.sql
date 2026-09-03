-- 未使用モデルの削除。read/write双方とも本番コードから一切参照なし
-- (主催者によるスコア手動補正機能。schemaにだけ存在し実装されなかった)。
--
-- 注意: 本番デプロイは `prisma db push --accept-data-loss` を使用しており、このファイルは
-- 実行されない(db pushはmigrationsフォルダを読まない)。

DROP TABLE IF EXISTS "event"."EventScoreAdjustment";
