-- ### Schema Change Justification: RoomMonitorLease / DetectedBattle.hostDisplayIds / EventMatch.scheduledStartAt,scheduledEndAt / tiktok_battles.hostDisplayIds
--
-- - Change: 本番DBに物理的に残っていた未使用オブジェクト(room_monitor_leasesテーブル、
--   hostDisplayIds/scheduledStartAt/scheduledEndAtカラム)を削除する。
-- - Existing alternatives: 既にコミットb9801ede(chore: Wave1 DB整理)で schema.prisma /
--   呼び出しコード側からは全て除去済み。本migrationはそのコード側変更の本番反映のみ
--   (新規の設計判断は含まない)。
-- - Why existing structures cannot be reused: 該当なし(削除のみ、新規構造なし)。
-- - Source of truth: b9801edeコミットメッセージが削除理由の正本
--   (Wave1-C: 未使用hostDisplayIds除去、Wave1-D: EventMatch dual-write除去、
--   Wave1-E: 未使用RoomMonitorLeaseモデル削除。design-review・code-review完了済み)。
-- - Ownership: 変更なし(削除のみ)。
-- - Lifecycle: 変更なし(削除のみ)。
-- - Relation impact: room_monitor_leases.roomIdのFK制約を先にDROPしてからテーブル削除。
--   他Entityとの依存関係なし(b9801edeで呼び出し元も除去済みのため参照コードは無い)。
-- - Duplication risk: なし。
-- - Synchronization risk: 本DDLは本番の物理スキーマをコード側(schema.prisma)へ追従させる
--   ものであり、schema.prismaとの乖離を解消する側。
-- - Migration impact: このmigration自体がmigration。DROP COLUMN/DROP TABLEのみで、
--   事前にb9801edeで参照コードが無いことをdesign-review/code-reviewで確認済み。
-- - Rollback impact: 過去migrationの不変更方針(計画のRollbackポリシー)に従い、
--   ロールバックは新しいforward migrationで対応する。DROPしたカラム/テーブルの
--   データは失われるため、これらが本当に不要であることは前述のb9801ede側の
--   レビューで確認済みという前提に立つ。
-- - Justification: db push運用停止(prisma migrate deploy移行)により、Wave1整理での
--   コード側削除が本番へ反映される経路が一時的に失われていた。baseline登録前の
--   `migrate diff --exit-code`で検出(差分あり、exit 2)。本番の実態を正確に表す
--   baseline(0_init再生成)を作った上で、この差分を独立migrationとして明示的に適用し、
--   本番を現行schema.prismaへ追従させる。

-- Wave1整理(b9801ede: chore: Wave1 DB整理 — CHECK制約追加・未使用スキーマ要素3件の削除)で
-- コード側(schema.prisma)からは既に削除済みだが、db push運用停止(prisma migrate deploy移行)
-- により本番へ未反映だったオブジェクトを削除する。
--
-- Wave1-C: 未使用のhostDisplayIds(tiktok-listener.ts等)を完全除去。
-- Wave1-D: EventMatch.scheduledStartAt/scheduledEndAtのdual-write箇所を除去。
-- Wave1-E: 未使用のRoomMonitorLease Prismaモデルを削除
--   (tiktok-room.tsの同名TS型とは無関係、そちらは維持)。
--
-- 本ファイルの内容は、baseline再生成時(0_init、本番introspect)と現行schema.prismaとの
-- 差分(`prisma migrate diff --from-schema-datasource prisma/schema.prisma
-- --to-schema-datamodel prisma/schema.prisma --script`、DATABASE_URL=本番)をそのまま採用。

-- DROP COLUMN/DROP TABLEはACCESS EXCLUSIVEロックを要求する。本番の長時間トランザクションで
-- ロック待ちが後続クエリを滞留させないよう、このmigrationのトランザクション内に限定して
-- lock_timeoutを設定する(取得できなければ安全に失敗し、migrate deployは非適用のまま終わる)。
SET LOCAL lock_timeout = '5s';

-- DropForeignKey
ALTER TABLE "public"."room_monitor_leases" DROP CONSTRAINT "room_monitor_leases_roomId_fkey";

-- AlterTable
ALTER TABLE "event"."DetectedBattle" DROP COLUMN "hostDisplayIds";

-- AlterTable
ALTER TABLE "event"."EventMatch" DROP COLUMN "scheduledEndAt",
DROP COLUMN "scheduledStartAt";

-- AlterTable
ALTER TABLE "public"."tiktok_battles" DROP COLUMN "hostDisplayIds";

-- DropTable
DROP TABLE "public"."room_monitor_leases";
