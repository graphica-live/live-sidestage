// `@/lib/overlay` のサーバー側 facade。
//
// **ここはサーバー専用(Route Handler / worker.ts / server.js 経由)。**
// クライアントコンポーネントからこのファイルを import すると、prisma と crypto が
// ブラウザバンドルの依存グラフに入る。クライアントからは
// `@/lib/overlay/contracts`(型・定数) と `@/lib/overlay/kinds`(種類の一覧) を直接 import すること。
//
// 再エクスポートは「既存の呼び出し元が実際に使っているもの」に限っている。
// 便利だからと全モジュールをここへ足すと、上の境界が意味を失う。

export {
  jstDateKey,
  shiftDayKey,
  resolveOverlayDayKey,
  inferOverlayDisplayReference,
} from "./day-key";

export {
  OVERLAY_HEADING_BACKGROUNDS,
  OVERLAY_DISPLAY_SPEED_MIN,
  OVERLAY_DISPLAY_SPEED_MAX,
  clampOverlayDisplaySpeed,
  normalizeOverlayAlign,
  normalizeOverlayHeadingBackground,
} from "./contracts";
export type {
  OverlayHeadingBackground,
  OverlayContributor,
  OverlaySnapshot,
  OverlaySettingsPayload,
} from "./contracts";

export { generateOverlayToken, resolveStreamerIdByOverlayToken, ensureOverlayToken } from "./token";
export { buildOverlaySnapshot } from "./contribution.server";
export {
  emitOverlayUpdate,
  overlayRoom,
  emitLikeMilestone,
  emitTimerEvent,
  __resetOverlayEmitStateForTest,
} from "./emit";
export type { LikeMilestoneEvent, TimerEvent, TimerRuntimePayload } from "./emit";

import { emitOverlayUpdate } from "./emit";

// 既存呼び出しの互換エイリアス。tiktok-listener.ts / api/internal/gift-event /
// api/streamer/overlay-settings がこの名前で呼んでおり、integration テスト4本
// (tiktok-listener.{combo,gift-dedup,room,watchdog})が `vi.mock("./overlay")` で
// この名前をモックしている。**消すと呼び出し側とテストの両方を書き換えることになる。**
export function emitOverlaySnapshot(streamerId: string): Promise<void> {
  return emitOverlayUpdate(streamerId, "contribution");
}

// desktop 5ウィジェット移植で追加。「giftイベントが起きた」という既存の事実通知
// (emitOverlay: true / notifyOverlayUpdate)の呼び先をこれに差し替えるだけで、
// contributionに加えてcoin-list/top-giftも一緒に更新する。Worker→Webのプロトコルは
// 変更しない(overlayKindsのようなリストをWorkerに持たせない)ことで、
// 新Web稼働中に旧Workerが動いていても即座に効き、Webだけロールバックしても
// contributionの更新が止まらない。
export async function emitGiftDrivenOverlayUpdates(streamerId: string): Promise<void> {
  // 現状は3kind分それぞれが独立にfetchDayGiftsする(3-0節の負荷注記)。
  // 将来的に負荷が問題になれば、ここで1回だけfetchしてbuildSnapshotへ注入する形に
  // 最適化する余地がある(初期実装ではシンプルさを優先)。
  await Promise.all([
    emitOverlayUpdate(streamerId, "contribution"),
    emitOverlayUpdate(streamerId, "coin-list"),
    emitOverlayUpdate(streamerId, "top-gift"),
  ]);
}
