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
//    **ライブ接続そのものが落ちる**(tiktok-live-connector/dist/lib/client.js:192-194)。
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
import { WebcastPushConnection } from "tiktok-live-connector";
import { ProxyAgent } from "proxy-agent";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { isAllowedAvatarUrl } from "./tiktok-profile";

// カタログの鮮度。これより新しければ何もしない。
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

// 取得に失敗したときにプロセス内で待つ時間。
//
// **これが無いと失敗時に叩き続ける。** 失敗すると fetchedAt が進まないので、
// 60秒ごとのreconcileが毎周回リトライしてしまう。TikTok側の一時障害や
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
  proxyUrl: string | null;
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

async function fetchGiftsFromTikTok(
  source: GiftCatalogSource,
  locale: CatalogLocale
): Promise<unknown> {
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
    ...(source.proxyUrl
      ? {
          webClientOptions: {
            httpsAgent: new ProxyAgent({ getProxyForUrl: () => source.proxyUrl as string }),
          },
        }
      : {}),
  } as unknown as Record<string, unknown>);

  try {
    return await conn.fetchAvailableGifts();
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
 * **60秒ごとのreconcileが `gift/list/` を叩き続ける**。ライブ接続と共有しているproxyを
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
 * `resolveSource` は**TTLと失敗バックオフを通過したときにだけ**呼ばれる。
 * 取得元の解決(部屋の検索・deviceId・proxy)にDBアクセスが要るので、
 * 60秒ごとに無駄打ちしないため遅延にしている。
 *
 * **この関数は例外を投げない。** ライブ接続の維持がカタログ取得の失敗に引きずられてはいけない。
 */
export async function refreshGiftCatalogIfStale(
  resolveSource: () => Promise<GiftCatalogSource | null>,
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

      const source = await resolveSource();
      if (!source) return; // 担当している部屋が無い。失敗ではないのでバックオフもしない

      // **英語版は必須。** `name`(一致キー)と `label` の供給元なので、ここが取れないなら
      // カタログを更新する意味がない。
      const base = normalizeCatalogEntries(await deps.fetchGifts(source, "default"));
      if (base.length === 0) {
        // 空・全件不正を成功扱いにしない。成功にすると壊れたレスポンスで24時間沈黙する。
        throw new Error("gift/list/ returned no usable entries");
      }

      // **日本語版は表示専用なので、落ちてもカタログ更新そのものは通す。** 失敗扱いにすると
      // 名前・価格・画像の更新まで24時間止まる。既存の `labelJa` は writeCatalog() の
      // COALESCE が守るので、ここが空でも日本語表示は消えない。
      let ja: CatalogEntry[] = [];
      try {
        ja = normalizeCatalogEntries(await deps.fetchGifts(source, "ja"));
      } catch (err) {
        console.warn(
          "[gift-catalog] ja fetch failed (keeping existing labelJa):",
          describeError(err)
        );
      }

      const entries = mergeLocalizedCatalog(base, ja);
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
