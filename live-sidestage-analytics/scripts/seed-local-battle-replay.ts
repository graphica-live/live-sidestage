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
  hostTiktokUid: string;
  tiktokHandle: string;
  roomId: string;
};

type SeedGift = {
  anchor: number;
  atMs: number;
  senderTiktokHandle: string;
  senderNickname: string;
  giftId: number;
  giftName: string;
  /** 連打の総数。2以上なら段ごとに差分行を作る。 */
  repeat: number;
  /** 1回あたりのダイヤ。 */
  diamonds: number;
  multiplierValue?: number;
};

async function ensureRoom(tiktokHandle: string, hostTiktokUid: string): Promise<Anchor> {
  await prisma.tikTokUser.upsert({
    where: { tiktokUid: hostTiktokUid },
    update: { tiktokHandle },
    create: { tiktokUid: hostTiktokUid, tiktokHandle, nickname: tiktokHandle },
  });
  const room = await prisma.tiktokRoom.upsert({
    where: { hostTiktokUid },
    update: { tiktokHandle },
    create: { tiktokHandle, hostTiktokUid },
  });
  return { hostTiktokUid, tiktokHandle, roomId: room.id };
}

// Gift は表示列を持たないので、送信者ハンドルごとに安定した tiktokUid を割り当てて
// TikTokUser 側へ表示名を置く(シードの目視確認で名無しが並ばないようにする)。
const senderUidByHandle = new Map<string, string>();
function senderTiktokUidFor(tiktokHandle: string): string {
  const known = senderUidByHandle.get(tiktokHandle);
  if (known) return known;
  const uid = `70000000000000005${String(senderUidByHandle.size + 1).padStart(2, "0")}`;
  senderUidByHandle.set(tiktokHandle, uid);
  return uid;
}

/** コンボは各段を差分行で残す(`saveComboGift()` と同じ形)。 */
async function writeGift(anchor: Anchor, gift: SeedGift, startedAt: Date): Promise<void> {
  const groupId = gift.repeat > 1 ? `seed_${gift.senderTiktokHandle}_${gift.atMs}` : "0";
  const dayKey = startedAt.toISOString().slice(0, 10);
  const senderTiktokUid = senderTiktokUidFor(gift.senderTiktokHandle);
  await prisma.tikTokUser.upsert({
    where: { tiktokUid: senderTiktokUid },
    update: { tiktokHandle: gift.senderTiktokHandle, nickname: gift.senderNickname },
    create: {
      tiktokUid: senderTiktokUid,
      tiktokHandle: gift.senderTiktokHandle,
      nickname: gift.senderNickname,
    },
  });
  for (let step = 1; step <= gift.repeat; step++) {
    // 段ごとに 350ms ずつ遅らせる(コンボのカウントアップが見えるように)
    const receivedAt = new Date(startedAt.getTime() + gift.atMs + (step - 1) * 350);
    await prisma.gift.create({
      data: {
        roomId: anchor.roomId,
        tiktokUid: senderTiktokUid,
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
  const rows: { tiktokUid: string; occurredAt: Date; score: string }[] = [];

  for (const gift of sorted) {
    const gain = gift.diamonds * gift.repeat * (gift.atMs < OPENING_MS ? OPENING_MULTIPLIER : 1);
    totals[gift.anchor] += gain;
    // 1イベントで全anchor分が同じ occurredAt で届く(実データと同じ形)
    const occurredAt = new Date(startedAt.getTime() + gift.atMs + gift.repeat * 350);
    anchors.forEach((anchor, index) => {
      rows.push({ tiktokUid: anchor.hostTiktokUid, occurredAt, score: String(totals[index]) });
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
  const hostScores = Object.fromEntries(anchors.map((a, i) => [a.hostTiktokUid, String(totals[i])]));

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
        hostTiktokUids: anchors.map((a) => a.hostTiktokUid),
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
  { giftId: 5655, giftName: "Rose", diamonds: 1, labelJa: "バラ", color: "#ff4d6d" },
  { giftId: 5827, giftName: "Heart Me", diamonds: 10, labelJa: "ハートミー", color: "#ff8fb1" },
  { giftId: 6427, giftName: "Lion", diamonds: 2999, labelJa: "ライオン", color: "#ffb020" },
  { giftId: 5269, giftName: "Galaxy", diamonds: 1000, labelJa: "ギャラクシー", color: "#7c6bff" },
  { giftId: 6093, giftName: "Universe", diamonds: 34999, labelJa: "ユニバース", color: "#38d0ff" },
];

/**
 * ローカル検証用のギフト画像。本番の `imageUrl` は TikTok の `gift/list/` からしか取れず、
 * ローカルDBには入らない。**画像を持つ経路（カード内サムネ・1万コイン以上の大演出）が
 * ローカルで一度も描画されない**ことになるので、透過PNG相当の SVG を data URI で持たせる。
 */
function seedGiftImage(labelJa: string, color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.4"/>` +
    `</linearGradient></defs>` +
    `<path d="M60 8 108 42 90 112H30L12 42Z" fill="url(#g)" stroke="#ffffff" stroke-opacity="0.75" stroke-width="4"/>` +
    `<text x="60" y="74" font-family="sans-serif" font-size="15" font-weight="700" fill="#0d0f13" text-anchor="middle">${labelJa}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function seedGiftCatalog(): Promise<void> {
  for (const gift of GIFT_CATALOG) {
    const data = {
      name: gift.giftName.trim().toLowerCase(),
      label: gift.giftName,
      labelJa: gift.labelJa,
      diamondCount: gift.diamonds,
      imageUrl: seedGiftImage(gift.labelJa, gift.color),
      fetchedAt: new Date(),
    };
    await prisma.tiktokGiftCatalog.upsert({
      where: { giftId: gift.giftId },
      create: { giftId: gift.giftId, ...data },
      update: data,
    });
  }
}

const FANS = [
  { tiktokHandle: "seed_fan_a", nickname: "たちら🌿" },
  { tiktokHandle: "seed_fan_b", nickname: "ドラ" },
  { tiktokHandle: "seed_fan_c", nickname: "みかん" },
  { tiktokHandle: "seed_fan_d", nickname: "ゆう" },
  { tiktokHandle: "seed_fan_e", nickname: "けん" },
  { tiktokHandle: "seed_fan_f", nickname: "さくら" },
];

/** 決定的な擬似乱数(seed固定)。実行のたびに絵が変わると照合できない。 */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * `startMs` を渡すと、その時刻までギフトを一切置かない（自動早送りの見本用に、
 * 長い無風区間を確実に作るバトルを1本用意する）。
 */
function buildGifts(anchorCount: number, count: number, seed: number, startMs = 5_000): SeedGift[] {
  const random = makeRandom(seed);
  const span = Math.max(1, DURATION_MS - 5_000 - startMs);
  const gifts: SeedGift[] = [];
  for (let i = 0; i < count; i++) {
    const catalog = GIFT_CATALOG[Math.floor(random() * GIFT_CATALOG.length)]!;
    const fan = FANS[Math.floor(random() * FANS.length)]!;
    const repeat = random() < 0.3 ? 1 + Math.floor(random() * 12) : 1;
    gifts.push({
      anchor: Math.floor(random() * anchorCount),
      atMs: Math.floor(random() * span) + startMs,
      senderTiktokHandle: fan.tiktokHandle,
      senderNickname: fan.nickname,
      giftId: catalog.giftId,
      giftName: catalog.giftName,
      repeat,
      diamonds: catalog.diamonds,
      multiplierValue: random() < 0.08 ? (random() < 0.5 ? 5 : 6) : undefined,
    });
  }
  // 逆算のクリーン候補になるよう、先頭に「単独・高額・倍率刻印なし」を1件置く。
  // 無風バトルではここも無風の中に入れない
  gifts.push({
    anchor: 0,
    atMs: Math.max(8_000, startMs + 3_000),
    senderTiktokHandle: FANS[0]!.tiktokHandle,
    senderNickname: FANS[0]!.nickname,
    giftId: 5269,
    giftName: "Galaxy",
    repeat: 1,
    diamonds: 1000,
  });
  return gifts.sort((a, b) => a.atMs - b.atMs);
}

async function main() {
  const selfRoom = await prisma.tiktokRoom.findFirst({ where: { tiktokHandle: "local_test_streamer" } });
  if (!selfRoom) throw new Error("local_test_streamer room not found. run seed:local first");
  const selfHostTiktokUid = selfRoom.hostTiktokUid ?? "seed_self_host_user";
  if (!selfRoom.hostTiktokUid) {
    await prisma.tiktokRoom.update({ where: { id: selfRoom.id }, data: { hostTiktokUid: selfHostTiktokUid } });
  }
  const self: Anchor = { hostTiktokUid: selfHostTiktokUid, tiktokHandle: selfRoom.tiktokHandle, roomId: selfRoom.id };

  const rivals = await Promise.all([
    ensureRoom("local_replay_rival_1", "seed_replay_rival_host_1"),
    ensureRoom("local_replay_rival_2", "seed_replay_rival_host_2"),
    ensureRoom("local_replay_rival_3", "seed_replay_rival_host_3"),
  ]);

  await seedGiftCatalog();

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

  // 自動早送りの見本。**開始3分はギフトが1件も無い**ので、無風の入り・抜けがはっきり出る
  const quietDemo = await seedBattle({
    label: "quiet",
    anchors: [self, rivals[0]!],
    gifts: buildGifts(2, 40, 90210, 180_000),
    startedAt: at(60),
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

  console.log(JSON.stringify({ quad, duo, oneSide, quietDemo, notReplayable }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
