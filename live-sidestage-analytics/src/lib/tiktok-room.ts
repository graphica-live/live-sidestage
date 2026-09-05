import { prisma } from "./prisma";
import { MAX_LEASE_DAYS } from "./room-lease";
import { reviveSuspendedMonitoring } from "./mark-last-active";

// TikTokのユーザー名は大文字小文字を区別しないため、部屋(TiktokRoom)のキーとしては
// 正規化した値を使う。Streamer.tiktokId自体はユーザー入力値のまま表示用に残す。
export function normalizeTiktokId(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

// Streamerの現在のtiktokIdに対応するTiktokRoomを解決し、Streamer.roomIdを更新する。
// deviceId/workerId/proxyKey(tiktok-listener.ts)と同じ「初回アクセス時に解決→永続化→再利用」
// パターン。tiktokIdが変更された場合(再登録)は、指しているroomのtiktokIdが現在の値と
// 食い違うため自己修復的に新しいroomへ付け替える。
export async function resolveRoomForStreamer(streamerId: string): Promise<string> {
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: { tiktokId: true, roomId: true, room: { select: { tiktokId: true } } },
  });
  if (!streamer) {
    throw new Error(`resolveRoomForStreamer: streamer ${streamerId} not found`);
  }

  const normalized = normalizeTiktokId(streamer.tiktokId);

  if (streamer.roomId && streamer.room?.tiktokId === normalized) {
    return streamer.roomId;
  }

  const room = await upsertRoom(normalized);

  // watchedRoomFilter()はもうStreamer有無を見ない(Streamer0人のRoomも低価値クリーンアップの
  // 判定まで監視を続ける情報プール方針)ため、Streamerを新規に紐付けただけではmonitoringSuspended
  // は自動で戻らない。ここで明示的に戻さないと、過去に監視停止されたRoomへ新規登録した
  // ユーザーは、次に markLastActive()(ログイン時)が呼ばれるまでデータが貯まらない。
  await prisma.$transaction([
    prisma.streamer.update({ where: { id: streamerId }, data: { roomId: room.id } }),
    prisma.tiktokRoom.updateMany({
      where: { id: room.id, monitoringSuspended: true },
      data: { monitoringSuspended: false },
    }),
  ]);

  return room.id;
}

// ============================================================================
// イベントによる期限付きの監視要求(TiktokRoom.monitorUntil)
//
// 会員登録(Streamer)のない配信者でも、イベント開催中だけは配信開始を監視する。
// getMyRooms()(tiktok-listener.ts)が `monitoringSuspended: false` か
// `monitorUntil > now` のどちらかを満たす部屋を担当するので、ここで
// monitorUntil を立てれば次のreconcile(最大30秒)で接続が始まる。
//
// もとは live-sidestage-event が叩く内部API(/api/internal/event-room-lease)だったが、
// 同一プロジェクトへ統合したので直接呼ぶ。**外部入力に対する検証と上限はそのまま残す** —
// 主催者の入力がそのまま届く経路であることは変わらないため。
// ============================================================================

// monitorUntilが未来の部屋の総数上限。TikTok接続はプロキシとEuler署名の枠を消費するので、
// イベントからの要求で無制限に増えないようにする。恒常的に足りなくなったらこの値を見直す。
const MAX_ACTIVE_LEASES = 500;

// normalizeTiktokId は正規化しかしないので、部屋を作る前にここで形式を検証する。
// TikTokのユーザー名に使える文字は英数字・アンダースコア・ピリオド。
// tiktok-id-migration.ts の入口ガードでも同じ検証に使うため export する。
export const TIKTOK_ID_PATTERN = /^[a-z0-9._]{1,64}$/;

/** 監視要求が受け付けられなかったとき。status は呼び出し側がHTTPへ写せるように持たせる。 */
export class RoomMonitorError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "RoomMonitorError";
  }
}

export type RoomMonitorLease = {
  roomId: string;
  tiktokId: string;
  /** 実際に設定された期限。他の要求がより長い期限を持っていれば要求値より先になる */
  monitorUntil: Date;
  /** この呼び出しで部屋を新規作成したか(false = 既存部屋の再利用) */
  created: boolean;
};

/**
 * 指定した配信者の部屋を確保し、`monitorUntil` まで配信開始を監視させる。
 *
 * 既存の部屋があれば再利用する(同じ配信者のギフトが別々の部屋に分裂しないように)。
 * 期限は `max(既存, 要求)` で更新する — 別のイベントがより長い期限で確保している
 * 部屋を短くしないため。
 */
export async function ensureRoomForEvent(
  rawTiktokId: string,
  monitorUntil: Date,
  now: Date = new Date()
): Promise<RoomMonitorLease> {
  const tiktokId = normalizeTiktokId(rawTiktokId);
  if (!TIKTOK_ID_PATTERN.test(tiktokId)) {
    throw new RoomMonitorError("TikTok ID の形式が正しくない。", 400);
  }

  if (Number.isNaN(monitorUntil.getTime())) {
    throw new RoomMonitorError("監視期限が不正。", 400);
  }
  if (monitorUntil <= now) {
    throw new RoomMonitorError("監視期限が過去。", 400);
  }
  const maxUntil = new Date(now.getTime() + MAX_LEASE_DAYS * 24 * 60 * 60 * 1000);
  if (monitorUntil > maxUntil) {
    throw new RoomMonitorError(`監視期限は${MAX_LEASE_DAYS}日以内にすること。`, 400);
  }

  const existing = await prisma.tiktokRoom.findUnique({
    where: { tiktokId },
    select: { id: true, monitorUntil: true },
  });

  // 上限は「まだ監視中でない部屋を新たに監視対象にする」ときだけ確認する。
  // 既に監視中の部屋の期限を延ばすだけなら総数は増えない。
  // 同時リクエストで数件超過しうるソフトリミット(接続資源の暴走を止めるのが目的で、
  // 厳密な数え上げが要件ではないため、トランザクションでの直列化はしない)。
  const alreadyMonitored = existing?.monitorUntil != null && existing.monitorUntil > now;
  if (!alreadyMonitored) {
    const activeLeases = await prisma.tiktokRoom.count({
      where: { monitorUntil: { gt: now } },
    });
    if (activeLeases >= MAX_ACTIVE_LEASES) {
      throw new RoomMonitorError(
        `監視できる配信者数の上限(${MAX_ACTIVE_LEASES})に達している。`,
        429
      );
    }
  }

  const granted =
    existing?.monitorUntil && existing.monitorUntil > monitorUntil
      ? existing.monitorUntil
      : monitorUntil;

  if (existing) {
    const room = await prisma.tiktokRoom.update({
      where: { id: existing.id },
      data: { monitorUntil: granted },
      select: { id: true, tiktokId: true, monitorUntil: true },
    });
    return {
      roomId: room.id,
      tiktokId: room.tiktokId,
      monitorUntil: room.monitorUntil ?? granted,
      created: false,
    };
  }

  try {
    const room = await prisma.tiktokRoom.create({
      data: { tiktokId, monitorUntil: granted },
      select: { id: true, tiktokId: true, monitorUntil: true },
    });
    return {
      roomId: room.id,
      tiktokId: room.tiktokId,
      monitorUntil: room.monitorUntil ?? granted,
      created: true,
    };
  } catch (err) {
    // findUnique と create の間に別リクエストが同じ部屋を作った場合。
    // 期限は max(既存, 要求) なので、作った側の期限を尊重しつつ足りなければ伸ばす。
    if ((err as { code?: string })?.code === "P2002") {
      return ensureRoomForEvent(tiktokId, monitorUntil, now);
    }
    throw err;
  }
}

/**
 * 監視要求を解除する。
 *
 * **解除しても即座には切断されない。** `watchedRoomFilter()` は「Streamerの登録有無」を
 * 見なくなり `monitoringSuspended: false` を主条件にしているため、他に監視理由(AgencyWatch・
 * 他イベントのmonitorUntil)が無い部屋でも、tiktok-low-value-cleanup.ts が停止判定するまでは
 * 情報プールとして接続が維持され続ける(情報プール方針)。部屋とギフトは消さない — 後から
 * その部屋を指定した会員登録(Streamer)があっても無くても、監視継続の判断はこのフラグ1本。
 */
export async function releaseRoomMonitor(roomId: string): Promise<number> {
  const updated = await prisma.tiktokRoom.updateMany({
    where: { id: roomId },
    data: { monitorUntil: null },
  });
  return updated.count;
}

// 正規化済みtiktokIdに対応するTiktokRoomを取得/作成する。
// 事務所の監視対象追加(src/lib/agency/)でも同じ部屋を共有するため、ここを唯一の入口にする。
export async function upsertRoom(tiktokId: string): Promise<{ id: string }> {
  try {
    return await prisma.tiktokRoom.upsert({
      where: { tiktokId },
      update: {},
      create: { tiktokId },
      select: { id: true },
    });
  } catch (err) {
    // 同時に2リクエストが同じ新規tiktokIdをupsertしようとした場合のP2002競合を再フェッチで解決する。
    if ((err as { code?: string })?.code === "P2002") {
      const existing = await prisma.tiktokRoom.findUnique({
        where: { tiktokId },
        select: { id: true },
      });
      if (existing) return existing;
    }
    throw err;
  }
}

export type CollabWatchResult = {
  roomId: string;
  tiktokId: string;
  /** この呼び出しで monitoringSuspended: true → false に書き換えたか(= 休止中だった) */
  resumed: boolean;
  /** この呼び出しで TiktokRoom を新規作成したか。呼び出し元は created===true のときだけ
   * 即接続キック(startListener)を検討してよい — false(既存room再利用/再開)で毎回キックすると
   * 同じ相手を検知するたびに再接続してしまう */
  created: boolean;
};

// コラボ経由で新規発見できるroomの上限。ensureRoomForEvent()のMAX_ACTIVE_LEASESと同じ理由
// (TikTok接続はプロキシ・Euler署名APIの枠を消費する有限リソース)に加え、コラボ由来のroomも
// 監視対象になる(=次のreconcileでlinkLayerを購読する)ため、コラボが連鎖するとStreamer登録の
// 意図から離れて無制限に広がりうる(実装後レビューで指摘)。上限は「既に監視中のroom総数」で
// 判定するソフトリミット(同時作成で数件超過しうるが、接続資源の暴走を止めるのが目的で厳密な
// 数え上げは要件ではない)。
const MAX_COLLAB_DISCOVERED_ROOMS = 500;

/**
 * コラボ(linkMic)相手を監視対象へ入れる。tiktok-listener.ts の linkLayer ハンドラから呼ぶ
 * (呼び出し元でStreamer登録済みのroomからの検知に限定済み — 未登録roomからの連鎖発見は
 * 呼び出し元で止めている)。
 *
 * - 未登録(TiktokRoomが無い) → 上限未満なら新規作成する。新規行の monitoringSuspended は既定
 *   false なのでそのまま監視対象になる(resumed: false)。上限に達している場合は作成せず null
 * - 登録済み・監視中(monitoringSuspended: false) → 何もしない(resumed: false)。resolveRoomForStreamer()と
 *   同じく、AgencyWatch/monitorUntilが理由で監視中の場合もここでは関知しない
 *   (watchedRoomFilter()のOR条件のどれか1つでも満たせばよいため)
 * - 登録済み・休止中(monitoringSuspended: true) → false に書き換える(resumed: true)。
 *   NOT_FOUND判定用フィールドもreviveSuspendedMonitoring()が併せてリセットする
 *   (残したままだと復活直後の実在確認で古いstreakを引き継ぎ、誤って早期に再停止しうるため)
 *
 * tiktokId の形式が不正(TIKTOK_ID_PATTERN)な場合は何もせず null を返す — コラボ相手の
 * displayId は TikTok 側の値をそのまま受け取るだけの経路で、主催者入力のような検証は
 * 要らないはずだが、万一空文字・記号混じりが来ても部屋を作らないための最低限のガード。
 *
 * `workerId` は呼び出し元(worker プロセス)自身の WORKER_INDEX。渡された場合、新規作成される
 * 行の workerId をそれで初期化する(= 検知した worker が自ら担当を申告し、次のreconcileを
 * 待たず即座に自分で startListener できるようにする)。既存room(休止中の再開含む)の
 * workerId は変更しない — 既に別workerが担当している可能性があり、上書きすると担当の
 * 二重化・接続の奪い合いを招くため。getMyRooms()/resolveWorkerForRoom()(tiktok-listener.ts)
 * はもともとDBのworkerId列を絶対視しhash(roomId)との一致を検証しないため、この自己申告値も
 * 既存ロジックと整合する。
 *
 * この関数自身は WORKER_INDEX/WORKER_COUNT を一切読まない(getWorkerConfig()を直接呼ばない)。
 * env を直接読むと、将来 web プロセスからこの関数が呼ばれた場合に無条件 throw する設計上の
 * 危険が生まれるため、値は必ず引数として受け取る。
 */
export async function ensureRoomWatchedForCollab(
  rawTiktokId: string,
  workerId?: number
): Promise<CollabWatchResult | null> {
  const tiktokId = normalizeTiktokId(rawTiktokId);
  if (!TIKTOK_ID_PATTERN.test(tiktokId)) return null;

  const existing = await prisma.tiktokRoom.findUnique({
    where: { tiktokId },
    select: { id: true },
  });

  if (existing) {
    const resumedCount = await reviveSuspendedMonitoring(existing.id);
    return { roomId: existing.id, tiktokId, resumed: resumedCount > 0, created: false };
  }

  // 上限判定は「新規作成になる」場合のみ(既存roomの監視再開は総数を増やさないため対象外)。
  const watchedCount = await prisma.tiktokRoom.count({ where: { monitoringSuspended: false } });
  if (watchedCount >= MAX_COLLAB_DISCOVERED_ROOMS) {
    console.warn(
      `[collab] 監視中room数が上限(${MAX_COLLAB_DISCOVERED_ROOMS})に達しているため、コラボ相手の新規room作成をスキップした`,
      { tiktokId }
    );
    return null;
  }

  try {
    const room = await prisma.tiktokRoom.create({
      data: { tiktokId, ...(workerId !== undefined ? { workerId } : {}) },
      select: { id: true },
    });
    return { roomId: room.id, tiktokId, resumed: false, created: true };
  } catch (err) {
    // findUnique と create の間に別リクエストが同じ部屋を作った場合。
    if ((err as { code?: string })?.code === "P2002") {
      return ensureRoomWatchedForCollab(rawTiktokId, workerId);
    }
    throw err;
  }
}
