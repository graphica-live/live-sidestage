import type { Server as SocketIOServer } from "socket.io";

export interface ChatCommentPayload {
  streamerId: string;
  uniqueId: string;
  nickname: string;
  profilePictureUrl: string | null;
  comment: string;
  receivedAt: string; // ISO8601
  // TikTok側が払い出すWebcastChatMessage.common.msgId。欠落時はnull。
  msgId: string | null;
}

interface ChatDedupState {
  ids: Set<string>;
  order: string[];
}

const CHAT_COMMENT_DEDUP_CACHE_SIZE = 50;

// server.js が生成した socket.io サーバーへの参照。overlay.ts と同じ global 経由パターン。
const g = global as typeof globalThis & {
  __io?: SocketIOServer;
  __chatCommentDedup?: Map<string, ChatDedupState>;
};
if (!g.__chatCommentDedup) g.__chatCommentDedup = new Map();
const dedupByStreamer = g.__chatCommentDedup;

// tiktok-listener.ts側のrecentChatMsgIdsはWorkerプロセス(ListenerInstance)単位のdedupのため、
// デプロイ時のゼロダウンタイム切替(旧Workerが生きたまま新Workerが同じ部屋へ接続する重複期間、
// worker.tsのreadiness signal参照)では新旧2プロセスがそれぞれ別インスタンスとして同一msgIdを
// 「初見」と判定し、両方がここまで転送してくる。socket.ioへの配信が実際に集約される
// このWebプロセス側(全Worker/in-processチャットの単一合流点)でmsgIdベースに再dedupすることで、
// プロセスをまたいだ二重配信を防ぐ。
function isDuplicateChatComment(streamerId: string, msgId: string): boolean {
  let state = dedupByStreamer.get(streamerId);
  if (!state) {
    state = { ids: new Set(), order: [] };
    dedupByStreamer.set(streamerId, state);
  }
  if (state.ids.has(msgId)) return true;
  state.ids.add(msgId);
  state.order.push(msgId);
  if (state.order.length > CHAT_COMMENT_DEDUP_CACHE_SIZE) {
    const oldest = state.order.shift();
    if (oldest !== undefined) state.ids.delete(oldest);
  }
  return false;
}

// Android/iOSアプリ向けのコメント配信。overlayと違いDB保存・間引きは行わず、
// 受信したチャットイベントをそのまま `chat:${streamerId}` ルームへ流す。
export async function emitChatComment(payload: ChatCommentPayload): Promise<void> {
  if (payload.msgId && isDuplicateChatComment(payload.streamerId, payload.msgId)) {
    return;
  }
  g.__io?.to(`chat:${payload.streamerId}`).emit("chat:comment", payload);
}
