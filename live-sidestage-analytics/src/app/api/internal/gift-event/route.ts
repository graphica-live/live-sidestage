import { NextRequest, NextResponse } from "next/server";
import { appendGiftLog, type GiftLogEntry } from "@/lib/tiktok-listener";
import { emitGiftDrivenOverlayUpdates } from "@/lib/overlay";
import { applyLikeEventInProcess } from "@/lib/overlay/like.server";
import {
  emitChatBattle,
  emitChatComment,
  emitChatFollow,
  emitChatGift,
  emitChatListener,
  type ChatBattleInput,
  type ChatCommentPayload,
  type ChatFollowInput,
  type ChatGiftInput,
  type ChatListenerInput,
} from "@/lib/chat-feed";

// Worker(worker.js)からWeb(server.js/global.__io)へgift/chatイベントを転送するための内部API。
// Railway private networking経由でのみ叩かれる想定 — INTERNAL_API_SECRET必須。
//
// 受理する形はunionで、旧Workerが送っている3種
//   { logEntry } / { streamerId, emitOverlay } / { streamerId, chatEvent }
// を必ず受け付け続けること。デプロイ順は Web route → Worker なので、
// 新しいWebが動き始めた時点ではまだ旧Workerが生きている。ここを厳格化すると
// 移行中だけイベントが静かに落ちる。

const MAX_STRING_LENGTH = 500;
const MAX_STREAMER_IDS = 200;
// TikTokのコンボは実際には数百程度だが、壊れた入力で巨大なdeltaが出ないよう上限を置く。
const MAX_REPEAT_COUNT = 100_000;
const MAX_DIAMOND_COUNT = 10_000_000;
// Worker側で1秒コアレッシングしてから送られてくるlikeCount(合算値)の上限ガード。
const MAX_LIKE_COUNT = 100_000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_STRING_LENGTH;
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= MAX_STRING_LENGTH);
}

function isBoundedInt(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

function parseStreamerIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STREAMER_IDS) return null;
  if (!value.every(isNonEmptyString)) return null;
  return value as string[];
}

function parseGiftEvent(value: unknown): Omit<ChatGiftInput, "streamerId"> | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.uniqueId)) return null;
  if (typeof v.nickname !== "string" || v.nickname.length > MAX_STRING_LENGTH) return null;
  if (!isOptionalString(v.profilePictureUrl)) return null;
  if (typeof v.giftName !== "string" || v.giftName.length > MAX_STRING_LENGTH) return null;
  if (!isOptionalString(v.giftId)) return null;
  if (!isBoundedInt(v.diamondCount, MAX_DIAMOND_COUNT)) return null;
  if (!isBoundedInt(v.repeatCount, MAX_REPEAT_COUNT)) return null;
  if (typeof v.isCombo !== "boolean" || typeof v.repeatEnd !== "boolean") return null;
  if (!isOptionalString(v.groupId) || !isOptionalString(v.orderId) || !isOptionalString(v.msgId)) return null;
  if (!isNonEmptyString(v.occurredAt) || !isNonEmptyString(v.receivedAt)) return null;

  return {
    uniqueId: v.uniqueId,
    nickname: v.nickname,
    profilePictureUrl: v.profilePictureUrl,
    giftName: v.giftName,
    giftId: v.giftId,
    diamondCount: v.diamondCount,
    repeatCount: v.repeatCount,
    isCombo: v.isCombo,
    repeatEnd: v.repeatEnd,
    groupId: v.groupId,
    orderId: v.orderId,
    msgId: v.msgId,
    occurredAt: v.occurredAt,
    receivedAt: v.receivedAt,
  };
}

function parseFollowEvent(value: unknown): Omit<ChatFollowInput, "streamerId"> | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.uniqueId)) return null;
  if (typeof v.nickname !== "string" || v.nickname.length > MAX_STRING_LENGTH) return null;
  if (!isOptionalString(v.profilePictureUrl)) return null;
  if (!isNonEmptyString(v.occurredAt) || !isNonEmptyString(v.receivedAt)) return null;
  if (!isOptionalString(v.msgId)) return null;

  return {
    uniqueId: v.uniqueId,
    nickname: v.nickname,
    profilePictureUrl: v.profilePictureUrl,
    occurredAt: v.occurredAt,
    receivedAt: v.receivedAt,
    msgId: v.msgId,
  };
}

function parseLikeEvent(value: unknown): {
  roomId: string;
  uniqueId: string;
  nickname: string;
  profilePictureUrl: string | null;
  likeCount: number;
} | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.roomId)) return null;
  if (!isNonEmptyString(v.uniqueId)) return null;
  if (typeof v.nickname !== "string" || v.nickname.length > MAX_STRING_LENGTH) return null;
  if (!isOptionalString(v.profilePictureUrl)) return null;
  if (!isBoundedInt(v.likeCount, MAX_LIKE_COUNT)) return null;

  return {
    roomId: v.roomId,
    uniqueId: v.uniqueId,
    nickname: v.nickname,
    profilePictureUrl: v.profilePictureUrl,
    likeCount: v.likeCount,
  };
}

function parseBattleEvent(value: unknown): Omit<ChatBattleInput, "streamerId"> | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.battleId)) return null;
  if (!isNonEmptyString(v.startedAt)) return null;
  if (!isNonEmptyString(v.endedAt)) return null;
  if (!isNonEmptyString(v.receivedAt)) return null;

  return {
    battleId: v.battleId,
    startedAt: v.startedAt,
    endedAt: v.endedAt,
    receivedAt: v.receivedAt,
  };
}

function parseListenerEvent(value: unknown): Omit<ChatListenerInput, "streamerId"> | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.roomId)) return null;
  // revision は bigint を JSON に載せられないので10進文字列。端末はこれで新旧を判定するので、
  // 形式が違うものは通さない(壊れた値を通すと順序判定が壊れる)。
  if (!isNonEmptyString(v.revision) || !/^\d{1,30}$/.test(v.revision)) return null;
  if (!isNonEmptyString(v.status)) return null;
  if (!isNonEmptyString(v.activity)) return null;
  if (!isNonEmptyString(v.health)) return null;
  if (!isOptionalString(v.reason)) return null;
  if (typeof v.message !== "string" || v.message.length > MAX_STRING_LENGTH) return null;
  if (!isNonEmptyString(v.updatedAt)) return null;

  return {
    roomId: v.roomId,
    revision: v.revision,
    status: v.status,
    activity: v.activity,
    health: v.health,
    reason: v.reason,
    message: v.message,
    updatedAt: v.updatedAt,
  };
}

export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_API_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    streamerId?: string;
    streamerIds?: string[];
    logEntry?: GiftLogEntry;
    emitOverlay?: boolean;
    chatEvent?: ChatCommentPayload;
    chatGiftEvent?: unknown;
    chatFollowEvent?: unknown;
    listenerEvent?: unknown;
    likeEvent?: unknown;
    battleEvent?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // --- 旧Workerも送ってくる3種(形は変えない) ---
  if (body.logEntry) {
    appendGiftLog(body.logEntry);
  }

  if (body.emitOverlay && body.streamerId) {
    await emitGiftDrivenOverlayUpdates(body.streamerId).catch((err) =>
      console.error("[internal/gift-event] overlay emit error:", err)
    );
  }

  if (body.chatEvent) {
    const delivered = await emitChatComment(body.chatEvent).catch((err) => {
      console.error("[internal/gift-event] chat emit error:", err);
      return true;
    });
    if (!delivered) return ioUnavailable();
  }

  // --- 新Workerのみが送る2種 ---
  if (body.chatGiftEvent !== undefined) {
    const streamerIds = parseStreamerIds(body.streamerIds);
    const gift = parseGiftEvent(body.chatGiftEvent);
    if (!streamerIds || !gift) {
      return NextResponse.json({ error: "Invalid chatGiftEvent" }, { status: 400 });
    }
    for (const streamerId of streamerIds) {
      const delivered = await emitChatGift({ streamerId, ...gift }).catch((err) => {
        console.error("[internal/gift-event] gift emit error:", err);
        return true;
      });
      if (!delivered) return ioUnavailable();
    }
  }

  if (body.chatFollowEvent !== undefined) {
    const streamerIds = parseStreamerIds(body.streamerIds);
    const follow = parseFollowEvent(body.chatFollowEvent);
    if (!streamerIds || !follow) {
      return NextResponse.json({ error: "Invalid chatFollowEvent" }, { status: 400 });
    }
    for (const streamerId of streamerIds) {
      const delivered = await emitChatFollow({ streamerId, ...follow }).catch((err) => {
        console.error("[internal/gift-event] follow emit error:", err);
        return true;
      });
      if (!delivered) return ioUnavailable();
    }
  }

  // listener の接続状態(モバイルの「配信中 / 配信開始待ち」表示用)。
  // ギフト/フォローと違い dedup しない — 後から購読した端末へ現在値を送り直すために
  // 同じ値の再送が要る。
  if (body.listenerEvent !== undefined) {
    const streamerIds = parseStreamerIds(body.streamerIds);
    const listener = parseListenerEvent(body.listenerEvent);
    if (!streamerIds || !listener) {
      return NextResponse.json({ error: "Invalid listenerEvent" }, { status: 400 });
    }
    for (const streamerId of streamerIds) {
      const delivered = await emitChatListener({ streamerId, ...listener }).catch((err) => {
        console.error("[internal/gift-event] listener emit error:", err);
        return true;
      });
      if (!delivered) return ioUnavailable();
    }
  }

  // いいね(desktop 5ウィジェット移植分)。streamerIdsは購読中の全員(streamerIdごとに
  // 複製して呼ばない — LikeTallyはroomId軸で共有されるため、複製すると合計が
  // 購読者数倍になる)。
  if (body.likeEvent !== undefined) {
    const streamerIds = parseStreamerIds(body.streamerIds);
    const like = parseLikeEvent(body.likeEvent);
    if (!streamerIds || !like) {
      return NextResponse.json({ error: "Invalid likeEvent" }, { status: 400 });
    }
    await applyLikeEventInProcess({ streamerIds, ...like }).catch((err) =>
      console.error("[internal/gift-event] like apply error:", err)
    );
  }

  // バトル終了(またはEND後のスコア確定)の即時表示トリガー。detailsは積まず、
  // 端末はこれをきっかけにバトル履歴を再取得する。dedupしない(chat:listenerと同じ流儀)。
  if (body.battleEvent !== undefined) {
    const streamerIds = parseStreamerIds(body.streamerIds);
    const battle = parseBattleEvent(body.battleEvent);
    if (!streamerIds || !battle) {
      return NextResponse.json({ error: "Invalid battleEvent" }, { status: 400 });
    }
    for (const streamerId of streamerIds) {
      const delivered = await emitChatBattle({ streamerId, ...battle }).catch((err) => {
        console.error("[internal/gift-event] battle emit error:", err);
        return true;
      });
      if (!delivered) return ioUnavailable();
    }
  }

  return NextResponse.json({ ok: true });
}

// socket.ioサーバーがまだ立っていない(Next側だけ先に応答可能になった)状態。
// 200を返すとWorkerは成功したと解釈して再送しないため、明示的に失敗を返す。
function ioUnavailable() {
  return NextResponse.json({ error: "socket.io server not ready" }, { status: 503 });
}
