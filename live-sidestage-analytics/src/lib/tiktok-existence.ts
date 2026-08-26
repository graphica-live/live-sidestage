// TikTok アカウントの実在確認に、呼び出しの間引きを被せる層。
//
// イベントの参加者登録(`src/event/participants.ts`)から使う。**主催者の操作に同期して
// 外へ出る唯一の経路**なので、`tiktok-avatar.ts` と同じ守り方をしておく:
// キャッシュ・同時要求の集約・同時実行上限・サーキットブレーカ。
//
// `fetchTiktokProfile()` はプロキシなしの単一データセンターIPで、avatar キャッシュ(閲覧契機)・
// hostUserId 補完(event-worker)・room cleanup(日次)と**同じ枠を共用している**。
// ここが撃ちすぎると、そちらまで巻き添えでレート制限に入る。
//
// **判定できなかったとき(`UNVERIFIED`)は登録を通す(fail-open)。** 実在確認は打ち間違いの
// 救済であって参加資格の審査ではない。TikTok 側の障害でイベント運営が止まるほうが被害が大きい。

import { type AccountExistence, type AccountExistenceCheck, checkAccountExistence } from "./tiktok-profile";

/** 主催者を待たせる上限。fail-open なので、粘るより早く諦めるほうがよい。 */
const TIMEOUT_MS = 3_000;

/** 実在を確認できた結果を持ち回す時間。 */
const EXISTS_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 「いない」を持ち回す時間。**短くする。**
 * 作りたてのアカウントを登録しようとしている主催者を、長時間ブロックしないため。
 */
const MISSING_TTL_MS = 5 * 60 * 1000;

/**
 * 同時に投げる外向きリクエストの上限。
 *
 * 枠が空くのを **`SLOT_WAIT_MS` だけ待つ**。待たずに諦めると、並行 POST を投げるだけで
 * 確認を素通しできてしまう(UI は1件ずつでも API は並行に叩ける)。
 * それでも空かなければ `UNVERIFIED` で通す — 主催者を無制限に待たせない。
 */
const MAX_CONCURRENCY = 2;

/** 枠が空くのを待つ上限。合計の待ち時間は SLOT_WAIT_MS + TIMEOUT_MS を超えない。 */
const SLOT_WAIT_MS = 1_500;

/** 保持するハンドル数の上限。超えたら古い順に捨てる。 */
const MAX_ENTRIES = 2000;

/** 連続でこの回数「判定できなかった」ら、しばらく外向きの取得を止める。 */
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 5 * 60 * 1000;

/**
 * 実在確認そのものを止める避難口。
 *
 * TikTok 側の仕様変更で実在アカウントまで `MISSING` になったとき、コードを直さずに
 * 確認を外せるようにしておく(前例: `TIKTOK_AVATAR_DISABLED`)。
 * 止めても登録はできる — 確認を挟まなくなるだけ。
 */
export function isExistenceCheckDisabled(): boolean {
  return process.env.EVENT_PARTICIPANT_EXISTENCE_CHECK === "0";
}

type Entry = { verdict: AccountExistence; nickname: string | null; expiresAt: number };

export type ExistenceChecker = {
  /** アカウントが実在するか、取れればニックネームも。**例外は投げない。** */
  check(tiktokId: string): Promise<AccountExistenceCheck>;
  /** テスト用。キャッシュしている件数。 */
  size(): number;
};

export function createExistenceChecker(options?: {
  fetchExistence?: (
    tiktokId: string,
    opts: { timeoutMs: number }
  ) => Promise<AccountExistenceCheck>;
  now?: () => number;
  maxConcurrency?: number;
  maxEntries?: number;
  timeoutMs?: number;
  slotWaitMs?: number;
}): ExistenceChecker {
  const fetchExistence = options?.fetchExistence ?? checkAccountExistence;
  const now = options?.now ?? Date.now;
  const maxConcurrency = options?.maxConcurrency ?? MAX_CONCURRENCY;
  const maxEntries = options?.maxEntries ?? MAX_ENTRIES;
  const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;
  const slotWaitMs = options?.slotWaitMs ?? SLOT_WAIT_MS;

  const entries = new Map<string, Entry>();
  /** 同じハンドルへの同時要求を1本にまとめる。同時実行の枠も1つしか使わない。 */
  const inFlight = new Map<string, Promise<AccountExistenceCheck>>();

  let running = 0;
  let consecutiveUnverified = 0;
  let circuitOpenUntil = 0;

  /** 枠待ちの行列。先頭から順に受け渡す。 */
  const waiters: { grant: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  /** 枠を取る。取れたら true。`slotWaitMs` 待っても空かなければ false。 */
  function acquireSlot(): Promise<boolean> {
    if (running < maxConcurrency) {
      running++;
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const entry = {
        grant: resolve,
        timer: setTimeout(() => {
          const index = waiters.indexOf(entry);
          if (index >= 0) waiters.splice(index, 1);
          resolve(false);
        }, slotWaitMs),
      };
      // 待ちタイマーでプロセスを起こし続けない。
      (entry.timer as { unref?: () => void }).unref?.();
      waiters.push(entry);
    });
  }

  /** 枠を返す。待っている人がいればそのまま渡す(running は動かさない)。 */
  function releaseSlot(): void {
    const next = waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      next.grant(true);
      return;
    }
    running--;
  }

  function remember(tiktokId: string, verdict: AccountExistence, nickname: string | null): void {
    // 判定不能は覚えない。次の登録では引き直させる(状況が変わりうるため)。
    if (verdict === "UNVERIFIED") return;

    const t = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= t) entries.delete(key);
    }
    entries.delete(tiktokId);
    entries.set(tiktokId, {
      verdict,
      // MISSING に nickname は無いが、念のため EXISTS 以外では持ち回らない。
      nickname: verdict === "EXISTS" ? nickname : null,
      expiresAt: t + (verdict === "EXISTS" ? EXISTS_TTL_MS : MISSING_TTL_MS),
    });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  }

  async function load(tiktokId: string): Promise<AccountExistenceCheck> {
    // 枠が空かないまま待ち時間を使い切ったら、確認を諦めて通す(fail-open)。
    if (!(await acquireSlot())) return { verdict: "UNVERIFIED", nickname: null };
    try {
      const result = await fetchExistence(tiktokId, { timeoutMs });

      if (result.verdict === "UNVERIFIED") {
        consecutiveUnverified++;
        if (consecutiveUnverified >= CIRCUIT_THRESHOLD) {
          circuitOpenUntil = now() + CIRCUIT_OPEN_MS;
          consecutiveUnverified = 0;
        }
      } else {
        // 「いない」は TikTok が正常に答えた結果なので、障害としては数えない。
        consecutiveUnverified = 0;
      }

      remember(tiktokId, result.verdict, result.nickname);
      return result;
    } finally {
      releaseSlot();
    }
  }

  return {
    async check(tiktokId: string): Promise<AccountExistenceCheck> {
      if (tiktokId.length === 0) return { verdict: "UNVERIFIED", nickname: null };

      const cached = entries.get(tiktokId);
      if (cached && cached.expiresAt > now()) {
        return { verdict: cached.verdict, nickname: cached.nickname };
      }

      // 同じハンドルの取得が既に走っているなら相乗りする(枠も1つで済む)。
      const pending = inFlight.get(tiktokId);
      if (pending) return pending;

      // ブレーカーが開いている間は外へ出さない。
      if (now() < circuitOpenUntil) return { verdict: "UNVERIFIED", nickname: null };

      const promise = load(tiktokId)
        .catch(() => ({ verdict: "UNVERIFIED", nickname: null }) as AccountExistenceCheck)
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
const globalForExistence = globalThis as unknown as { __existenceChecker?: ExistenceChecker };

export const existenceChecker: ExistenceChecker =
  globalForExistence.__existenceChecker ?? createExistenceChecker();

if (process.env.NODE_ENV !== "production") globalForExistence.__existenceChecker = existenceChecker;
