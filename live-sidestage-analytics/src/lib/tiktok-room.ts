import { prisma } from "./prisma";
import { MAX_LEASE_DAYS } from "./room-lease";
import { reviveSuspendedMonitoring } from "./mark-last-active";
import { resolveWatchedRoomFilter } from "./watched-room-filter";
import { normalizeTikTokUserId, recordTikTokUser } from "./tiktok-user";

/**
 * room を作る・引くときに必ず一組で渡す観測値。
 *
 * **uid だけ渡して nickname を省略できない形にしてある**(nickname は null 許容だが、
 * 渡すこと自体は必須)。TiktokRoom を作って TikTokUser を作らない経路を構造的に無くすため。
 */
export type TiktokRoomSubject = {
  /** TikTok の不変な数値ID。登録ゲートの実在確認応答から得る。 */
  tiktokUid: string;
  /** 可変の @ハンドル。正規化前でよい(この関数群が normalizeTiktokId を通す)。 */
  tiktokHandle: string;
  /** 観測できていなければ null。既知の値を null で潰さない扱いは recordTikTokUser 側に任せる。 */
  nickname: string | null;
};

/** 既存 room の uid と、渡された uid が食い違ったとき。サポート対応へ回す(自動合流しない)。 */
export class RoomSubjectMismatchError extends Error {
  constructor(
    readonly roomId: string,
    readonly expected: string,
    readonly actual: string
  ) {
    super(`room ${roomId} の hostTiktokUid は ${expected} で、要求された ${actual} と一致しない。`);
    this.name = "RoomSubjectMismatchError";
  }
}

// TikTokのユーザー名は大文字小文字を区別しないため、部屋(TiktokRoom)のキーとしては
// 正規化した値を使う。Streamer.tiktokHandle自体はユーザー入力値のまま表示用に残す。
export function normalizeTiktokId(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

// Streamerの現在のtiktokHandleに対応するTiktokRoomを解決し、Streamer.roomIdを更新する。
// deviceId/workerId/proxyKey(tiktok-listener.ts)と同じ「初回アクセス時に解決→永続化→再利用」
// パターン。tiktokHandleが変更された場合(再登録)は、指しているroomのtiktokHandleが現在の値と
// 食い違うため自己修復的に新しいroomへ付け替える。
export async function resolveRoomForStreamer(streamerId: string): Promise<string> {
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: {
      tiktokUid: true,
      tiktokHandle: true,
      roomId: true,
      room: { select: { hostTiktokUid: true, tiktokHandle: true } },
    },
  });
  if (!streamer) {
    throw new Error(`resolveRoomForStreamer: streamer ${streamerId} not found`);
  }

  // 同一性は uid で判定する。ハンドル一致で判定すると、改名で空いたハンドルを取得した
  // 第三者の room へ紐付きうる。
  //
  // **ハンドルが room の値と食い違っていたら早期 return しない。** 改名では room は割れず
  // uid も roomId も変わらないので、ここで抜けると `upsertRoom` のハンドル追随
  // (`update: { tiktokHandle, handleStaleAt: null }`)へ二度と到達せず、room が旧ハンドルの
  // まま固定される。TikTok 接続はハンドルで張るので、これは接続先が死ぬということ。
  if (
    streamer.roomId &&
    streamer.room?.hostTiktokUid === streamer.tiktokUid &&
    streamer.room.tiktokHandle === normalizeTiktokId(streamer.tiktokHandle)
  ) {
    return streamer.roomId;
  }

  const room = await upsertRoom({
    tiktokUid: streamer.tiktokUid,
    tiktokHandle: streamer.tiktokHandle,
    nickname: null,
  });

  // watchedRoomFilter()はもうStreamer有無を見ない(Streamer0人のRoomも低価値クリーンアップの
  // 判定まで監視を続ける情報プール方針)ため、Streamerを新規に紐付けただけではmonitoringSuspended
  // は自動で戻らない。ここで明示的に戻さないと、過去に監視停止されたRoomへ新規登録した
  // ユーザーは、次に markLastActive()(ログイン時)が呼ばれるまでデータが貯まらない。
  //
  // reviveSuspendedMonitoring()に寄せる(以前はここだけ独自にmonitoringSuspendedのみを
  // 戻す実装だった)。NOT_FOUND系フィールド・lastLowValueCheckAt・consecutiveBlockedCount
  // も同時にリセットされるようになるが、いずれも「監視が復活した」という事実に対して
  // 一貫してリセットするのが自然で実害はない。streamer.update()と同一transactionには
  // しない(mark-last-active.tsのmarkLastActive()と同じ理由: revive失敗時にstreamerの
  // roomId更新まで巻き戻す必要はなく、revive失敗はログのみで握りつぶし次回機会に委ねる)。
  await prisma.streamer.update({ where: { id: streamerId }, data: { roomId: room.id } });
  try {
    await reviveSuspendedMonitoring(room.id);
  } catch (err) {
    console.error("[tiktok-room] 監視復活処理に失敗:", err);
  }

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
  tiktokHandle: string;
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
  subject: TiktokRoomSubject,
  monitorUntil: Date,
  now: Date = new Date()
): Promise<RoomMonitorLease> {
  const tiktokUid = requireTiktokUid(subject);
  const tiktokHandle = normalizeTiktokId(subject.tiktokHandle);
  if (!TIKTOK_ID_PATTERN.test(tiktokHandle)) {
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
    where: { hostTiktokUid: tiktokUid },
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
    const room = await prisma.$transaction(async (tx) => {
      const updated = await tx.tiktokRoom.update({
        where: { id: existing.id },
        data: { monitorUntil: granted, tiktokHandle, handleStaleAt: null },
        select: { id: true, tiktokHandle: true, monitorUntil: true },
      });
      const commit = await recordTikTokUser(tx, {
        tiktokUid,
        tiktokHandle,
        nickname: subject.nickname,
      });
      return { updated, commit };
    });
    room.commit();
    return {
      roomId: room.updated.id,
      tiktokHandle: room.updated.tiktokHandle,
      monitorUntil: room.updated.monitorUntil ?? granted,
      created: false,
    };
  }

  try {
    const room = await prisma.$transaction(async (tx) => {
      const created = await tx.tiktokRoom.create({
        data: { hostTiktokUid: tiktokUid, tiktokHandle, monitorUntil: granted },
        select: { id: true, tiktokHandle: true, monitorUntil: true },
      });
      const commit = await recordTikTokUser(tx, {
        tiktokUid,
        tiktokHandle,
        nickname: subject.nickname,
      });
      return { created, commit };
    });
    room.commit();
    return {
      roomId: room.created.id,
      tiktokHandle: room.created.tiktokHandle,
      monitorUntil: room.created.monitorUntil ?? granted,
      created: true,
    };
  } catch (err) {
    // findUnique と create の間に別リクエストが同じ部屋を作った場合。
    // 期限は max(既存, 要求) なので、作った側の期限を尊重しつつ足りなければ伸ばす。
    if ((err as { code?: string })?.code === "P2002") {
      return ensureRoomForEvent(subject, monitorUntil, now);
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

/**
 * tiktokUid に対応するTiktokRoomを取得/作成する。
 * 事務所の監視対象追加(src/lib/agency/)でも同じ部屋を共有するため、ここを唯一の入口にする。
 *
 * **upsert キーは hostTiktokUid**。改名しても room は割れないので、事後にデータを合流させる
 * 機構(旧 tiktok-id-migration.ts の absorbRooms)は要らない。既存 room があれば
 * tiktokHandle を最新の観測値へ更新する。
 */
export async function upsertRoom(subject: TiktokRoomSubject): Promise<{ id: string }> {
  const tiktokUid = requireTiktokUid(subject);
  const tiktokHandle = normalizeTiktokId(subject.tiktokHandle);

  try {
    return await prisma.$transaction(async (tx) => {
      const room = await tx.tiktokRoom.upsert({
        where: { hostTiktokUid: tiktokUid },
        // ハンドルが変わっていれば追随する。uid が同じなので同一人物であることは保証されている。
        update: { tiktokHandle, handleStaleAt: null },
        create: { hostTiktokUid: tiktokUid, tiktokHandle },
        select: { id: true },
      });
      const commit = await recordTikTokUser(tx, {
        tiktokUid,
        tiktokHandle,
        nickname: subject.nickname,
      });
      return { room, commit };
    }).then(({ room, commit }) => {
      commit();
      return room;
    });
  } catch (err) {
    // 同時に2リクエストが同じ新規uidをupsertしようとした場合のP2002競合を再フェッチで解決する。
    if ((err as { code?: string })?.code === "P2002") {
      const existing = await prisma.tiktokRoom.findUnique({
        where: { hostTiktokUid: tiktokUid },
        select: { id: true },
      });
      if (existing) return existing;
    }
    throw err;
  }
}

/** 呼び出し元の取り違え(ハンドルを uid の位置へ渡す等)を早期に検出する。 */
function requireTiktokUid(subject: TiktokRoomSubject): string {
  const tiktokUid = normalizeTikTokUserId(subject.tiktokUid);
  if (!tiktokUid) {
    throw new RoomMonitorError("TikTok の数値IDが解決できていない。", 503);
  }
  return tiktokUid;
}

export type CollabWatchSource = "collab" | "battle_start";

export type CollabWatchResult = {
  roomId: string;
  tiktokHandle: string;
  /** この呼び出しで monitoringSuspended: true → false に書き換えたか(= 休止中だった) */
  resumed: boolean;
  /** この呼び出しで TiktokRoom を新規作成したか。呼び出し元は created===true のときだけ
   * 即接続キック(startListener)を検討してよい — false(既存room再利用/再開)で毎回キックすると
   * 同じ相手を検知するたびに再接続してしまう */
  created: boolean;
  /** このroomの TiktokRoom.watchSource(最初にこの経路で発見された記録)。呼び出し元が
   * 監視中だった既存roomを再検知した場合は DB の値(null もありうる)をそのまま返す。 */
  watchSource: CollabWatchSource | null;
};

// コラボ経由で新規発見できるroomの上限。ensureRoomForEvent()のMAX_ACTIVE_LEASESと同じ理由
// (TikTok接続はプロキシ・Euler署名APIの枠を消費する有限リソース)に加え、コラボ由来のroomも
// 監視対象になる(=次のreconcileでlinkLayerを購読する)ため、コラボが連鎖するとStreamer登録の
// 意図から離れて無制限に広がりうる(実装後レビューで指摘)。上限は「既に監視中のroom総数」で
// 判定するソフトリミット(同時作成で数件超過しうるが、接続資源の暴走を止めるのが目的で厳密な
// 数え上げは要件ではない)。
const MAX_COLLAB_DISCOVERED_ROOMS = 500;

/**
 * コラボ(linkMic)相手・バトル相手を監視対象へ入れる。tiktok-listener.ts の linkLayer
 * ハンドラ(コラボ承諾検知、source:"collab")と linkMicBattle ハンドラ(バトル開始検知、
 * source:"battle_start")の両方から呼ぶ。呼び出し元room側の歯止め(Streamer購読または
 * specialWatchのroomからしか呼ばない)は tiktok-listener.ts のハンドラ側にあり、この関数自身の
 * 歯止めは下記のMAX_COLLAB_DISCOVERED_ROOMSのみ。
 *
 * - 未登録(TiktokRoomが無い) → 上限未満なら新規作成する。新規行の monitoringSuspended は既定
 *   false なのでそのまま監視対象になる(resumed: false)。watchSource/watchSourceAtに発見経路を
 *   記録する。上限に達している場合は作成せず null
 * - 登録済み・監視中(monitoringSuspended: false) → 何もしない(resumed: false)。watchSourceも
 *   書き換えない(最初に監視を始めた経路を残す)。resolveRoomForStreamer()と同じく、
 *   AgencyWatch/monitorUntilが理由で監視中の場合もここでは関知しない
 *   (watchedRoomFilter()のOR条件のどれか1つでも満たせばよいため)
 * - 登録済み・休止中(monitoringSuspended: true) → false に書き換える(resumed: true)。
 *   NOT_FOUND判定用フィールドもreviveSuspendedMonitoring()が併せてリセットする
 *   (残したままだと復活直後の実在確認で古いstreakを引き継ぎ、誤って早期に再停止しうるため)。
 *   watchSourceがまだnull(この経路で発見されたのが初めて)のときだけ記録する
 *
 * tiktokHandle の形式が不正(TIKTOK_ID_PATTERN)な場合は何もせず null を返す — コラボ相手の
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
  subject: TiktokRoomSubject,
  workerId: number | undefined,
  source: CollabWatchSource
): Promise<CollabWatchResult | null> {
  const tiktokUid = normalizeTikTokUserId(subject.tiktokUid);
  if (!tiktokUid) return null;
  const tiktokHandle = normalizeTiktokId(subject.tiktokHandle);
  if (!TIKTOK_ID_PATTERN.test(tiktokHandle)) return null;

  const existing = await prisma.tiktokRoom.findUnique({
    where: { hostTiktokUid: tiktokUid },
    select: { id: true, watchSource: true },
  });

  if (existing) {
    const resumedCount = await reviveSuspendedMonitoring(existing.id);
    let watchSource = existing.watchSource as CollabWatchSource | null;
    const commit = await prisma.$transaction(async (tx) => {
      await tx.tiktokRoom.update({
        where: { id: existing.id },
        data: {
          tiktokHandle,
          handleStaleAt: null,
          ...(resumedCount > 0 && watchSource === null
            ? { watchSource: source, watchSourceAt: new Date() }
            : {}),
        },
      });
      return recordTikTokUser(tx, { tiktokUid, tiktokHandle, nickname: subject.nickname });
    });
    commit();
    if (resumedCount > 0 && watchSource === null) watchSource = source;
    return { roomId: existing.id, tiktokHandle, resumed: resumedCount > 0, created: false, watchSource };
  }

  // 上限判定は「新規作成になる」場合のみ(既存roomの監視再開は総数を増やさないため対象外)。
  // watchedRoomFilter()と定義統一(乖離防止、F3対応)。
  const watchedCount = await prisma.tiktokRoom.count({ where: await resolveWatchedRoomFilter() });
  if (watchedCount >= MAX_COLLAB_DISCOVERED_ROOMS) {
    console.warn(
      `[collab] 監視中room数が上限(${MAX_COLLAB_DISCOVERED_ROOMS})に達しているため、相手roomの新規作成をスキップした`,
      { tiktokHandle, source }
    );
    return null;
  }

  try {
    const { room, commit } = await prisma.$transaction(async (tx) => {
      const created = await tx.tiktokRoom.create({
        data: {
          hostTiktokUid: tiktokUid,
          tiktokHandle,
          watchSource: source,
          watchSourceAt: new Date(),
          ...(workerId !== undefined ? { workerId } : {}),
        },
        select: { id: true },
      });
      const marker = await recordTikTokUser(tx, {
        tiktokUid,
        tiktokHandle,
        nickname: subject.nickname,
      });
      return { room: created, commit: marker };
    });
    commit();
    return { roomId: room.id, tiktokHandle, resumed: false, created: true, watchSource: source };
  } catch (err) {
    // findUnique と create の間に別リクエストが同じ部屋を作った場合。
    if ((err as { code?: string })?.code === "P2002") {
      return ensureRoomWatchedForCollab(subject, workerId, source);
    }
    throw err;
  }
}

/**
 * /admin/workers 管理画面の「監視追加」から呼ぶ room 用意。
 *
 * prisma.tiktokRoom.create/upsert はこのファイルへ閉じる規律(tiktok-room.guard.test.ts)のため、
 * worker-status.ts から本文をここへ移した。room 作成経路はすべて同一トランザクションで
 * recordTikTokUser() を呼ぶ。
 */
export async function ensureRoomWatchedByAdmin(
  subject: TiktokRoomSubject
): Promise<{ roomId: string; created: boolean }> {
  const tiktokUid = requireTiktokUid(subject);
  const tiktokHandle = normalizeTiktokId(subject.tiktokHandle);

  const existing = await prisma.tiktokRoom.findUnique({
    where: { hostTiktokUid: tiktokUid },
    select: { id: true },
  });

  if (existing) {
    await reviveSuspendedMonitoring(existing.id);
    const commit = await prisma.$transaction(async (tx) => {
      await tx.tiktokRoom.update({
        where: { id: existing.id },
        // specialWatch: true — 管理者が明示的に監視追加した room は、以後 watchSource の値
        // (過去にコラボ/battle_start由来だったか)にかかわらず常に「購読あり」として扱う
        // (バトル履歴生成の購読判定、battle-subscription.ts参照)。
        data: { tiktokHandle, handleStaleAt: null, specialWatch: true },
      });
      return recordTikTokUser(tx, { tiktokUid, tiktokHandle, nickname: subject.nickname });
    });
    commit();
    return { roomId: existing.id, created: false };
  }

  try {
    const { room, commit } = await prisma.$transaction(async (tx) => {
      const created = await tx.tiktokRoom.create({
        data: { hostTiktokUid: tiktokUid, tiktokHandle, specialWatch: true },
        select: { id: true },
      });
      const marker = await recordTikTokUser(tx, {
        tiktokUid,
        tiktokHandle,
        nickname: subject.nickname,
      });
      return { room: created, commit: marker };
    });
    commit();
    return { roomId: room.id, created: true };
  } catch (err) {
    // findUnique と create の間に別リクエストが同じ部屋を作った場合。
    if ((err as { code?: string })?.code === "P2002") {
      return ensureRoomWatchedByAdmin(subject);
    }
    throw err;
  }
}

/**
 * 接続直前の uid 照合(tiktok-listener.ts)が別人を検出したときに立てる。
 *
 * **自動では解除しない。** 解除は本人の再登録・イベント参加・管理画面の監視追加など、
 * `tiktokHandle` を書き直す経路が `handleStaleAt: null` を同時に書くことで行う
 * (このファイル内の update/upsert がすべてそうしている)。時間経過での自動復帰を入れると、
 * ハンドルを取得した第三者の配信へ繰り返し接続しに行く。
 */
export async function markRoomHandleStale(roomId: string, at: Date = new Date()): Promise<void> {
  await prisma.tiktokRoom.update({ where: { id: roomId }, data: { handleStaleAt: at } });
}

// --- /admin/workers 管理画面からの監視解除・完全削除(管理者専用) ---

export type SuspendRoomResult = "suspended" | "already_suspended" | "not_found";

/**
 * 監視を一時停止する(monitoringSuspended:trueにする)。データは一切消さない。
 *
 * **恒久停止ではない。** ログイン/セッション検証のたび(markLastActive())、OBSオーバーレイの
 * アクセスのたび(reviveSuspendedMonitoringForRoom())、resolveRoomForStreamer()、
 * Workerのコラボ検知(ensureRoomWatchedForCollab())のいずれかが発生すると、
 * reviveSuspendedMonitoring()経由で自動的にfalseへ戻る(排他制御なし、既存仕様)。
 * 呼び出し側(UI)は「一時停止」であることを利用者へ明示すること。
 */
export async function suspendRoomMonitoring(
  roomId: string,
  operatorEmail: string
): Promise<SuspendRoomResult> {
  return prisma.$transaction(async (tx) => {
    const room = await tx.tiktokRoom.findUnique({
      where: { id: roomId },
      select: { id: true, tiktokHandle: true, monitoringSuspended: true },
    });
    if (!room) return "not_found" as const;
    if (room.monitoringSuspended) return "already_suspended" as const;

    await tx.tiktokRoom.update({ where: { id: roomId }, data: { monitoringSuspended: true } });
    await tx.tiktokRoomAdminAuditLog.create({
      data: { action: "suspend", roomId: room.id, tiktokHandle: room.tiktokHandle, operatorEmail },
    });
    return "suspended" as const;
  });
}

export type ToggleSpecialWatchResult =
  | { status: "toggled"; specialWatch: boolean }
  | { status: "not_found" };

/**
 * 開発用「特別監視」フラグの反転。specialWatch:true のroomは、コラボ相手・バトル相手発見の
 * キック条件をStreamer購読と無関係に満たす(tiktok-listener.ts の recordCollabGroupChange /
 * watchBattleOpponents 呼び出しガード参照)。監視対象の判定(watchedRoomFilter)では、
 * 匿名観測room自動停止トグルのstale判定を免除する(monitoringSuspended:false は必要)。
 *
 * ONにする際、そのroomが監視一時停止中(monitoringSuspended:true)なら同時に解除する。
 * 一時停止のままだと特別監視ONにしても watchedRoomFilter を満たさず実際には動かないため。
 * OFFに戻す操作では一時停止状態を書き戻さない(既存の一時停止はそのまま尊重する)。
 */
export async function toggleSpecialWatch(
  roomId: string,
  operatorEmail: string
): Promise<ToggleSpecialWatchResult> {
  return prisma.$transaction(async (tx) => {
    const room = await tx.tiktokRoom.findUnique({
      where: { id: roomId },
      select: { id: true, tiktokHandle: true, specialWatch: true, monitoringSuspended: true },
    });
    if (!room) return { status: "not_found" as const };

    const nextValue = !room.specialWatch;
    const revivesSuspension = nextValue && room.monitoringSuspended;
    await tx.tiktokRoom.update({
      where: { id: roomId },
      data: {
        specialWatch: nextValue,
        // revive時はreviveSuspendedMonitoring()(mark-last-active.ts)と同じフィールドを
        // 同時にリセットする。monitoringSuspended:falseだけ戻すと、匿名room(Streamer/
        // AgencyWatch/monitorUntilいずれも無し)ではlastWatchInstructedAtが古いままになり、
        // 匿名観測room自動停止トグルON時にwatchedRoomFilter()のstale判定に引っかかって
        // 監視対象から漏れ続ける(UI上は復帰済みなのに実際はworkerが接続しない)。
        ...(revivesSuspension
          ? {
              monitoringSuspended: false,
              lastWatchInstructedAt: new Date(),
              unhealthySince: null,
              notFoundStreak: 0,
              notFoundFirstAt: null,
              lastExistenceCheckAt: null,
              lastLowValueCheckAt: new Date(),
              consecutiveBlockedCount: 0,
            }
          : {}),
      },
    });
    await tx.tiktokRoomAdminAuditLog.create({
      data: {
        action: "toggle_special_watch",
        roomId: room.id,
        tiktokHandle: room.tiktokHandle,
        operatorEmail,
        detail: { specialWatch: nextValue, ...(revivesSuspension ? { revivedSuspension: true } : {}) },
      },
    });
    return { status: "toggled" as const, specialWatch: nextValue };
  });
}

export type DeleteRoomResult = "deleted" | "not_found" | "event_active" | "lock_unavailable";

/**
 * TiktokRoomを完全削除する。不可逆。
 *
 * - Gift/BattleHistory等のTiktokRoom子リレーションはほぼ全てonDelete:Cascadeで消える。
 * - Streamer.roomは optional relation で onDelete 未指定 = SetNull。Streamer行自体は残り
 *   roomIdだけnullになる。**その後Streamerが1人でも残っていれば、次回アクセス時に
 *   resolveRoomForStreamer()が同じtiktokHandleの部屋を自動再作成し監視も再開する**。
 * - AgencyWatch.roomは必須relationでonDelete未指定=Restrict。削除前にdeleteManyで
 *   明示的に取り除く必要がある(FK制約回避のための必須の前処理)。
 * - EventParticipant.roomId / EventRoomLease.roomId / DetectedBattle.roomIdはいずれも
 *   FK制約のない論理参照。未finalizeイベントのEventParticipant、または未release
 *   (releasedAt:null)のEventRoomLeaseが対象roomを参照していれば、削除せず
 *   "event_active" を返す(absorbRooms()のEVENT_ACTIVE判定を踏襲)。finalize済み
 *   イベントの参照・DetectedBattleは孤児として残ることを許容する(過去イベントの
 *   履歴データであり実害が限定的なため)。同様にBattleHistoryParticipant.roomId
 *   (相手roomの参照)・EulerSignUsage.roomId・TiktokHandleMergeLog.oldRoomId/survivingRoomId
 *   もFK制約のない論理参照で、削除後は孤児として残る(いずれも過去ログ・表示用データ)。
 * - Gift行数の多い部屋でのカスケード削除がPrisma interactive transactionの既定
 *   タイムアウト(5秒)を超えないよう、absorbRooms()と同じtimeout/advisory lockを使う。
 *
 * 新しくonDelete:Restrictな関係がTiktokRoomへ追加された場合、このtransactionは
 * P2003で失敗するようになる。その場合は該当リレーションの明示的なdeleteMany/付け替えを
 * ここへ追加すること。
 */
export async function deleteTiktokRoomPermanently(
  roomId: string,
  operatorEmail: string
): Promise<DeleteRoomResult> {
  return prisma.$transaction(
    async (tx) => {
      const lock = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
        roomId
      );
      if (!lock[0]?.locked) return "lock_unavailable" as const;

      const room = await tx.tiktokRoom.findUnique({
        where: { id: roomId },
        select: { id: true, tiktokHandle: true },
      });
      if (!room) return "not_found" as const;

      const activeParticipants = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count
           FROM event."EventParticipant" ep
           JOIN event."Event" e ON e."id" = ep."eventId"
          WHERE ep."roomId" = $1 AND e."finalizedAt" IS NULL`,
        roomId
      );
      if (Number(activeParticipants[0]?.count ?? 0) > 0) return "event_active" as const;

      const activeLeases = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count
           FROM event."EventRoomLease"
          WHERE "roomId" = $1 AND "releasedAt" IS NULL`,
        roomId
      );
      if (Number(activeLeases[0]?.count ?? 0) > 0) return "event_active" as const;

      // agencyWatch.deleteMany より前にスナップショットを取る(順序を誤るとwatchCountが常に0になる)。
      const [streamerCount, watches, giftCount, battleHistoryCount] = await Promise.all([
        tx.streamer.count({ where: { roomId } }),
        tx.agencyWatch.findMany({ where: { roomId }, select: { agencyId: true } }),
        tx.gift.count({ where: { roomId } }),
        tx.battleHistory.count({ where: { roomId } }),
      ]);
      const detail = {
        streamerCount,
        watchCount: watches.length,
        agencyIds: watches.map((w) => w.agencyId),
        giftCount,
        battleHistoryCount,
      };

      await tx.agencyWatch.deleteMany({ where: { roomId } });
      // GiftDailyListenerStat は TiktokRoom への FK を張っていない(明細と切り離す設計)ので
      // cascade で消えない。明示的に消さないと孤児行が残る。
      await tx.giftDailyListenerStat.deleteMany({ where: { roomId } });
      await tx.tiktokRoom.delete({ where: { id: roomId } });
      await tx.tiktokRoomAdminAuditLog.create({
        data: { action: "delete", roomId: room.id, tiktokHandle: room.tiktokHandle, operatorEmail, detail },
      });

      return "deleted" as const;
    },
    { timeout: 60_000, maxWait: 10_000 }
  );
}
