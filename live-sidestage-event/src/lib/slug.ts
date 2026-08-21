// 公開URL(/e/{slug})に使う slug の生成。
// 日本語タイトルは英数字が残らないことが多いので、必ずランダムな suffix を付けて一意性を担保する。

const SLUG_BASE_MAX = 32;
const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SUFFIX_LENGTH = 6;

// タイトルから slug の前半部分を作る。英数字とハイフンだけを残す。
export function slugifyTitle(title: string): string {
  const base = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/g, "");
  return base;
}

export function randomSuffix(rand: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    out += SUFFIX_ALPHABET[Math.floor(rand() * SUFFIX_ALPHABET.length)];
  }
  return out;
}

// 衝突は呼び出し側が unique 制約で検知して再試行する。
export function buildEventSlug(title: string, rand: () => number = Math.random): string {
  const base = slugifyTitle(title);
  const suffix = randomSuffix(rand);
  return base ? `${base}-${suffix}` : `e-${suffix}`;
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,63}$/.test(slug ?? "");
}
