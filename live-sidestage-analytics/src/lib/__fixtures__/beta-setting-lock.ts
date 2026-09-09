import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * `analyticsBetaEnabled` 等の β フラグは AppSetting の**単一行**で、integration テストの
 * ファイルは別プロセスで並列実行される。片方が true にしている窓へ「β 無効前提」の
 * テストが入る(逆も同じ)ため、β を読む/書くテストはこのロックで直列化する。
 *
 * setSetting のタイミングを工夫するだけでは窓が消えないことを実測済み(2026-09-09)。
 * DB の advisory lock は Prisma のコネクションプールでセッションが変わると解放できず、
 * HTTP 呼び出しを跨いで保持できないので、プロセス間で効くディレクトリロックにする。
 *
 * 保護対象は analytics 領域の β を読む/書く**全ファイル**(battles / gift-history /
 * gifts/breakdown / ranking / me)。1つでも漏れると窓が復活するので、増やすときは
 * このロックを使うこと。
 */
const LOCK_DIR = join(tmpdir(), "live-analytics-itest-beta-setting.lock");
const TOKEN_FILE = join(LOCK_DIR, "owner");

/** 取得を諦めるまで。テスト1本の実行時間より十分長く、vitest のタイムアウトより短く取る。 */
const ACQUIRE_TIMEOUT_MS = 20_000;

/**
 * heartbeat が STALE_MS 途絶えたら、保持プロセスが異常終了したものとみなして奪う。
 * 正常保持中でも `mkdirSync` 直後は heartbeat が回っていないため、mtime は取得直後に
 * 即座に更新しておく(下の acquire 内)。
 */
const STALE_MS = 15_000;
const HEARTBEAT_MS = 3_000;

function touch(): void {
  const now = new Date();
  try {
    utimesSync(LOCK_DIR, now, now);
  } catch {
    // ディレクトリが既に無い(削除と競合しただけ)。次の heartbeat に任せる。
  }
}

/** 自分がロックを取れたら token を書いて true。既に他者が握っていれば false(stale なら回収を試みる)。 */
function tryAcquire(token: string): boolean {
  try {
    mkdirSync(LOCK_DIR);
    writeFileSync(TOKEN_FILE, token);
    touch();
    return true;
  } catch {
    try {
      if (Date.now() - statSync(LOCK_DIR).mtimeMs > STALE_MS) {
        // heartbeat が止まっている = 保持プロセスが死んでいる。奪う。
        // 正常保持中のロックは touch() で mtime が更新され続けるため、ここには来ない。
        rmSync(LOCK_DIR, { recursive: true, force: true });
      }
    } catch {
      // 別ワーカーが同時に回収した。次の周回で取り直す。
    }
    return false;
  }
}

/** 自分の token が今も所有者かを確認する。既に横取りされていれば false。 */
function ownsLock(token: string): boolean {
  try {
    return readFileSync(TOKEN_FILE, "utf8") === token;
  } catch {
    return false;
  }
}

/** 自分の token のときだけ削除する。横取りされた後の release で他人のロックを壊さないため。 */
function releaseIfOwned(token: string): void {
  if (!ownsLock(token)) return;
  try {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  } catch {
    // 既に無い。
  }
}

async function acquire(token: string): Promise<() => void> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  while (!tryAcquire(token)) {
    if (Date.now() > deadline) {
      throw new Error(`β 設定ロックを ${ACQUIRE_TIMEOUT_MS}ms 取得できなかった: ${LOCK_DIR}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const heartbeat = setInterval(touch, HEARTBEAT_MS);
  // Node のプロセス終了をこのタイマーだけで止めない(vitest のワーカー終了を妨げない)。
  heartbeat.unref?.();
  return () => clearInterval(heartbeat);
}

/** 区間を囲んで使う。`fn` の解決・拒否いずれでもロックを解放する。 */
export async function withBetaSettingLock<T>(fn: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const stopHeartbeat = await acquire(token);
  try {
    return await fn();
  } finally {
    stopHeartbeat();
    releaseIfOwned(token);
  }
}

export interface HeldBetaSettingLock {
  /** ロックを取得できたら解決し、取得に失敗したら拒否する。`beforeAll` で await する。 */
  readonly acquired: Promise<void>;
  /** 解放し、ロックディレクトリの削除完了まで待つ。`afterAll` で await する。 */
  release(): Promise<void>;
}

/**
 * ファイル全体でロックを保持したいとき用(`beforeAll` 〜 `afterAll`)。
 *
 * 取得を待たずに戻るので、モジュール評価時に呼んで `beforeAll` で `acquired` を待つ。
 * 取得失敗は `acquired` の拒否として `beforeAll` へ伝わる(握り潰して無限待ちにしない)。
 */
export function acquireBetaSettingLock(): HeldBetaSettingLock {
  const token = randomUUID();

  let signalRelease!: () => void;
  const releaseRequested = new Promise<void>((resolve) => {
    signalRelease = resolve;
  });

  let signalAcquired!: () => void;
  let signalFailed!: (reason: unknown) => void;
  const acquired = new Promise<void>((resolve, reject) => {
    signalAcquired = resolve;
    signalFailed = reject;
  });

  const finished = (async () => {
    let stopHeartbeat: (() => void) | undefined;
    try {
      stopHeartbeat = await acquire(token);
    } catch (err) {
      signalFailed(err);
      throw err;
    }
    signalAcquired();
    try {
      await releaseRequested;
    } finally {
      stopHeartbeat();
      releaseIfOwned(token);
    }
  })();

  return {
    acquired,
    async release() {
      signalRelease();
      // 取得失敗は acquired 側で報告済み。ここで二重に投げない。
      await finished.catch(() => {});
    },
  };
}
