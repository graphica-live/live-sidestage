// 識別子統一リファクタリング(2026-09)の cutover 用スクリプト。
//
// TikTok の可変ハンドル(`uniqueId` / `tiktokId`)を同一性キーにしていた全テーブルを、
// 不変の数値ID(`tiktokUid`)キーへ張り替える。**既存行を移行する手段が無い** —
// ハンドルから uid を引く操作は「改名で空いたハンドルを第三者が取得しうる」ため
// 構造的に信用できず、改名済みハンドルは TikTok 上から永久に取得不能になる。
//
// よって **DB を丸ごと作り直す**。運用開始前で実ユーザーがいないというユーザー判断に基づく。
// RENAME 系の DDL は一切書かない(空表に対しては `db push` の DROP+ADD がそのまま通る)。
//
// 実行位置は `Dockerfile` の CMD、**`prisma db push` の直前**。したがってこのスクリプトは
// 「新イメージの Prisma Client で、まだ db push 前の旧スキーマ」に対して動く。
// **DB 操作は raw SQL を原則にする** — Prisma のモデルアクセサは `select` を省くと生成時点の
// 全列を SELECT するので、変更対象モデルを触った瞬間に P2022 で落ちる。
// Prisma アクセサを使ってよいのは `AppSetting`(このスクリプトが読み書きする marker と
// バックアップ)だけ。
//
// 冪等: **「旧形の列が1つでも実在する」ときだけ実行する**(旧形検出型)。marker は
// 「実行した記録」としてだけ残し、判定には使わない。marker 判定にすると
//   - 新規DB/復元DBの1回目は列が無いので marker が立たない
//   - 2回目のデプロイで「marker 無し」を見て初回〜2回目のデータを全消去する
// という経路が成立する(`migrate-match-session.ts` も旧形検出型で、marker を使っていない)。
//
// **cutover が完了したら Dockerfile の CMD から外すこと。** 残置すると、将来の
// スキーマ変更で旧形の列名が復活した瞬間に本番データを全消去する恒久的な地雷になる。
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

/**
 * このスクリプトが必要とする最小の Prisma 面。
 * テストが**専用の一時DBへ向けた別クライアント**を渡せるようにするために切ってある
 * (本番は `main()` がシングルトンを渡すので挙動は変わらない)。
 */
export type ResetClient = Pick<PrismaClient, "$queryRaw" | "$transaction">;

const TAG = "[migrate-tiktok-userid-reset]";

/** このスクリプト専用の advisory lock キー(他の移行・集計と衝突しない任意の定数)。 */
const MIGRATION_LOCK_KEY = 728_311_009n;

/** 実行記録。判定には使わない(上のコメント参照)。 */
const DONE_MARKER_KEY = "tiktok-userid-reset:done";
/** 手動確定のバックアップ。`:<ISO8601>` を付けた追記専用キーにする。 */
const MANUAL_BACKUP_KEY_PREFIX = "tiktok-userid-reset:manual-decisions-backup";

type ColumnRef = { schema: string; table: string; column: string };

function col(schema: string, table: string, column: string): ColumnRef {
  return { schema, table, column };
}

/**
 * 旧形の列。**1つでも実在すれば cutover 前**と判定して全 TRUNCATE する。
 *
 * 部分状態(あるテーブルだけ旧形へ戻っている)も救う必要があるので OR にする —
 * ロールバックした旧イメージの web が `--accept-data-loss` で新列を DROP すると
 * 旧形が復活し、次の前進で自動的にもう一度 reset が走る。
 */
const LEGACY_COLUMNS: ColumnRef[] = [
  col("public", "gifts", "uniqueId"),
  col("public", "gifts", "nickname"),
  col("public", "listener_comments", "uniqueId"),
  col("public", "gift_daily_listener_stats", "uniqueId"),
  col("public", "gift_lifetime_stats", "uniqueId"),
  col("public", "tiktok_battle_tap_points", "anchorId"),
  col("public", "tiktok_battle_tap_points", "uniqueId"),
  col("public", "tiktok_battle_armies_snapshots", "anchorId"),
  col("public", "tiktok_battle_item_uses", "senderUserId"),
  col("public", "tiktok_battle_item_uses", "senderUniqueId"),
  col("public", "tiktok_battle_item_uses", "targetHostUserId"),
  col("public", "tiktok_battles", "hostUserIds"),
  col("public", "battle_history_participants", "anchorId"),
  col("public", "battle_history_participants", "tiktokId"),
  col("public", "battle_history_participants", "displayId"),
  col("public", "battle_history_participants", "uniqueIdSnapshot"),
  col("public", "battle_history_participants", "nickName"),
  col("public", "battle_history_score_points", "anchorId"),
  col("public", "battle_history_gift_events", "senderTiktokUserId"),
  col("public", "battle_history_gift_events", "senderUniqueIdSnapshot"),
  col("public", "battle_history_item_card_events", "senderTiktokUserId"),
  col("public", "battle_history_item_card_events", "senderUniqueIdSnapshot"),
  col("public", "tiktok_avatar_assets", "kind"),
  col("public", "tiktok_avatar_assets", "subjectId"),
  col("public", "tiktok_room_admin_audit_logs", "tiktokId"),
  // @@map を持たないモデルは物理名が PascalCase のまま。ここを snake_case で書くと
  // to_regclass() が「テーブル無し」として黙ってスキップし、旧行を残したまま
  // db push の NOT NULL 追加へ進んで web が起動できなくなる。
  col("public", "TiktokRoom", "hostUserId"),
  col("public", "TiktokRoom", "tiktokId"),
  col("public", "TiktokRoom", "nickname"),
  col("public", "TiktokRoom", "hostUserIdBackfillGaveUpAt"),
  col("public", "TiktokRoom", "hostUserIdFilledAt"),
  col("public", "TiktokRoom", "hostUserIdAttemptedAt"),
  col("public", "Streamer", "userId"),
  col("public", "Streamer", "tiktokId"),
  col("public", "Subscription", "userId"),
  col("public", "StripeCustomerLink", "userId"),
  col("public", "PendingPurchaseIntent", "userId"),
  col("public", "AgencyWatch", "tiktokId"),
  col("public", "EulerSignUsage", "tiktokId"),
  col("public", "EulerSignUsage", "streamerUserIds"),
  col("event", "Event", "ownerUserId"),
  col("event", "EventParticipant", "userId"),
  col("event", "EventParticipant", "tiktokId"),
  col("event", "EventRoomLease", "tiktokId"),
  col("event", "EventContribution", "listenerUniqueId"),
  col("event", "EventContribution", "nickname"),
  col("event", "EventContribution", "profileImageUrl"),
  col("event", "DetectedBattle", "hostUserIds"),
];

/**
 * 新形で必須になる列。**実行トリガではなく完了検証**(この改修が意図どおり適用されたかの assert)。
 * db push の後に別途確認する用途で export しておく。
 */
export const REQUIRED_NEW_COLUMNS: ColumnRef[] = [
  col("public", "gifts", "tiktokUid"),
  col("public", "listener_comments", "tiktokUid"),
  col("public", "gift_daily_listener_stats", "tiktokUid"),
  col("public", "gift_lifetime_stats", "tiktokUid"),
  col("public", "tiktok_battle_tap_points", "tiktokUid"),
  col("public", "tiktok_battle_tap_points", "hostTiktokUid"),
  col("public", "tiktok_battle_armies_snapshots", "tiktokUid"),
  col("public", "tiktok_battle_item_uses", "senderTiktokUid"),
  col("public", "tiktok_battle_item_uses", "targetHostTiktokUid"),
  col("public", "battle_history_participants", "tiktokUid"),
  col("public", "battle_history_participants", "tiktokHandleSnapshot"),
  col("public", "battle_history_participants", "nicknameSnapshot"),
  col("public", "battle_history_score_points", "tiktokUid"),
  col("public", "battle_history_gift_events", "senderTiktokUid"),
  col("public", "battle_history_item_card_events", "senderTiktokUid"),
  col("public", "tiktok_avatar_assets", "tiktokUid"),
  col("public", "tiktok_users", "tiktokUid"),
  col("public", "TiktokRoom", "hostTiktokUid"),
  col("public", "TiktokRoom", "tiktokHandle"),
  col("public", "Streamer", "principalId"),
  col("public", "Streamer", "tiktokUid"),
  col("event", "EventParticipant", "principalId"),
  col("event", "EventParticipant", "tiktokUid"),
  col("event", "EventContribution", "listenerTiktokUid"),
];

/**
 * TRUNCATE 対象。**参照する側も明示的に列挙する**(CASCADE の暗黙伝播に依存せず、
 * 意図を文面に残すため)。順序はロック順を固定してデッドロックを避ける。
 *
 * 除外しているのは `AppSetting`(運用設定と、このスクリプト自身の marker / バックアップ)、
 * `tiktok_gift_catalog`(TikTok 公式のギフト表。識別子と無関係)、
 * `DbStatsSnapshot`(サイズ推移の観測ログ)の3つだけ。
 */
const TRUNCATE_TARGETS: { schema: string; table: string }[] = [
  // 生観測系
  { schema: "public", table: "gifts" },
  { schema: "public", table: "listener_comments" },
  { schema: "public", table: "gift_daily_listener_stats" },
  { schema: "public", table: "gift_lifetime_stats" },
  { schema: "public", table: "tiktok_battle_tap_points" },
  { schema: "public", table: "tiktok_battle_item_uses" },
  { schema: "public", table: "tiktok_battle_armies_snapshots" },
  { schema: "public", table: "tiktok_battle_bonus_missions" },
  { schema: "public", table: "tiktok_battles" },
  // バトル履歴(battle_histories を起点に CASCADE するが明示列挙する)
  { schema: "public", table: "battle_histories" },
  { schema: "public", table: "battle_teams" },
  { schema: "public", table: "battle_history_participants" },
  { schema: "public", table: "battle_history_gift_events" },
  { schema: "public", table: "battle_history_item_card_events" },
  { schema: "public", table: "battle_history_bonus_missions" },
  { schema: "public", table: "battle_history_score_points" },
  // アバター(kind 廃止 + subjectId → tiktokUid で主キー空間ごと意味を失う)
  { schema: "public", table: "tiktok_avatar_assets" },
  // TikTokUser の正本(新設だが、旧形からの再実行では作り直す)
  { schema: "public", table: "tiktok_users" },
  // room とその従属
  { schema: "public", table: "TiktokRoom" },
  { schema: "public", table: "room_monitor_leases" },
  { schema: "public", table: "room_connection_intervals" },
  { schema: "public", table: "tiktok_room_admin_audit_logs" },
  { schema: "public", table: "ListenerEpoch" },
  // Streamer とその従属(overlay 設定7表。overlayToken / apiKey も失効する)
  { schema: "public", table: "Streamer" },
  { schema: "public", table: "overlay_coin_list_settings" },
  { schema: "public", table: "overlay_top_gift_settings" },
  { schema: "public", table: "overlay_tap_list_settings" },
  { schema: "public", table: "overlay_like_contribution_settings" },
  { schema: "public", table: "overlay_timer_settings" },
  { schema: "public", table: "overlay_timer_gift_rules" },
  { schema: "public", table: "overlay_timer_state" },
  // 事務所
  { schema: "public", table: "AgencyWatch" },
  { schema: "public", table: "Agency" },
  // 署名使用量ログ(streamerUserIds → streamerPrincipalIds の改名対象)
  { schema: "public", table: "EulerSignUsage" },
  // 認証・課金(全データ削除可というユーザー決定により対象に含める。Web も再ログインが要る)
  { schema: "public", table: "Subscription" },
  { schema: "public", table: "StripeCustomerLink" },
  { schema: "public", table: "PendingPurchaseIntent" },
  { schema: "public", table: "Ambassador" },
  { schema: "public", table: "AmbassadorInvite" },
  { schema: "public", table: "Account" },
  { schema: "public", table: "Session" },
  { schema: "public", table: "VerificationToken" },
  { schema: "public", table: "User" },
  // イベント(Event 起点の CASCADE 伝播先を全部明示。DetectedBattle は Event への
  // リレーションを持たないので CASCADE では消えない)
  { schema: "event", table: "Event" },
  { schema: "event", table: "EventSession" },
  { schema: "event", table: "EventMultiplier" },
  { schema: "event", table: "EventTeam" },
  { schema: "event", table: "EventParticipant" },
  { schema: "event", table: "EventRoomLease" },
  { schema: "event", table: "EventMatch" },
  { schema: "event", table: "EventMatchBattleCandidate" },
  { schema: "event", table: "EventMatchSide" },
  { schema: "event", table: "EventMatchSideParticipant" },
  { schema: "event", table: "EventLifePoint" },
  { schema: "event", table: "EventLifeLedger" },
  { schema: "event", table: "EventContribution" },
  { schema: "event", table: "EventStanding" },
  { schema: "event", table: "DetectedBattle" },
];

/** gift-retention のロールアップ水位。reset 後は素直な初期状態に戻しておく。 */
const ROLLUP_WATERMARK_KEY = "gift-retention:rollup-watermark";

type ExistingColumn = { table_schema: string; table_name: string; column_name: string };

/** `information_schema.columns` を1クエリで引く。テーブルが無い場合も単に行が返らないだけ。 */
async function fetchExistingColumns(
  client: Pick<ResetClient, "$queryRaw">
): Promise<Set<string>> {
  const rows = await client.$queryRaw<ExistingColumn[]>`
    SELECT table_schema, table_name, column_name
      FROM information_schema.columns
     WHERE table_schema IN ('public', 'event')`;
  return new Set(rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));
}

function refKey(c: ColumnRef): string {
  return `${c.schema}.${c.table}.${c.column}`;
}

/** 存在する旧形の列。空なら cutover 済み(または新規DB)。 */
export function detectLegacyColumns(existing: Set<string>): ColumnRef[] {
  return LEGACY_COLUMNS.filter((c) => existing.has(refKey(c)));
}

/** 新形で欠けている必須列。db push の後に 0 件であること。 */
export function detectMissingNewColumns(existing: Set<string>): ColumnRef[] {
  return REQUIRED_NEW_COLUMNS.filter((c) => !existing.has(refKey(c)));
}

function quoted(schema: string, table: string): string {
  return `"${schema}"."${table}"`;
}

/**
 * TRUNCATE 対象のうち実在するものだけを返す。
 *
 * **skip してよいのは「テーブルがまだ無い」ケースだけ**(新規ローカルDB / CI の空DB)。
 * 名前の誤記との区別がつかなくなるので、`to_regclass()` が null を返した対象は
 * 呼び出し側でログに出す。
 */
async function existingTruncateTargets(
  tx: { $queryRawUnsafe: <T>(sql: string) => Promise<T> }
): Promise<{ present: string[]; absent: string[] }> {
  const present: string[] = [];
  const absent: string[] = [];
  for (const t of TRUNCATE_TARGETS) {
    const name = quoted(t.schema, t.table);
    const rows = await tx.$queryRawUnsafe<{ oid: string | null }[]>(
      `SELECT to_regclass('${name}')::text AS oid`
    );
    if (rows[0]?.oid) present.push(name);
    else absent.push(name);
  }
  return { present, absent };
}

type ManualDecision = {
  matchId: string;
  eventId: string;
  round: number | null;
  bracketPosition: number | null;
  status: string | null;
  winnerSideId: string | null;
  winnerDecidedBy: string | null;
  decidedAt: Date | null;
};

/**
 * 主催者が手で確定した勝敗を、**全 TRUNCATE より前に**採取する。
 *
 * 自動復元はしない(復元してもブラケットの feeder 依存が不整合のまま戻るだけ)。
 * 主催者が手で作り直すときの参照材料として `AppSetting` へ残す。
 * **write-once**(既存キーは上書きしない)で、空なら保存しない。
 */
async function backupManualDecisions(
  tx: {
    $queryRawUnsafe: <T>(sql: string) => Promise<T>;
    appSetting: {
      findUnique: (a: { where: { key: string } }) => Promise<{ key: string } | null>;
      create: (a: { data: { key: string; value: string } }) => Promise<unknown>;
    };
  }
): Promise<number> {
  const exists = await tx.$queryRawUnsafe<{ oid: string | null }[]>(
    `SELECT to_regclass('"event"."EventMatch"')::text AS oid`
  );
  if (!exists[0]?.oid) return 0;

  const rows = await tx.$queryRawUnsafe<ManualDecision[]>(
    `SELECT id AS "matchId", "eventId", round, "bracketPosition", status,
            "winnerSideId", "winnerDecidedBy", "decidedAt"
       FROM "event"."EventMatch"
      WHERE "winnerDecidedBy" IN ('MANUAL', 'DRAW')`
  );
  if (rows.length === 0) return 0;

  const key = `${MANUAL_BACKUP_KEY_PREFIX}:${new Date().toISOString()}`;
  if (await tx.appSetting.findUnique({ where: { key } })) return rows.length;
  await tx.appSetting.create({ data: { key, value: JSON.stringify(rows) } });
  console.warn(`${TAG} 手動確定 ${rows.length} 件を ${key} へ退避しました:`);
  console.warn(JSON.stringify(rows, null, 2));
  return rows.length;
}

/**
 * 本体。`client` を引数で受けるのは、統合テストが**専用の一時DBへ向けた別クライアント**を
 * 渡せるようにするため(このスクリプトは全テーブルを TRUNCATE するので、
 * 他のテストと同じDBでは走らせられない)。本番は `main()` がシングルトンを渡す。
 */
export async function runReset(client: ResetClient) {
  const existing = await fetchExistingColumns(client);
  const legacy = detectLegacyColumns(existing);
  if (legacy.length === 0) {
    console.log(`${TAG} 旧形の列が1つも見つかりません。cutover 済み(または新規DB)としてスキップします。`);
    return;
  }

  console.log(`${TAG} 旧形の列を ${legacy.length} 件検出しました。全テーブルの TRUNCATE を開始します。`);
  console.log(`${TAG} 検出: ${legacy.map(refKey).join(", ")}`);

  await client.$transaction(
    async (tx) => {
      // web が複数同時に起動しても二重に走らせない。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY}::bigint)`;

      // ロック待ちの間に別プロセスが終わらせているかもしれないので、もう一度見る。
      const nowExisting = await fetchExistingColumns(tx);
      if (detectLegacyColumns(nowExisting).length === 0) {
        console.log(`${TAG} 別プロセスが先に完了させたようです。何もしません。`);
        return;
      }

      // **TRUNCATE より前に採取する。** event."Event" を TRUNCATE すると
      // EventMatch は CASCADE で消えるので、後から採ると必ず空になる。
      await backupManualDecisions(tx as never);

      const { present, absent } = await existingTruncateTargets(tx as never);
      if (absent.length > 0) {
        console.log(`${TAG} 未作成のためスキップ: ${absent.join(", ")}`);
      }
      if (present.length === 0) {
        console.log(`${TAG} TRUNCATE 対象のテーブルが1つもありません。`);
        return;
      }

      await tx.$executeRawUnsafe(
        `TRUNCATE ${present.join(", ")} RESTART IDENTITY CASCADE`
      );
      console.log(`${TAG} ${present.length} テーブルを TRUNCATE しました。`);

      // ロールアップ水位は残っていても壊れない(lookback で毎回再集計されるため)が、
      // reset 直後は Gift 本体だけを読む素直な状態に揃えておく。
      await tx.appSetting.deleteMany({ where: { key: ROLLUP_WATERMARK_KEY } });

      await tx.appSetting.upsert({
        where: { key: DONE_MARKER_KEY },
        create: { key: DONE_MARKER_KEY, value: new Date().toISOString() },
        update: { value: new Date().toISOString() },
      });
    },
    { timeout: 120_000, maxWait: 20_000 }
  );

  console.log(`${TAG} 完了しました。この後の prisma db push が新スキーマを適用します。`);
}

async function main() {
  await runReset(prisma);
}

if (require.main === module) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(`${TAG} 失敗しました:`, err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
