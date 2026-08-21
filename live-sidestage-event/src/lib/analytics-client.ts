// live-sidestage-analytics の内部API クライアント。
// event が analytics に対して行う唯一の「書き込み」がこれ(room の監視要求)。
// ギフト等の読み取りは analytics-db.ts の view 経由で行う。

const LEASE_PATH = "/api/internal/event-room-lease";
// analytics 側が落ちているとき参加者登録の画面が固まらないようにする。
const TIMEOUT_MS = 10_000;

export class AnalyticsClientError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "AnalyticsClientError";
  }
}

export type RoomLease = {
  roomId: string;
  tiktokId: string;
  monitorUntil: string;
  /** analytics 側でこの room が新規作成されたか(既存 room の再利用なら false) */
  created: boolean;
};

function config(): { baseUrl: string; secret: string } {
  const baseUrl = process.env.ANALYTICS_INTERNAL_URL;
  const secret = process.env.EVENT_INTERNAL_API_SECRET;
  if (!baseUrl || !secret) {
    throw new AnalyticsClientError(
      "ANALYTICS_INTERNAL_URL と EVENT_INTERNAL_API_SECRET が設定されていない。",
      500
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), secret };
}

async function call(method: "POST" | "DELETE", body: unknown): Promise<unknown> {
  const { baseUrl, secret } = config();

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${LEASE_PATH}`, {
      method,
      headers: { "Content-Type": "application/json", "x-event-secret": secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    throw new AnalyticsClientError(
      `analytics への接続に失敗した: ${(err as Error).message}`,
      503
    );
  }

  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new AnalyticsClientError(
      payload?.error ?? `analytics が ${res.status} を返した。`,
      res.status
    );
  }
  return payload;
}

/**
 * 指定 tiktokId の room を確保し、monitorUntil まで TikTok の配信開始監視を要求する。
 * analytics 側に room がなければ新規作成される。既にある room はそのまま再利用され、
 * monitorUntil は max(既存, 要求) で更新される(他イベントの確保期間を縮めない)。
 */
export async function requestRoomLease(tiktokId: string, monitorUntil: Date): Promise<RoomLease> {
  return (await call("POST", {
    tiktokId,
    monitorUntil: monitorUntil.toISOString(),
  })) as RoomLease;
}

/**
 * 監視要求を解除する。実際の切断は analytics 側の reconcile(最大60秒)で行われ、
 * room と受信済みギフトは残る。後からその room を指定した会員登録があれば監視は再開される。
 *
 * **他のイベントがまだ同じ room を使っている場合は呼んではいけない** —
 * analytics 側の monitorUntil は1本しかないので、他イベントの確保ごと解除してしまう。
 * 呼び出し側(participants.ts)で未解放の EventRoomLease が他にないことを確認すること。
 */
export async function releaseRoomLease(roomId: string): Promise<void> {
  await call("DELETE", { roomId });
}
