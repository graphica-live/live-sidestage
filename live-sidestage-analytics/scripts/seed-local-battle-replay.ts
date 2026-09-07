// 再生UIをローカルだけで完成させるためのシード。**本番データを使わずに**
// 4コラボ / 1vs1 / 相手ギフト無し / 再生不可 の4パターンを作る。
//
//   npm run seed:local            # 先に土台(local_test_streamer)を作っておく
//   npm run seed:battle-replay:local
//
// 作るもの(バトル1本あたり):
//   - 参加者ぶんの TiktokRoom / TiktokBattle
//   - ギフト(コンボは saveComboGift() と同じ「各段を差分の別行」で作る)
//   - ギフトから逆算した armies snapshot。**先頭48秒だけスコアを2倍**で書くので、
//     inferOpeningMultiplier が measured を返すのが期待値(逆算のend-to-end確認)
//   - 2:30〜3:00 のボーナスミッション
import { prisma } from "../src/lib/prisma";
import {
  attachReplayData,
  computeBattleSnapshot,
  commitBattleSnapshot,
} from "../src/lib/battle-history-finalize";

const DURATION_MS = 5 * 60 * 1000;
/** 初ギフトボーナスの区間。逆算側の仮定(60秒窓)より短く取る。 */
const OPENING_MS = 48 * 1000;
const OPENING_MULTIPLIER = 2;

type Anchor = {
  hostUserId: string;
  tiktokId: string;
  roomId: string;
};

type SeedGift = {
  anchor: number;
  atMs: number;
  senderUniqueId: string;
  senderNickname: string;
  giftId: number;
  giftName: string;
  /** 連打の総数。2以上なら段ごとに差分行を作る。 */
  repeat: number;
  /** 1回あたりのダイヤ。 */
  diamonds: number;
  multiplierValue?: number;
};

async function ensureRoom(tiktokId: string, hostUserId: string): Promise<Anchor> {
  const room = await prisma.tiktokRoom.upsert({
    where: { tiktokId },
    update: { hostUserId },
    create: { tiktokId, hostUserId },
  });
  return { hostUserId, tiktokId, roomId: room.id };
}

/** コンボは各段を差分行で残す(`saveComboGift()` と同じ形)。 */
async function writeGift(anchor: Anchor, gift: SeedGift, startedAt: Date): Promise<void> {
  const groupId = gift.repeat > 1 ? `seed_${gift.senderUniqueId}_${gift.atMs}` : "0";
  const dayKey = startedAt.toISOString().slice(0, 10);
  for (let step = 1; step <= gift.repeat; step++) {
    // 段ごとに 350ms ずつ遅らせる(コンボのカウントアップが見えるように)
    const receivedAt = new Date(startedAt.getTime() + gift.atMs + (step - 1) * 350);
    await prisma.gift.create({
      data: {
        roomId: anchor.roomId,
        uniqueId: gift.senderUniqueId,
        nickname: gift.senderNickname,
        giftId: gift.giftId,
        giftName: gift.giftName,
        groupId,
        repeatCount: 1,
        diamondCount: gift.diamonds,
        totalDiamonds: gift.diamonds,
        multiplierType: gift.multiplierValue === undefined ? 0 : 1,
        multiplierValue: gift.multiplierValue ?? 0,
        receivedAt,
        dayKey,
      },
    });
  }
}

/** ギフトからスコアを積み上げて armies snapshot を書く。先頭48秒だけ2倍。 */
async function writeArmies(
  selfRoomId: string,
  battleId: string,
  anchors: Anchor[],
  gifts: SeedGift[],
  startedAt: Date
): Promise<void> {
  const totals = anchors.map(() => 0);
  const sorted = [...gifts].sort((a, b) => a.atMs - b.atMs);
  const rows: { anchorId: string; occurredAt: Date; score: string }[] = [];

  for (const gift of sorted) {
    const gain = gift.diamonds * gift.repeat * (gift.atMs < OPENING_MS ? OPENING_MULTIPLIER : 1);
    totals[gift.anchor] += gain;
    // 1イベントで全anchor分が同じ occurredAt で届く(実データと同じ形)
    const occurredAt = new Date(startedAt.getTime() + gift.atMs + gift.repeat * 350);
    anchors.forEach((anchor, index) => {
      rows.push({ anchorId: anchor.hostUserId, occurredAt, score: String(totals[index]) });
    });
  }

  await prisma.tiktokBattleArmiesSnapshot.createMany({
    data: rows.map((row) => ({ roomId: selfRoomId, battleId, ...row })),
  });
}

async function seedBattle(options: {
  label: string;
  anchors: Anchor[];
  gifts: SeedGift[];
  startedAt: Date;
  /** false なら armies を書かない(再生不可バトル)。 */
  withScorePoints: boolean;
  withBonusMission: boolean;
}): Promise<string> {
  const { anchors, gifts, startedAt } = options;
  const endedAt = new Date(startedAt.getTime() + DURATION_MS);
  const battleId = `seed-replay-${options.label}-${startedAt.getTime()}`;

  const totals = anchors.map(() => 0);
  for (const gift of gifts) {
    totals[gift.anchor] += gift.diamonds * gift.repeat * (gift.atMs < OPENING_MS ? OPENING_MULTIPLIER : 1);
  }
  const hostScores = Object.fromEntries(anchors.map((a, i) => [a.hostUserId, String(totals[i])]));

  for (const anchor of anchors) {
    await prisma.tiktokBattle.create({
      data: {
        roomId: anchor.roomId,
        battleId,
        action: 5,
        startedAt,
        startedAtEstimated: false,
        endedAt,
        durationSec: DURATION_MS / 1000,
        hostUserIds: anchors.map((a) => a.hostUserId),
        hostScores,
      },
    });
  }

  for (const gift of gifts) {
    await writeGift(anchors[gift.anchor]!, gift, startedAt);
  }

  if (options.withScorePoints) {
    await writeArmies(anchors[0]!.roomId, battleId, anchors, gifts, startedAt);
  }

  if (options.withBonusMission) {
    await prisma.tiktokBattleBonusMission.create({
      data: {
        roomId: anchors[0]!.roomId,
        battleId,
        targetType: 1,
        progressTarget: 3,
        rewardMultiple: 3,
        startedAt: new Date(startedAt.getTime() + 150_000),
        settledAt: new Date(startedAt.getTime() + 160_000),
        taskResult: 2,
        rewardStartedAt: new Date(startedAt.getTime() + 150_000),
        rewardEndedAt: new Date(startedAt.getTime() + 180_000),
        rewardSum: 12_000,
      },
    });
  }

  const finalizeAt = new Date(endedAt.getTime() + 60_000);
  const snapshot = await computeBattleSnapshot(anchors[0]!.roomId, battleId, finalizeAt);
  if (!snapshot) throw new Error(`computeBattleSnapshot が null: ${options.label}`);
  await commitBattleSnapshot(snapshot, finalizeAt);
  await attachReplayData(
    (await prisma.battleHistory.findFirstOrThrow({
      where: { roomId: anchors[0]!.roomId, battleId },
      select: { id: true },
    })).id
  );
  return battleId;
}

const GIFT_CATALOG = [
  { giftId: 5655, giftName: "Rose", diamonds: 1 },
  { giftId: 5827, giftName: "Heart Me", diamonds: 10 },
  { giftId: 6427, giftName: "Lion", diamonds: 2999 },
  { giftId: 5269, giftName: "Galaxy", diamonds: 1000 },
  { giftId: 6093, giftName: "Universe", diamonds: 34999 },
];

const FANS = [
  { uniqueId: "seed_fan_a", nickname: "たちら🌿" },
  { uniqueId: "seed_fan_b", nickname: "ドラ" },
  { uniqueId: "seed_fan_c", nickname: "みかん" },
  { uniqueId: "seed_fan_d", nickname: "ゆう" },
  { uniqueId: "seed_fan_e", nickname: "けん" },
  { uniqueId: "seed_fan_f", nickname: "さくら" },
];

/** 決定的な擬似乱数(seed固定)。実行のたびに絵が変わると照合できない。 */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function buildGifts(anchorCount: number, count: number, seed: number): SeedGift[] {
  const random = makeRandom(seed);
  const gifts: SeedGift[] = [];
  for (let i = 0; i < count; i++) {
    const catalog = GIFT_CATALOG[Math.floor(random() * GIFT_CATALOG.length)]!;
    const fan = FANS[Math.floor(random() * FANS.length)]!;
    const repeat = random() < 0.3 ? 1 + Math.floor(random() * 12) : 1;
    gifts.push({
      anchor: Math.floor(random() * anchorCount),
      atMs: Math.floor(random() * (DURATION_MS - 10_000)) + 5_000,
      senderUniqueId: fan.uniqueId,
      senderNickname: fan.nickname,
      giftId: catalog.giftId,
      giftName: catalog.giftName,
      repeat,
      diamonds: catalog.diamonds,
      multiplierValue: random() < 0.08 ? (random() < 0.5 ? 5 : 6) : undefined,
    });
  }
  // 逆算のクリーン候補になるよう、先頭に「単独・高額・倍率刻印なし」を1件置く
  gifts.push({
    anchor: 0,
    atMs: 8_000,
    senderUniqueId: FANS[0]!.uniqueId,
    senderNickname: FANS[0]!.nickname,
    giftId: 5269,
    giftName: "Galaxy",
    repeat: 1,
    diamonds: 1000,
  });
  return gifts.sort((a, b) => a.atMs - b.atMs);
}

async function main() {
  const selfRoom = await prisma.tiktokRoom.findFirst({ where: { tiktokId: "local_test_streamer" } });
  if (!selfRoom) throw new Error("local_test_streamer room not found. run seed:local first");
  const selfHostUserId = selfRoom.hostUserId ?? "seed_self_host_user";
  if (!selfRoom.hostUserId) {
    await prisma.tiktokRoom.update({ where: { id: selfRoom.id }, data: { hostUserId: selfHostUserId } });
  }
  const self: Anchor = { hostUserId: selfHostUserId, tiktokId: selfRoom.tiktokId, roomId: selfRoom.id };

  const rivals = await Promise.all([
    ensureRoom("local_replay_rival_1", "seed_replay_rival_host_1"),
    ensureRoom("local_replay_rival_2", "seed_replay_rival_host_2"),
    ensureRoom("local_replay_rival_3", "seed_replay_rival_host_3"),
  ]);

  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);

  const quad = await seedBattle({
    label: "quad",
    anchors: [self, ...rivals],
    gifts: buildGifts(4, 120, 20260907),
    startedAt: at(120),
    withScorePoints: true,
    withBonusMission: true,
  });

  const duo = await seedBattle({
    label: "duo",
    anchors: [self, rivals[0]!],
    gifts: buildGifts(2, 90, 777),
    startedAt: at(240),
    withScorePoints: true,
    withBonusMission: false,
  });

  // 相手陣営のギフト明細が無いバトル(全体の約75%がこれ)。再生は可能で注記だけ出る
  const oneSide = await seedBattle({
    label: "oneside",
    anchors: [self, rivals[1]!],
    gifts: buildGifts(1, 60, 31337),
    startedAt: at(360),
    withScorePoints: true,
    withBonusMission: false,
  });

  // armies を書かない = スコア点0件。再生ボタンが無効になるバトル
  const notReplayable = await seedBattle({
    label: "noscore",
    anchors: [self, rivals[2]!],
    gifts: buildGifts(2, 20, 4242),
    startedAt: at(480),
    withScorePoints: false,
    withBonusMission: false,
  });

  console.log(JSON.stringify({ quad, duo, oneSide, notReplayable }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
