import { prisma } from "./prisma";
import { ANONYMOUS_ROOM_AUTO_STOP_TIMEOUT_MS } from "./watched-room-filter";

// コラボ相手roomの監視を「発見元roomがコラボを続けている間」だけ維持するためのリンク管理。
// TiktokRoomCollabSource(schema.prisma参照)の読み書きをこのファイルへ閉じる。
//
// **前提: 1つのsourceRoomは同時に複数の独立したコラボセッションを保持しない。**
// コラボ検知時点(messageType:18)ではセッションID(channelId)が安定して取得できない
// (2026-09-12実測: 過去ログ169件全件でchannelIdが自分自身のroomIdと一致し、コラボの
// セッションIDにならない)ため、この前提のもとsourceRoomId単位でリンクをまとめて扱う。
// 将来この前提が実測で崩れた場合は{watchedRoomId, sourceRoomId, collabSessionId}の
// セッション単位管理へ拡張する必要がある。今回はセッションIDを推測・独自生成しない。
//
// `lastCollabSourceRoomId`(TiktokRoom、tiktok-room.ts)とは役割が異なる。あちらは
// 「直近の引き金1件」を毎回上書きする集計専用スナップショット(/admin/workers「コラボ署名消費」列)、
// こちらは「現在有効な発見元の集合」を保持し、コラボ解散検知でその発見元ぶんだけ消す。
// 両者は同期しない(片方の変更でもう片方を書き換える処理は無い)。

/**
 * sourceRoomIdごとの直列化キュー(2026-09-12追加、code-review Codex指摘)。
 *
 * 「発見処理(recordCollabSourceLink)」と「CLOSE処理(releaseCollabSourceLinksBySource)」は
 * どちらも非同期でfire-and-forget起動される(`tiktok-listener.ts`の`linkLayer`/`linkMessage`
 * ハンドラは同期関数で、内部の処理をvoidで開始する)。同一source roomで「コラボ検知→即CLOSE」の
 * 順にTikTokイベントが届いても、検知側は`ensureRoomWatchedForCollab`(room作成/確認)を経由する分
 * CLOSE側より処理完了が遅れがちで、CLOSE側の`findMany`が先に(まだ存在しない)リンクを見て
 * 空振りし、その後に検知側がリンクを新規作成してしまう競合がある。この場合、既に終了した
 * コラボのリンクがTTL(最大30分)まで残り続け、今回のスコープ外である「セッション単位管理
 * ({watchedRoomId, sourceRoomId, collabSessionId})」を必要とせずに解決するには、同一
 * sourceRoomIdに対する一連の処理をイベント到着順に直列化するだけで十分。
 *
 * `tiktok-listener.ts`側で、`linkLayer`/`linkMicBattle`(発見)・`linkMessage`(CLOSE)いずれの
 * ハンドラも、イベント到着時点で即座にこのキューへ処理全体(room作成含む)をenqueueする
 * (ハンドラ内で先にawaitを挟んでからenqueueすると、到着順とキュー投入順がずれて意味が無い)。
 * 複数の相手roomを同時発見した場合はこのキューにより直列実行されるため並行性を失うが、
 * 通常1〜数人程度でありデータ整合性を優先する。
 */
const sourceRoomQueues = new Map<string, Promise<unknown>>();

export function enqueueForSource<T>(sourceRoomId: string, task: () => Promise<T>): Promise<T> {
  const prev = sourceRoomQueues.get(sourceRoomId) ?? Promise.resolve();
  const result = prev.then(task, task);
  // 失敗してもキューを止めない(次のenqueueが古いエラーを拾わないよう握りつぶす)。
  // メモリリーク防止のため、既定サイズを超えて増え続けないようキュー完了後にエントリを掃除する。
  const settled = result.then(
    () => undefined,
    () => undefined
  );
  sourceRoomQueues.set(sourceRoomId, settled);
  settled.finally(() => {
    if (sourceRoomQueues.get(sourceRoomId) === settled) sourceRoomQueues.delete(sourceRoomId);
  });
  return result;
}

/**
 * コラボ/バトル相手の検知時に呼ぶ。既存リンクがあれば`lastSeenAt`を更新するだけ、
 * 無ければ新規作成する。冪等 — 同じ発見元から同じ相手を何度検知しても1行のまま。
 *
 * watchedRoomId側にFK+Cascadeがあるため、呼び出し時点でwatchedRoomのTiktokRoom行が
 * 既に存在している必要がある(ensureRoomWatchedForCollab()のDB用意より後に呼ぶこと)。
 *
 * **呼び出し元は`enqueueForSource(sourceRoomId, ...)`経由で呼ぶこと**(直接awaitで
 * 呼ぶとCLOSE処理との順序保証が効かない。上記キューのコメント参照)。
 */
export async function recordCollabSourceLink(watchedRoomId: string, sourceRoomId: string): Promise<void> {
  const now = new Date();
  await prisma.tiktokRoomCollabSource.upsert({
    where: { watchedRoomId_sourceRoomId: { watchedRoomId, sourceRoomId } },
    create: { watchedRoomId, sourceRoomId, createdAt: now, lastSeenAt: now },
    update: { lastSeenAt: now },
  });
}

/**
 * 発見元roomでコラボ解散(`TYPE_LINKER_CLOSE`)を検知したときに呼ぶ。その発見元からのリンクを
 * 全削除し、削除の結果リンクが0件になったwatched roomだけ監視を期限切れ方向へ倒す。
 *
 * 「削除 → count確認 → 更新」という3ステップの素朴な実装は、その間に別workerが新しい
 * リンクを作ると生存中のコラボがあるのに停止側へ倒す競合を起こす。停止用の更新は
 * `applyExpiryToRoomsWithNoLinks()`でDB側にリンク非存在をUPDATE文自身に保証させる。
 *
 * **削除自体にも同種の競合がある(code-review Codex指摘、2026-09-12検証・修正)。**
 * `sourceRoomId`だけで`deleteMany`すると、この関数の呼び出し中(findMany後〜deleteMany前)に
 * 同じsourceRoomIdから新しいコラボが始まり`recordCollabSourceLink()`が新規作成/更新した
 * リンクまで無条件に削除してしまう(TikTokの仕様上、CLOSE直後に同じsource roomが別相手と
 * 即座にコラボを再開すること自体はありうる)。この関数の呼び出し開始時刻を`cutoff`として保持し、
 * `lastSeenAt <= cutoff`の行だけを対象にすることで、cutoff後に記録・更新されたリンクは
 * 削除対象から外す。findMany/deleteManyへ同じ条件を渡すため、findManyで拾った行が
 * deleteMany実行前に別workerの再検知で`lastSeenAt`を更新されて条件から外れた場合でも、
 * その行はwatchedRoomIdに残ったまま(誤って停止側へ倒れない安全側)になる。
 *
 * **呼び出し元は`enqueueForSource(sourceRoomId, ...)`経由で呼ぶこと**(同一sourceRoomIdの
 * `recordCollabSourceLink`と同じキューに乗せることで到着順を保証する。上記キューのコメント
 * 参照)。直列化により同一sourceRoomId内でのfindMany/deleteMany間の割り込みは起こらなくなる
 * ため、cutoffのミリ秒精度は実質問題にならない(code-review Codex round2 MEDIUM指摘への対応)。
 * cutoff自体は「呼び出し開始後に記録されたリンクを削除しない」という意図を明示するため残す。
 */
export async function releaseCollabSourceLinksBySource(sourceRoomId: string): Promise<void> {
  const cutoff = new Date();
  const where = { sourceRoomId, lastSeenAt: { lte: cutoff } };

  const deleted = await prisma.tiktokRoomCollabSource.findMany({
    where,
    select: { watchedRoomId: true },
  });
  if (deleted.length === 0) return;

  await prisma.tiktokRoomCollabSource.deleteMany({ where });

  // sourceRoomId単位の全削除件数を残す。「1 source room = 1 collab session」前提が実測で
  // 崩れているか(複数の独立コラボを同時に持つroomが存在するか)を事後に検証できるようにする
  // (design-review指摘。前提が崩れた場合はcollabSessionIdでの管理へ拡張する)。
  console.info("[collab] コラボ解散によりリンク解放", { sourceRoomId, releasedCount: deleted.length });

  const watchedRoomIds = [...new Set(deleted.map((d) => d.watchedRoomId))];
  await applyExpiryToRoomsWithNoLinks(watchedRoomIds);
}

/**
 * `lastSeenAt`が30分(既存の匿名room自動停止と同じタイムアウト値)より古いリンクを削除する
 * TTL cleanup。`TYPE_LINKER_CLOSE`の取りこぼし(worker再起動・接続断でイベント自体を
 * 逃した場合)に対するバックストップ。worker.tsのreconcileから周期的に呼ぶ想定で、
 * 複数workerが同時に実行しても冪等(deleteMany + conditional updateなので競合しても
 * 二重に停止処理が走るだけで安全)。
 */
export async function cleanupStaleCollabSourceLinks(now: Date = new Date()): Promise<void> {
  const staleBefore = new Date(now.getTime() - ANONYMOUS_ROOM_AUTO_STOP_TIMEOUT_MS);

  const stale = await prisma.tiktokRoomCollabSource.findMany({
    where: { lastSeenAt: { lt: staleBefore } },
    select: { watchedRoomId: true },
  });
  if (stale.length === 0) return;

  await prisma.tiktokRoomCollabSource.deleteMany({ where: { lastSeenAt: { lt: staleBefore } } });

  const watchedRoomIds = [...new Set(stale.map((s) => s.watchedRoomId))];
  await applyExpiryToRoomsWithNoLinks(watchedRoomIds);
}

/**
 * 渡されたwatchedRoomIdのうち、**UPDATE実行時点でもTiktokRoomCollabSourceが1件も
 * 存在しない**roomだけ`lastWatchInstructedAt`を期限切れ方向へ倒す。NOT EXISTSをUPDATE文
 * 自身の条件に含めることで、「リンク削除→この関数の呼び出し」の間に別workerが新しい
 * リンクをinsertした場合でも、そのroomは対象から外れる(生存中のコラボを誤って
 * 停止させない)。Prisma APIではNOT EXISTS付きのconditional updateを表現できないため、
 * この部分だけparameterized $executeRawを使う。
 *
 * `lastWatchInstructedAt > staleBefore`もWHEREに含めることで、既に十分古い行を
 * 無駄に書き換えず、時刻を巻き戻すこともない(冪等)。
 *
 * この関数自身はwatchedRoomFilter()を変更しない — 他の監視理由(Streamer登録/
 * AgencyWatch/monitorUntil/specialWatch)がある room では、lastWatchInstructedAtを
 * 倒してもOR条件の他の枝が真のままなので実質no-opになる。
 *
 * 残余リスク: READ COMMITTEDの下では、UPDATE開始直前にコミットされたINSERTを
 * このUPDATE自体が正しく見る(NOT EXISTSはUPDATE実行時点で評価される)ため理論上の
 * 取りこぼしは無いが、仮に何らかの理由で誤って停止側へ倒れても、次のコラボ検知で
 * ensureRoomWatchedForCollab()のreviveSuspendedMonitoring()経由でlastWatchInstructedAtが
 * 再スタンプされ自己回復する。
 */
async function applyExpiryToRoomsWithNoLinks(watchedRoomIds: string[]): Promise<void> {
  if (watchedRoomIds.length === 0) return;
  const staleBefore = new Date(Date.now() - ANONYMOUS_ROOM_AUTO_STOP_TIMEOUT_MS - 1_000);

  await prisma.$executeRaw`
    UPDATE public."TiktokRoom" AS r
    SET "lastWatchInstructedAt" = ${staleBefore}
    WHERE r.id = ANY(${watchedRoomIds}::text[])
      AND r."lastWatchInstructedAt" > ${staleBefore}
      AND NOT EXISTS (
        SELECT 1 FROM public.tiktok_room_collab_sources s
        WHERE s."watchedRoomId" = r.id
      )
  `;
}
