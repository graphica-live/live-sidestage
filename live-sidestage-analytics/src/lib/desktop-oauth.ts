import { issueDesktopRefreshToken, signDesktopToken } from "@/lib/desktop-auth";

export interface DesktopAuthStreamer {
  id: string;
  tiktokHandle: string;
  verified: boolean;
}

export interface DesktopAuthUser {
  id: string;
  name: string | null;
  email: string | null;
  streamer?: DesktopAuthStreamer | null;
}

export async function desktopAuthResponseBody(user: DesktopAuthUser) {
  const refreshToken = await issueDesktopRefreshToken({
    principalId: user.id,
    streamerId: user.streamer?.id ?? null,
  });

  return {
    token: signDesktopToken({ principalId: user.id, streamerId: user.streamer?.id }),
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email },
    streamer: user.streamer
      ? {
          id: user.streamer.id,
          tiktokHandle: user.streamer.tiktokHandle,
          verified: user.streamer.verified,
        }
      : null,
    onboardingRequired: !user.streamer,
  };
}