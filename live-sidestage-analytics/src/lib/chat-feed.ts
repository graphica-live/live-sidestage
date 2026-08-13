import type { Server as SocketIOServer } from "socket.io";

export interface ChatCommentPayload {
  streamerId: string;
  uniqueId: string;
  nickname: string;
  profilePictureUrl: string | null;
  comment: string;
  receivedAt: string; // ISO8601
}

// server.js が生成した socket.io サーバーへの参照。overlay.ts と同じ global 経由パターン。
const g = global as typeof globalThis & { __io?: SocketIOServer };

// Android/iOSアプリ向けのコメント配信。overlayと違いDB保存・間引きは行わず、
// 受信したチャットイベントをそのまま `chat:${streamerId}` ルームへ流す。
export async function emitChatComment(payload: ChatCommentPayload): Promise<void> {
  g.__io?.to(`chat:${payload.streamerId}`).emit("chat:comment", payload);
}
