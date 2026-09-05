// TikTokの全ギフトカタログ(`gift/list/`)を取得して `public."tiktok_gift_catalog"` に貯める。
//
// 用途はモバイルの「ギフトを選ぶ」ピッカーの候補を、自分の部屋の受信履歴だけでなく
// TikTokの全ギフトへ広げること。**効果音の一致キーは名前なので、ここが返すのも名前が主役**で、
// giftIdはカタログを素直な鏡として持つためだけに使う(schema.prisma の TiktokGiftCatalog 参照)。
//
// 設計上の約束:
//  - **ライブ接続には一切影響させない。** 失敗はログのみ。呼び出し元へ例外を投げない
//  - `enableExtendedGiftInfo: true` は使わない。あれを立てると connect() の内部で
//    fetchAvailableGifts() が呼ばれ、失敗時に InvalidResponseError を投げて
//    **ライブ接続そのものが落ちる**(TLC-sidestage/dist/lib/client.js:192-194)。
//    未接続の使い捨て接続から明示的に呼ぶ方が、失敗を隔離できる
//  - 書き込みは**1本の multi-row INSERT ... ON CONFLICT DO UPDATE**。文が1つなら原子的なので、
//    「途中まで書けた状態が他プロセスから新しい fetchedAt に見える」が構造的に起きない
//  - `fetchedAt` は create/update の**両方で明示的に**入れる。`@default(now())` は
//    既存行の更新時には発火しないため、これを怠ると MAX(fetchedAt) が永久に進まない
//  - `imageUrl`(ピッカーに出すギフトのアイコン)は検証を通ったURLだけ入れる。取れなくても
//    エントリは捨てない。TTL内でも1回だけ前倒しで取り直す条件があるので shouldBackfillImages() を参照
//  - **`gift/list/` を英語版と日本語版の2回叩く。** 日本語表示名(`labelJa`)をTikTok公式から
//    取るため。`name`(一致キー)と `label` は必ず英語版から採り、日本語は `labelJa` にだけ入れる。
//    ここを混ぜると効果音が無言で鳴らなくなる — 詳細は mergeLocalizedCatalog() のコメント。
//    日本語版の取得は表示にしか効かないので、失敗してもカタログ更新は通す
import { WebcastPushConnection } from "TLC-sidestage";
import { ProxyAgent } from "proxy-agent";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { isAllowedAvatarUrl } from "./tiktok-profile";

// カタログの鮮度。これより新しければ何もしない。
// イベント用ギフトがイベント開始直前に追加されるケースがあるため24時間から短縮した。
// この判定はDB共有のMAX(fetchedAt)を見るので、複数プロセス(web/worker1〜3)がいても
// 実際の取得回数は単純にTTLの短縮分(12倍)で収まる(プロセス数倍にはならない)。
export const CATALOG_TTL_MS = 2 * 60 * 60 * 1000;

// 取得に失敗したときにプロセス内で待つ時間。
//
// **これが無いと失敗時に叩き続ける。** 失敗すると fetchedAt が進まないので、
// 30秒ごとのreconcileが毎周回リトライしてしまう。TikTok側の一時障害や
// proxyの不調でそうなると、同じproxyを共有しているライブ接続まで巻き添えになる。
export const CATALOG_FAILURE_BACKOFF_MS = 30 * 60 * 1000;

// 1回のリフレッシュで走査するエントリ数の上限(壊れたレスポンスで無制限に処理しない)。
// 実測のカタログは670件。
const MAX_CATALOG_ENTRIES = 2000;

// 表示名の長さ上限。上流の異常値1件で書き込み全体を落とさないための保険。
const MAX_LABEL_LENGTH = 100;

// PostgreSQLのinteger(Prismaの `Int`)の上限。これを超える値は捨てる/0にする。
const PG_INT4_MAX = 2147483647;

export interface CatalogEntry {
  giftId: number;
  /** 一致キー。trim + 小文字化済み。 */
  name: string;
  /** 表示用。カタログの元表記。 */
  label: string;
  diamondCount: number;
  /** ギフトのアイコン。検証を通ったURLだけ。取れなければ null(エントリは捨てない)。 */
  imageUrl: string | null;
}

/** [CatalogEntry] に日本語表示名を足したもの。DBへ書くのはこの形。 */
export interface LocalizedCatalogEntry extends CatalogEntry {
  /**
   * TikTok公式の日本語表示名。**表示専用で、一致キーには絶対に使わない。**
   * 日本語版の取得に失敗した / 日本語版に存在しないgiftIdでは null。
   */
  labelJa: string | null;
}

/**
 * `gift/list/` を叩くときのロケール。
 *
 * - `default`: 言語パラメータを渡さない(connectorの既定 = en)。**`name` / `label` の供給元**
 * - `ja`: `webcast_language: "ja-JP"`。**`labelJa` の供給元**
 *
 * 実測(2026-08-27): 日本語名を返させる条件は `webcast_language=ja-JP` ただ1つ。
 * `ja`(2文字)では効かず、`app_language` / `browser_language` / `region` / `tz_name` /
 * `Accept-Language` ヘッダ / Cookie / room_id はいずれも無関係。地域にも依存しない
 * (Railway本番のSingaporeから `region=DE` のままでも日本語が返る)。
 */
export type CatalogLocale = "default" | "ja";

/** カタログ取得に使う部屋の情報。使い捨て接続のconstructorへそのまま渡す。 */
export interface GiftCatalogSource {
  tiktokId: string;
  deviceId: string;
  /** 段階的廃止対象。`GIFT_CATALOG_PROXY_URL`(日本プロキシ)未設定時のみのフォールバックとして使う。 */
  proxyUrl: string | null;
  /** 生きているライブ接続が持つ数値room_id。コミュニティギフト反映用。無ければ省略。 */
  roomId?: string;
}

export interface GiftCatalogDeps {
  fetchGifts: (source: GiftCatalogSource, locale: CatalogLocale) => Promise<unknown>;
  now: () => number;
}

// ---------------------------------------------------------------------------
// 正規化
// ---------------------------------------------------------------------------

// 制御文字(改行・タブ含む)を落とす。ギフト名に入る余地はないが、
// 入ってきた場合に表示やログを壊さないため。
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

function toBoundedInt(value: unknown, max: number): number | null {
  // Number(true) === 1 のような取り違えを避けるため、数値か数値文字列だけ受ける。
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < 0 || n > max) return null;
  return n;
}

function pickLabel(raw: Record<string, unknown>): string | null {
  // 実測では `name` しか存在しない(`giftName` / `giftTextName` / `giftSkinName` は無い)。
  // `giftName` を残しているのはpayload変化への最小限の保険。
  for (const key of ["name", "giftName"]) {
    const value = raw[key];
    if (typeof value !== "string") continue;
    const label = value.replace(CONTROL_CHARS, "").trim();
    if (label) return label.slice(0, MAX_LABEL_LENGTH);
  }
  return null;
}

// 画像URLが入りうる場所。実測は `image.url_list` だが、payload変化への保険として
// desktop の `getTikTokGiftImageUrl()` と同じ候補を並べる。
const IMAGE_CONTAINERS = ["image", "giftImage", "icon"] as const;
const IMAGE_URL_KEYS = ["url_list", "urlList", "url"] as const;

/**
 * ギフトのアイコンURLを取り出す。
 *
 * **`<img src>` / `Image.network` へ渡る値なので、検証を通ったものだけ採る。**
 * 候補配列は先頭から順に見て、最初に [isAllowedAvatarUrl] を通ったURLを返す
 * (先頭が見知らぬCDNでも後続に使えるURLがあれば拾う)。1つも通らなければ null。
 */
export function pickImageUrl(raw: Record<string, unknown>): string | null {
  for (const container of IMAGE_CONTAINERS) {
    const value = raw[container];
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    for (const key of IMAGE_URL_KEYS) {
      const urls = record[key];
      if (!Array.isArray(urls)) continue;
      for (const url of urls) {
        if (isAllowedAvatarUrl(url)) return url;
      }
    }
  }
  return null;
}

/**
 * `gift/list/` のレスポンスを正規化する。
 *
 * - 不正なエントリは捨てる(1件の異常で全体を落とさない)
 * - **同一giftIdの重複を後勝ちで畳む**。実測でレスポンス内に4行の重複がある
 * - `giftId` 昇順に並べて返す。全ライターが同じ順序で行ロックを取るようにするため
 */
export function normalizeCatalogEntries(raw: unknown): CatalogEntry[] {
  if (!Array.isArray(raw)) return [];

  const byGiftId = new Map<number, CatalogEntry>();
  for (const item of raw.slice(0, MAX_CATALOG_ENTRIES)) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;

    const giftId = toBoundedInt(record.id, PG_INT4_MAX);
    if (giftId === null || giftId <= 0) continue;

    const label = pickLabel(record);
    if (!label) continue;

    const diamondCount =
      toBoundedInt(record.diamond_count, PG_INT4_MAX) ??
      toBoundedInt(record.diamondCount, PG_INT4_MAX) ??
      0;

    byGiftId.set(giftId, {
      giftId,
      name: label.toLowerCase(),
      label,
      diamondCount,
      imageUrl: pickImageUrl(record),
    });
  }

  return Array.from(byGiftId.values()).sort((a, b) => a.giftId - b.giftId);
}

/**
 * 英語版と日本語版のカタログを giftId で突き合わせる。
 *
 * **英語版が土台。** `name`(一致キー) と `label` は必ず英語版から採る。ここを日本語に
 * すると、効果音の一致キーが「バラ」になる一方で `chat:gift` は英語小文字の `"rose"` を
 * 送り続けるので、**例外もログも出ないまま全ユーザーの効果音が鳴らなくなる**
 * (LIVEのgiftイベントはWSのprotobuf由来で英語固定。実機で確認済み)。
 *
 * 突合の規則:
 *  - 両方にある → `labelJa` は日本語版の表記
 *  - 英語版のみ → `labelJa` は null。2回の取得は別接続・別時刻なので集合ずれは構造的に起きる
 *  - 日本語版のみ → **捨てる**。英語の一致キーが作れないので、入れても効果音に結び付けられない
 *
 * 日本語版が英語と同じ文字列でも null にせずそのまま入れる。日本語環境でも英語表記のままの
 * ギフト(`GG` / `TikTok Universe+` など実測20件)で、モバイルが `giftLabel` を持たない
 * 旧設定の正式表記を復元できなくなるため。
 */
export function mergeLocalizedCatalog(
  base: CatalogEntry[],
  ja: CatalogEntry[]
): LocalizedCatalogEntry[] {
  const jaByGiftId = new Map(ja.map((e) => [e.giftId, e.label]));
  return base.map((entry) => ({ ...entry, labelJa: jaByGiftId.get(entry.giftId) ?? null }));
}

// ---------------------------------------------------------------------------
// 取得
// ---------------------------------------------------------------------------

// proxyのURLにはbasic認証の資格情報が入ることがある。例外メッセージをそのまま
// ログへ流すと漏れるので、`//user:pass@` の形だけ潰す。
function redact(message: string): string {
  return message.replace(/\/\/[^/@\s]+:[^/@\s]+@/g, "//***:***@");
}

function describeError(err: unknown): string {
  if (err instanceof Error) return redact(`${err.name}: ${err.message}`);
  return redact(String(err));
}

/**
 * カタログ取得専用の日本プロキシ(Webshare、単一URL)。ライブ接続用の `TIKTOK_PROXY_POOL`
 * (東南アジア系、JSON配列、sticky割当)とは無関係な別変数。
 *
 * 地域限定ギフト(`is_global_gift: false`)の可否は egress IP のリージョンだけで決まり、
 * room_id・device_id・region パラメータでは変えられない(2026-09実測)。本番の
 * `TIKTOK_PROXY_POOL` は東南アジア系のため、日本限定ギフトを恒久的に取りこぼしていた。
 */
function getGiftCatalogProxyUrl(): string | null {
  return process.env.GIFT_CATALOG_PROXY_URL || null;
}

export const PROXY_ATTEMPT_LOG_KEY = "giftCatalogProxyAttemptLog";
const PROXY_ATTEMPT_LOG_MAX_ENTRIES = 50;
// pg_try_advisory_xact_lock用のロックキー。worker-guardian.ts の GUARDIAN_LOCK_KEY とは別値。
const PROXY_ATTEMPT_LOG_LOCK_KEY = 837234501;

export interface ProxyAttemptLogEntry {
  /** ISO文字列。 */
  at: string;
  locale: CatalogLocale;
  /** どの部屋を取得元にしたか。プロキシURL自体は記録しない。 */
  tiktokId: string;
  /** `GIFT_CATALOG_PROXY_URL` が設定されていたか。 */
  usedJpProxy: boolean;
  outcome: "success" | "failure";
  /** success時のみ。 */
  giftCount?: number;
  /** failure時のみ。describeError() 通過済み(資格情報はマスク済み)。 */
  error?: string;
}

/**
 * 直近のカタログ取得(日本プロキシ経由)成功/失敗履歴を記録する。管理画面
 * `/admin/proxy` の表示元。書き込み失敗はカタログ取得自体を止めない(呼び出し元でconsole.warn)。
 *
 * worker1/2/3の3プロセスが同時にこの関数を呼びうるため、`pg_try_advisory_xact_lock`
 * (worker-guardian.ts の appendAuditLog と同じ方式)で read-modify-write を保護する。
 * ロック取得に失敗した側はこのエントリを諦めて次回に譲る(監視ログなので1件欠落は許容、
 * ブロッキング再試行はしない)。
 */
async function recordProxyAttempt(entry: ProxyAttemptLogEntry): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${PROXY_ATTEMPT_LOG_LOCK_KEY}::bigint) AS locked
      `;
      if (!locked) {
        console.warn("[gift-catalog] proxy attempt log: 別プロセスが書き込み中のためスキップ");
        return;
      }
      const row = await tx.appSetting.findUnique({ where: { key: PROXY_ATTEMPT_LOG_KEY } });
      let list: ProxyAttemptLogEntry[] = [];
      if (row?.value) {
        try {
          const parsed = JSON.parse(row.value);
          if (Array.isArray(parsed)) list = parsed;
        } catch {
          list = [];
        }
      }
      list.push(entry);
      const trimmed = list.slice(-PROXY_ATTEMPT_LOG_MAX_ENTRIES);
      await tx.appSetting.upsert({
        where: { key: PROXY_ATTEMPT_LOG_KEY },
        create: { key: PROXY_ATTEMPT_LOG_KEY, value: JSON.stringify(trimmed) },
        update: { value: JSON.stringify(trimmed) },
      });
    });
  } catch (err) {
    console.warn("[gift-catalog] proxy attempt log write failed:", describeError(err));
  }
}

export async function fetchGiftsFromTikTok(
  source: GiftCatalogSource,
  locale: CatalogLocale
): Promise<unknown> {
  const jpProxyUrl = getGiftCatalogProxyUrl();
  // 日本プロキシを優先する。**英語版・日本語版どちらの呼び出しにも同じプロキシを使う**
  // (地域ゲーティングは webcast_language と無関係にIPだけで決まるため、default ロケールにも必須)。
  // 未設定時のみ既存の部屋プロキシへフォールバックする(無音で東南アジアのままだが、
  // カタログ取得自体は失敗させない)。
  // **設定済みの日本プロキシ自体が障害中でも部屋プロキシへは落とさない**(意図的)。
  // 落とすと地域限定ギフトの取りこぼしが黙って再発するため、失敗はそのまま記録して
  // 次周回(TTL経過後)の再試行に委ねる。障害時は`usedJpProxy: true`のfailureエントリが
  // /admin/proxy に積み上がるので検知できる。
  const proxyUrl = jpProxyUrl ?? source.proxyUrl;

  // WebSocketは張らない。HTTPで `gift/list/` を1回叩くためだけの使い捨て接続。
  const conn = new WebcastPushConnection(`@${source.tiktokId}`, {
    processInitialData: false,
    fetchRoomInfoOnConnect: false,
    enableExtendedGiftInfo: false,
    enableWebsocketUpgrade: false,
    enableRequestPolling: false,
    authenticateWs: false,
    sessionId: undefined,
    webClientParams: {
      device_platform: "web",
      device_id: source.deviceId,
      // **`webcast_language` だけが効く。** 以前ここには `app_language: "ja"` が入っていたが、
      // 実測でこのパラメータは名前のロケールに一切影響しなかった([CatalogLocale] のコメント参照)。
      ...(locale === "ja" ? { webcast_language: "ja-JP" } : {}),
    },
    // ライブ接続と同じegress IPを通す。Railwayの素のIPを晒さないため。
    ...(proxyUrl
      ? {
          webClientOptions: {
            httpsAgent: new ProxyAgent({ getProxyForUrl: () => proxyUrl }),
          },
        }
      : {}),
  } as unknown as Record<string, unknown>);

  // constructorの setDisconnected() が room_id='' を無条件に上書きするため、
  // この代入は必ず construct **後**、fetchAvailableGifts() 呼び出し**前**に置く。
  // clientParams は参照で返るgetterなので、この代入が fetchAvailableGifts() 側にも反映される。
  if (source.roomId) {
    conn.clientParams.room_id = source.roomId;
  }

  try {
    const result = await conn.fetchAvailableGifts();
    const giftCount = Array.isArray(result) ? result.length : undefined;
    await recordProxyAttempt({
      at: new Date().toISOString(),
      locale,
      tiktokId: source.tiktokId,
      usedJpProxy: jpProxyUrl !== null,
      outcome: "success",
      giftCount,
    });
    return result;
  } catch (err) {
    await recordProxyAttempt({
      at: new Date().toISOString(),
      locale,
      tiktokId: source.tiktokId,
      usedJpProxy: jpProxyUrl !== null,
      outcome: "failure",
      error: describeError(err),
    });
    throw err;
  } finally {
    // 成否に関わらず必ず片付ける。
    try {
      conn.disconnect?.();
    } catch {
      // 未接続のdisconnectが投げても無視する。
    }
  }
}

const defaultDeps: GiftCatalogDeps = {
  fetchGifts: fetchGiftsFromTikTok,
  now: () => Date.now(),
};

// プロセス内の多重取得ガード。TTL確認からDB書き込み完了までを包含する。
let inFlight: Promise<void> | null = null;
// 最後に失敗した時刻。CATALOG_FAILURE_BACKOFF_MS のあいだ再試行しない。
let lastFailureAt = 0;
// `imageUrl` 列を足したあとの前倒し取得を、**プロセスごとに1回だけ**に絞るフラグ。
// 詳細は shouldBackfillImages() のコメント。
let imageBackfillDone = false;
// `labelJa` 列を足したあとの前倒し取得を、同じくプロセスごとに1回だけに絞るフラグ。
let jaLabelBackfillDone = false;

/** テスト用。モジュールスコープの状態を初期化する。 */
export function __resetGiftCatalogStateForTest() {
  inFlight = null;
  lastFailureAt = 0;
  imageBackfillDone = false;
  jaLabelBackfillDone = false;
}

/**
 * TTL内でも取り直すべきか(`imageUrl` の前倒しバックフィル)。
 *
 * 列を足した直後は全行 null なので、TTLだけ見ていると最大24時間ピッカーに画像が出ない。
 * そこで「画像を持つ行が1件も無い」ときに一度だけ stale とみなす。
 *
 * **プロセスごとに1回で打ち切る。** 「取得は成功したが画像が1件も取れない」
 * (TikTokが `image` を返さなくなった・CDNホストがallowlist外へ変わった)場合、
 * 条件だけで判定すると `lastFailureAt` は成功で0のまま条件が真であり続け、
 * **30秒ごとのreconcileが `gift/list/` を叩き続ける**。ライブ接続と共有しているproxyを
 * 消耗させるので、成否に関わらず1周したらフラグを消費して通常のTTLへ戻す。
 */
async function shouldBackfillImages(): Promise<boolean> {
  if (imageBackfillDone) return false;
  const withImage = await prisma.tiktokGiftCatalog.count({ where: { imageUrl: { not: null } } });
  if (withImage > 0) {
    // すでに画像がある。以後この判定自体を省く。
    imageBackfillDone = true;
    return false;
  }
  return true;
}

/**
 * TTL内でも取り直すべきか(`labelJa` の前倒しバックフィル)。
 *
 * 理由も打ち切りの規律も [shouldBackfillImages] と同じ。列を足した直後はカタログが
 * 「新鮮」なので、TTLだけ見ていると最大24時間 `labelJa` が null のまま = ピッカーが
 * 英語のままになる。
 */
async function shouldBackfillJaLabels(): Promise<boolean> {
  if (jaLabelBackfillDone) return false;
  const withJa = await prisma.tiktokGiftCatalog.count({ where: { labelJa: { not: null } } });
  if (withJa > 0) {
    jaLabelBackfillDone = true;
    return false;
  }
  return true;
}

async function writeCatalog(entries: LocalizedCatalogEntry[], fetchedAt: Date): Promise<void> {
  // multiSchemaでは raw SQL が自動修飾されないので完全修飾する。
  //
  // **1文で書き切る。** 複数文をトランザクション無しで流すと、先頭だけ更新された時点で
  // 他プロセスに新しい MAX(fetchedAt) が見えてしまい、途中で失敗しても24時間成功扱いになる。
  const values = entries.map(
    (e) =>
      Prisma.sql`(${e.giftId}, ${e.name}, ${e.label}, ${e.labelJa}, ${e.diamondCount}, ${e.imageUrl}, ${fetchedAt})`
  );

  // **`labelJa` だけ COALESCE で守る。** 日本語版の取得は英語版と独立に失敗しうるので、
  // 素直に EXCLUDED を入れると TikTok 側の一時不調1回で全行の日本語名が消え、
  // 次の成功(最短24時間後)まで英語表示に戻ってしまう。他の列は英語版の取得が成功した
  // 場合にしかここへ来ないので、そのまま上書きしてよい。
  await prisma.$executeRaw`
    INSERT INTO public."tiktok_gift_catalog" ("giftId", "name", "label", "labelJa", "diamondCount", "imageUrl", "fetchedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("giftId") DO UPDATE SET
      "name" = EXCLUDED."name",
      "label" = EXCLUDED."label",
      "labelJa" = COALESCE(EXCLUDED."labelJa", public."tiktok_gift_catalog"."labelJa"),
      "diamondCount" = EXCLUDED."diamondCount",
      "imageUrl" = EXCLUDED."imageUrl",
      "fetchedAt" = EXCLUDED."fetchedAt"
  `;
}

/**
 * カタログが古ければ取り直す。新しければ何もしない。
 *
 * `resolveSources` は**TTLと失敗バックオフを通過したときにだけ**呼ばれる。
 * 取得元の解決(部屋の検索・deviceId・proxy)にDBアクセスが要るので、
 * 30秒ごとに無駄打ちしないため遅延にしている。
 *
 * **この関数は例外を投げない。** ライブ接続の維持がカタログ取得の失敗に引きずられてはいけない。
 */
export async function refreshGiftCatalogIfStale(
  resolveSources: () => Promise<GiftCatalogSource[]>,
  deps: GiftCatalogDeps = defaultDeps
): Promise<void> {
  if (inFlight) return inFlight;

  const startedAt = deps.now();
  if (lastFailureAt !== 0 && startedAt - lastFailureAt < CATALOG_FAILURE_BACKOFF_MS) return;

  inFlight = (async () => {
    try {
      const latest = await prisma.tiktokGiftCatalog.aggregate({ _max: { fetchedAt: true } });
      const fetchedAt = latest._max.fetchedAt;
      const fresh = fetchedAt !== null && startedAt - fetchedAt.getTime() < CATALOG_TTL_MS;
      if (fresh && !(await shouldBackfillImages()) && !(await shouldBackfillJaLabels())) return;

      const sources = await resolveSources();
      if (sources.length === 0) return; // 担当している部屋が無い。失敗ではないのでバックオフもしない

      // **複数の部屋から取って和集合にする。** 地域限定ギフト(`is_global_gift: false`)の可否は
      // egress IP のリージョンだけで決まり部屋非依存(2026-09実測、`GIFT_CATALOG_PROXY_URL` で
      // 対応済み)。一方、部屋(アカウント)ごとに変わるのは配信者固有のコミュニティギフトで、
      // これは各部屋の数値room_idを渡したときだけ追加される(`GiftCatalogSource.roomId`)。
      // 複数部屋から集めるのは、後者を複数配信者ぶん一度に拾うため。先に見つかった部屋の
      // giftIdを優先し(決定的にするため)、後続の部屋は前の部屋に無かったgiftIdだけ足す。
      const baseByGiftId = new Map<number, CatalogEntry>();
      const jaByGiftId = new Map<number, CatalogEntry>();
      let anyBaseSucceeded = false;

      for (const source of sources) {
        // **英語版は必須。** `name`(一致キー)と `label` の供給元。この部屋で取れなければ
        // 日本語版も叩かず次の部屋へ進む。
        let base: CatalogEntry[];
        try {
          base = normalizeCatalogEntries(await deps.fetchGifts(source, "default"));
        } catch (err) {
          console.warn("[gift-catalog] base fetch failed for a room (trying next):", describeError(err));
          continue;
        }
        if (base.length === 0) continue;
        anyBaseSucceeded = true;
        for (const entry of base) {
          if (!baseByGiftId.has(entry.giftId)) baseByGiftId.set(entry.giftId, entry);
        }

        // **日本語版は表示専用なので、落ちてもカタログ更新そのものは通す。** 失敗扱いにすると
        // 名前・価格・画像の更新まで止まる。既存の `labelJa` は writeCatalog() の
        // COALESCE が守るので、ここが空でも日本語表示は消えない。
        try {
          const ja = normalizeCatalogEntries(await deps.fetchGifts(source, "ja"));
          for (const entry of ja) {
            if (!jaByGiftId.has(entry.giftId)) jaByGiftId.set(entry.giftId, entry);
          }
        } catch (err) {
          console.warn(
            "[gift-catalog] ja fetch failed (keeping existing labelJa):",
            describeError(err)
          );
        }
      }

      if (!anyBaseSucceeded) {
        // 空・全件不正を成功扱いにしない。成功にすると壊れたレスポンスで24時間沈黙する。
        throw new Error("gift/list/ returned no usable entries from any source");
      }

      const entries = mergeLocalizedCatalog(
        Array.from(baseByGiftId.values()),
        Array.from(jaByGiftId.values())
      );
      await writeCatalog(entries, new Date(deps.now()));
      lastFailureAt = 0;
      // 画像・日本語名が取れたかどうかに関わらず消費する(取れなければ通常のTTLへ戻す)。
      imageBackfillDone = true;
      jaLabelBackfillDone = true;
      const localized = entries.filter((e) => e.labelJa !== null).length;
      console.log(`[gift-catalog] refreshed ${entries.length} gift(s), ${localized} localized`);
    } catch (err) {
      lastFailureAt = deps.now();
      console.error("[gift-catalog] refresh failed:", describeError(err));
    }
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}
