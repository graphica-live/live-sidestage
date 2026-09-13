export const DESKTOP_EVENT_SCHEMA_VERSION = 1;

type GlobalIo = { __io?: { to: (room: string) => { emit: (event: string, payload: unknown) => void } } };

function io() {
  return (global as unknown as GlobalIo).__io;
}

export function desktopRoom(streamerId: string): string {
  return `desktop:${streamerId}`;
}

export const DESKTOP_FEED_KINDS = [
  "member",
  "share",
  "subscribe",
  "emote",
  "envelope",
  "questionNew",
  "liveIntro",
  "social",
] as const;

export type DesktopFeedKind = (typeof DESKTOP_FEED_KINDS)[number];

export function emitDesktopEvent(streamerId: string, event: string, payload: Record<string, unknown>): boolean {
  const server = io();
  if (!server) return false;
  server.to(desktopRoom(streamerId)).emit(event, {
    schemaVersion: DESKTOP_EVENT_SCHEMA_VERSION,
    streamerId,
    ...payload,
  });
  return true;
}

export function mirrorChatToDesktop(streamerId: string, chatEvent: string, payload: Record<string, unknown>): void {
  const desktopEvent = chatEvent.replace(/^chat:/, "desktop:");
  emitDesktopEvent(streamerId, desktopEvent, payload);
}

export function emitDesktopLike(
  streamerId: string,
  like: {
    tiktokUid: string;
    tiktokHandle: string;
    nickname: string;
    profilePictureUrl: string | null;
    likeCount: number;
  }
): boolean {
  return emitDesktopEvent(streamerId, "desktop:like", like);
}

export function emitDesktopFeed(
  streamerId: string,
  kind: DesktopFeedKind,
  payload: {
    tiktokUid: string;
    tiktokHandle: string;
    nickname: string;
    profilePictureUrl: string | null;
    msgId: string | null;
    text?: string;
    receivedAt: string;
  }
): boolean {
  return emitDesktopEvent(streamerId, "desktop:feed", { kind, ...payload });
}