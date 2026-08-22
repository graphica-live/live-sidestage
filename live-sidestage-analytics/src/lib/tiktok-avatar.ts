// 配信者アイコンの取得をまとめる層。
//
// **URL を DB へ保存しない。** TikTok の avatar URL は署名付きで `x-expires` がおよそ47時間、
// つまり値そのものが賞味期限つきのキャッシュでしかない。永続化すると
//
//   - 期限切れの URL が残り、終わったイベントのトーナメント表で画像が壊れる
//   - 取り直しの成否・間隔・排他をアプリ側で管理しなければならない
//   - ロールバック時に列を消す/残すの判断が要る
//
// が全部ついてくる。閲覧の契機で引いてプロセス内に持つだけにすれば、いずれも起きない。
// 引き当ては `/api/public/avatar/[participantId]` からのみ行う(src/app/api/public/avatar/)。
//
// キャッシュはプロセスメモリなので、再起動やレプリカ追加で失われる。失われても
// 次のアクセスで引き直すだけなので実害はない。

import { fetchTiktokProfile, type TiktokProfileResult } from "./tiktok-profile";

/** 取得できた URL を持ち回す期間。署名の有効期限(約47時間)より十分短くする。 */
const OK_TTL_MS = 6 * 60 * 60 * 1000;

/** 引けなかったときに再試行を待つ時間。理由ごとに変える。 */
const MISS_TTL_MS: Record<Exclude<TiktokProfileResult, { ok: true }>["reason"], number> = {
  // ハンドルが存在しない。当分変わらないので長めに寝かせる。
  NOT_FOUND: 6 * 60 * 60 * 1000,
  // 絞られている。すぐ叩き直しても悪化するだけ。
  RATE_LIMITED: 15 * 60 * 1000,
  // 一時的な失敗。短めに再試行する。
  ERROR: 5 * 60 * 1000,
};

/** 同時に投げる外向きリクエストの上限。64人のトーナメント表でも TikTok を叩き潰さない。 */
const MAX_CONCURRENCY = 4;

/** 保持する配信者数の上限。超えたら古い順に捨てる。 */
const MAX_ENTRIES = 2000;

/** 連続でこの回数失敗したら、しばらく外向きの取得を止める。 */
const CIRCUIT_THRESHOLD = 8;
const CIRCUIT_OPEN_MS = 5 * 60 * 1000;

type Entry = { url: string | null; expiresAt: number };

export type AvatarCache = {
  /** アイコンの URL。取れなければ null。**例外は投げない。** */
  get(tiktokId: string): Promise<string | null>;
  /** テスト用。 */
  size(): number;
};

export function createAvatarCache(options?: {
  fetchProfile?: (tiktokId: string) => Promise<TiktokProfileResult>;
  now?: () => number;
  maxConcurrency?: number;
  maxEntries?: number;
}): AvatarCache {
  const fetchProfile = options?.fetchProfile ?? fetchTiktokProfile;
  const now = options?.now ?? Date.now;
  const maxConcurrency = options?.maxConcurrency ?? MAX_CONCURRENCY;
  const maxEntries = options?.maxEntries ?? MAX_ENTRIES;

  const entries = new Map<string, Entry>();
  /** 同じ配信者への同時リクエストを1本にまとめる。 */
  const inFlight = new Map<string, Promise<string | null>>();

  let running = 0;
  const waiting: (() => void)[] = [];

  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;

  async function withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (running >= maxConcurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    running++;
    try {
      return await task();
    } finally {
      running--;
      waiting.shift()?.();
    }
  }

  function remember(tiktokId: string, url: string | null, ttlMs: number): void {
    // 期限切れを掃除してから入れる。それでも溢れるなら挿入順(古い順)に捨てる。
    const t = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= t) entries.delete(key);
    }
    entries.delete(tiktokId);
    entries.set(tiktokId, { url, expiresAt: t + ttlMs });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  }

  async function load(tiktokId: string): Promise<string | null> {
    const result = await withSlot(() => fetchProfile(tiktokId));

    if (result.ok) {
      consecutiveFailures = 0;
      remember(tiktokId, result.profile.avatarUrl, OK_TTL_MS);
      return result.profile.avatarUrl;
    }

    // 存在しないハンドルは「TikTok が落ちている」ではないので、ブレーカーには数えない。
    if (result.reason !== "NOT_FOUND") {
      consecutiveFailures++;
      if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
        circuitOpenUntil = now() + CIRCUIT_OPEN_MS;
        consecutiveFailures = 0;
      }
    } else {
      consecutiveFailures = 0;
    }

    remember(tiktokId, null, MISS_TTL_MS[result.reason]);
    return null;
  }

  return {
    async get(tiktokId: string): Promise<string | null> {
      if (process.env.TIKTOK_AVATAR_DISABLED === "1") return null;
      if (tiktokId.length === 0) return null;

      const cached = entries.get(tiktokId);
      if (cached && cached.expiresAt > now()) return cached.url;

      // ブレーカーが開いている間は外へ出さない(キャッシュにも入れない — 復帰後すぐ引けるように)。
      if (now() < circuitOpenUntil) return null;

      const pending = inFlight.get(tiktokId);
      if (pending) return pending;

      const promise = load(tiktokId)
        .catch(() => null)
        .finally(() => {
          inFlight.delete(tiktokId);
        });
      inFlight.set(tiktokId, promise);
      return promise;
    },

    size() {
      return entries.size;
    },
  };
}

// Next.js の dev サーバーはモジュールを再評価するので、globalThis に置いて使い回す
// (src/lib/prisma.ts と同じ理由)。
const globalForAvatar = globalThis as unknown as { __avatarCache?: AvatarCache };

export const avatarCache: AvatarCache = globalForAvatar.__avatarCache ?? createAvatarCache();

if (process.env.NODE_ENV !== "production") globalForAvatar.__avatarCache = avatarCache;
