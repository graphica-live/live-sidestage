/// 超簡易な in-memory レート制限(単一プロセス・単一インスタンス前提)。
///
/// Redis等の永続ストアは使わない。Railwayのwebが複数インスタンスへスケールしたり
/// 再デプロイされたりするとカウントは共有・保持されないため「絶対に破られない」対策
/// ではないが、総当たりの実行速度を落とす目的には今の利用規模で十分。
/// 利用者が増えて分散インスタンスが要る規模になったら置き換えを検討する。
///
/// 実装は src/app/api/public/events/[slug]/bracket/[matchId]/route.ts の
/// isRateLimited() と同じ形(エントリ数上限つきMap)に揃えてある。

const MAX_ENTRIES = 5_000;

interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

export function isRateLimited(key: string, opts: { max: number; windowMs: number }): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    if (buckets.size > MAX_ENTRIES) {
      const oldest = buckets.keys().next();
      if (!oldest.done) buckets.delete(oldest.value);
    }
    return false;
  }
  if (entry.count >= opts.max) return true;
  entry.count += 1;
  return false;
}

/// ログイン成功時に呼び、正当な利用者が誤入力を重ねた後に成功しても
/// 以後しばらく制限され続けないようにする。
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
