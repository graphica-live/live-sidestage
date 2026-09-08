import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const upsert = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tiktokAvatarAsset: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      upsert: (...args: unknown[]) => upsert(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

const send = vi.fn();
vi.mock("./media-bucket", () => ({
  getMediaBucketClient: () => ({ client: { send: (...args: unknown[]) => send(...args) }, bucket: "test-bucket" }),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_client: unknown, command: { input: { Key: string } }) =>
    `https://signed.example/${command.input.Key}`
  ),
}));

vi.mock("sharp", () => ({
  default: () => ({
    resize: () => ({
      webp: () => ({
        toBuffer: async () => Buffer.from("compressed-image"),
      }),
    }),
  }),
}));

// tiktok-profile.ts の isAllowedAvatarUrl は実装をそのまま使う(https + ホスト許可リストの
// 検証ロジック自体がテスト対象の一部であるため、モックしない)。

import { ensureAvatarCached, resolveAvatarUrls } from "./avatar-storage";

const ALLOWED_URL = "https://p16-common-sign.tiktokcdn.com/a.webp";

// 主体は tiktokUid(不変の数値ID)1種類。テストごとにスロットリングの状態を分けるため
// (throttleマップはモジュール内で共有される)、呼び出しごとに別のuidを使う。
const UID_FRESH = "7000000000000000101";
const UID_UPLOAD = "7000000000000000102";
const UID_DISALLOWED_URL = "7000000000000000103";
const UID_NULL_URL = "7000000000000000104";
const UID_THROTTLE = "7000000000000000105";
const UID_BAD_CONTENT_TYPE = "7000000000000000106";
const UID_NO_BUCKET = "7000000000000000107";

function mockFetchOnce(init: { ok: boolean; contentType?: string; bodyBytes?: number }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: init.ok,
      headers: { get: (name: string) => (name === "content-type" ? init.contentType ?? "image/webp" : null) },
      arrayBuffer: async () => new ArrayBuffer(init.bodyBytes ?? 100),
    }))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ensureAvatarCached", () => {
  it("30日以内にfetchedAt済みの行があれば何もしない", async () => {
    findUnique.mockResolvedValue({ fetchedAt: new Date() });
    mockFetchOnce({ ok: true });

    await ensureAvatarCached(UID_FRESH, ALLOWED_URL);

    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("行が無ければダウンロード・圧縮してアップロードし、upsertする", async () => {
    findUnique.mockResolvedValue(null);
    mockFetchOnce({ ok: true });
    send.mockResolvedValue({});

    await ensureAvatarCached(UID_UPLOAD, ALLOWED_URL);

    expect(fetch).toHaveBeenCalledWith(ALLOWED_URL, expect.objectContaining({ redirect: "error" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tiktokUid: UID_UPLOAD },
        create: expect.objectContaining({ tiktokUid: UID_UPLOAD }),
      })
    );
  });

  it("許可されていないホストのURLはfetchせずスキップする", async () => {
    findUnique.mockResolvedValue(null);
    mockFetchOnce({ ok: true });

    await ensureAvatarCached(UID_DISALLOWED_URL, "https://evil.example/a.png");

    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("sourceUrlがnullなら何もしない", async () => {
    await ensureAvatarCached(UID_NULL_URL, null);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it("tiktokUidが不正な形式(キー生成に使えない文字)ならスキップする", async () => {
    await ensureAvatarCached("../etc/passwd", ALLOWED_URL);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it("同じtiktokUidへの2回目の呼び出しはスロットリングされfetchしない", async () => {
    findUnique.mockResolvedValue(null);
    mockFetchOnce({ ok: true });
    send.mockResolvedValue({});

    await ensureAvatarCached(UID_THROTTLE, ALLOWED_URL);
    expect(fetch).toHaveBeenCalledTimes(1);

    await ensureAvatarCached(UID_THROTTLE, ALLOWED_URL);
    expect(fetch).toHaveBeenCalledTimes(1); // 増えない
  });

  it("Content-Typeが画像系以外ならアップロードしない", async () => {
    findUnique.mockResolvedValue(null);
    mockFetchOnce({ ok: true, contentType: "text/html" });

    await ensureAvatarCached(UID_BAD_CONTENT_TYPE, ALLOWED_URL);

    expect(send).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("MEDIA_BUCKET未設定(getMediaBucketClientがnull)なら何もしない", async () => {
    vi.resetModules();
    vi.doMock("./media-bucket", () => ({ getMediaBucketClient: () => null }));
    const { ensureAvatarCached: ensureWithNoBucket } = await import("./avatar-storage");

    findUnique.mockResolvedValue(null);
    mockFetchOnce({ ok: true });

    await ensureWithNoBucket(UID_NO_BUCKET, ALLOWED_URL);

    expect(send).not.toHaveBeenCalled();
  });
});

describe("resolveAvatarUrls", () => {
  it("空配列ならDBを引かない", async () => {
    const result = await resolveAvatarUrls([]);

    expect(result.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("ヒットした分だけpresigned URLを返す", async () => {
    findMany.mockResolvedValue([
      { tiktokUid: UID_UPLOAD, storageKey: `avatars/tiktok-user/${UID_UPLOAD}.webp` },
    ]);

    const result = await resolveAvatarUrls([UID_UPLOAD, UID_FRESH]);

    expect(result.get(UID_UPLOAD)).toBe(`https://signed.example/avatars/tiktok-user/${UID_UPLOAD}.webp`);
    expect(result.has(UID_FRESH)).toBe(false);
  });
});
