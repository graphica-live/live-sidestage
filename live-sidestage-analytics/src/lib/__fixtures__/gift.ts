// テスト用の共通ファクトリ。識別キーが tiktokHandle から tiktokUid へ移った 2026-09 の
// リファクタリングで、Gift 系の行を直接組み立てているテストが 18 ファイルあった。
// 同じ変更で全部を個別に直す作業が二度と起きないよう、ここに集約する。
//
// **表示名(tiktokHandle / nickname)は Gift には無い。** 生観測系の行は tiktokUid だけを持ち、
// 表示は TikTokUser から順引きする。テストで表示名が要るときは makeTikTokUser() を併用する。

import type { Prisma } from "@prisma/client";

/** seed から決定的な tiktokUid(数値文字列)を作る。normalizeTikTokUserId() の /^\d{1,32}$/ を満たす。 */
export function makeTiktokUid(seed: number | string): string {
  const n =
    typeof seed === "number"
      ? BigInt(Math.abs(Math.trunc(seed)))
      : hashSeed(seed);
  return `7${(n % 1_000_000_000_000_000_000n).toString().padStart(18, "0")}`;
}

// FNV-1a 64bit。32bit ハッシュ(h * 31 + c | 0)だと生成値が 2^31 未満へ固まり、
// integration テスト全体で数百件の TiktokRoom を作ると hostTiktokUid の @unique 衝突が
// 単独実行では再現しない flaky として出る(2026-09-09 実測)。手書きの固定 uid
// (7000000000000000901 等)とも同じ帯へ落ちていた。
function hashSeed(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

export type ListenerIdentity = {
  tiktokUid: string;
  tiktokHandle: string;
  nickname: string;
};

/** 同じ seed からは常に同じ組を返す。改名を跨ぐケースは tiktokHandle だけ差し替えて使う。 */
export function makeListenerIdentity(seed: number | string): ListenerIdentity {
  const key = typeof seed === "number" ? `listener_${seed}` : seed;
  return {
    tiktokUid: makeTiktokUid(key),
    tiktokHandle: key,
    nickname: `${key} nickname`,
  };
}

export function makeTikTokUser(
  seed: number | string,
  overrides: Partial<Prisma.TikTokUserUncheckedCreateInput> = {}
): Prisma.TikTokUserUncheckedCreateInput {
  const identity = makeListenerIdentity(seed);
  return {
    tiktokUid: identity.tiktokUid,
    tiktokHandle: identity.tiktokHandle,
    nickname: identity.nickname,
    ...overrides,
  };
}

export type MakeGiftRowInput = Partial<Prisma.GiftUncheckedCreateInput> & {
  roomId: string;
};

/** Gift 1行。dayKey は receivedAt から埋めないので、日付境界を試すテストは明示的に渡す。 */
export function makeGiftRow(input: MakeGiftRowInput): Prisma.GiftUncheckedCreateInput {
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date("2026-09-01T12:00:00Z");
  return {
    tiktokUid: input.tiktokUid ?? makeTiktokUid("listener_1"),
    giftId: input.giftId ?? 1,
    giftName: input.giftName ?? "Rose",
    repeatCount: input.repeatCount ?? 1,
    diamondCount: input.diamondCount ?? 1,
    totalDiamonds: input.totalDiamonds ?? 1,
    ...input,
    dayKey: input.dayKey ?? jstDayKeyOf(receivedAt),
    receivedAt,
  };
}

export function makeRollupStatRow(
  input: Partial<Prisma.GiftDailyListenerStatUncheckedCreateInput> & { roomId: string; dayKey: string }
): Prisma.GiftDailyListenerStatUncheckedCreateInput {
  const at = input.firstReceivedAt ? new Date(input.firstReceivedAt) : new Date(`${input.dayKey}T12:00:00Z`);
  return {
    tiktokUid: input.tiktokUid ?? makeTiktokUid("listener_1"),
    rowCount: input.rowCount ?? 1,
    giftCount: input.giftCount ?? 1,
    totalDiamonds: input.totalDiamonds ?? 1,
    ...input,
    firstReceivedAt: at,
    lastReceivedAt: input.lastReceivedAt ?? at,
  };
}

function jstDayKeyOf(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}
