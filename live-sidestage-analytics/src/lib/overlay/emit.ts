// オーバーレイへの socket.io 送信。**サーバー専用**。

import type { Server as SocketIOServer } from "socket.io";
import type { OverlayKind } from "./kinds";
import { OVERLAY_KIND_SERVER } from "./server-kinds";

// server.js が生成した socket.io サーバーへの参照。Next.jsのモジュール再生成をまたいで
// 生存させるため、tiktok-listener.ts の __tiktokListeners と同じ global 経由のパターンを使う。
const g = global as typeof globalThis & {
  __io?: SocketIOServer;
  __overlayEmitThrottle?: Map<string, { timer: NodeJS.Timeout; queued: boolean }>;
};
if (!g.__overlayEmitThrottle) g.__overlayEmitThrottle = new Map();
const emitThrottle = g.__overlayEmitThrottle;

const OVERLAY_EMIT_THROTTLE_MS = 500;

/** OBS が join しているルーム。**server.js の io.use() が同じ名前で join させている** */
export function overlayRoom(streamerId: string): string {
  return `overlay:${streamerId}`;
}

// (kind, streamerId)ごとにtrailing throttle(500ms)してsnapshotをpushする。コンボギフト連打中は
// tiktok-listener.tsのsaveGift()がdelta>0のたびに呼ばれるため、間引かないと連打中に
// 1秒間へ何度もDB再集計とsocket送信が走ってしまう。
// **throttleキーにkindを含めること。** streamerIdだけだと、種類を増やしたときに
// 別種類のupdateが互いを間引いて「片方だけ更新されない」状態になる。
export async function emitOverlayUpdate(streamerId: string, kind: OverlayKind): Promise<void> {
  const throttleKey = `${kind}:${streamerId}`;
  const existing = emitThrottle.get(throttleKey);
  if (existing) {
    existing.queued = true;
    return;
  }

  const entry: { timer: NodeJS.Timeout; queued: boolean } = {
    queued: false,
    timer: setTimeout(runThrottledEmit, OVERLAY_EMIT_THROTTLE_MS),
  };
  emitThrottle.set(throttleKey, entry);

  async function runThrottledEmit() {
    try {
      const { buildSnapshot, snapshotEvent } = OVERLAY_KIND_SERVER[kind];
      const snapshot = await buildSnapshot(streamerId);
      if (snapshot) {
        g.__io?.to(overlayRoom(streamerId)).emit(snapshotEvent, snapshot);
      }
    } catch (err) {
      console.error("[overlay] emit error:", err);
    } finally {
      if (entry.queued) {
        entry.queued = false;
        entry.timer = setTimeout(runThrottledEmit, OVERLAY_EMIT_THROTTLE_MS);
      } else {
        emitThrottle.delete(throttleKey);
      }
    }
  }
}

/** テスト専用。throttle状態がテスト間で持ち越されると emit 回数が合わなくなる */
export function __resetOverlayEmitStateForTest(): void {
  for (const entry of emitThrottle.values()) clearTimeout(entry.timer);
  emitThrottle.clear();
}
