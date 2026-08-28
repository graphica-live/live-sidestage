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

    await ensureAvatarCached("battle_host", "anchor1", ALLOWED_URL);

    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("行が無ければダウンロード・圧縮してアップロードし、upsertする", async () => {
    findUnique.mockResolvedValue(null);
    mockFetchOnce({ ok: true });
    send.mockResolvedValue({});

    await ensureAvatarCached("battle_host", "anchor1", ALLOWED_URL);

    expect(fetch).toHaveBeenCalledWith(ALLOWED_URL, expect.objectContaining({ redirect: "error" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kind_subjectId: { kind: "battle_host", subjectId: "anchor1" } },
        create: expect.objectContaining({ kind: "battle_host", subjectId: "anchor1" }),
      })
    );
  });

  it("許可されていないホストのURLはfetchせずスキップする", async () => {
    findUnique.mockResolvedValue(null);
    mockFetchOnce({ ok: true });

    await ensureAvatarCached("gift_sender", "user1", "https://evil.example/a.png");

    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("sourceUrlがnullなら何もしない", async () => {
    await ensureAvatarCached("gift_sender", "user1", null);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it("subjectIdが不正な形式(キー生成に使えない文字)ならスキップする", async () => {
    await ensureAvatarCached("gift_sender", "../etc/passwd", ALLOWED_URL);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it("同じsubjectIdへの2回目の呼び出しはスロットリングされfetchしない", async () => {
    findUnique.mockResolvedValue(null);
    mockFetchOnce({ ok: true });
    send.mockResolvedValue({});

    await ensureAvatarCached("battle_host", "anchor-throttle", ALLOWED_URL);
    expect(fetch).toHaveBeenCalledTimes(1);

    await ensureAvatarCached("battle_host", "anchor-throttle", ALLOWED_URL);
    expect(fetch).toHaveBeenCalledTimes(1); // 増えない
  });

  it("Content-Typeが画像系以外ならアップロードしない", async () => {
    findUnique.mockResolvedValue(null);
    mockFetchOnce({ ok: true, contentType: "text/html" });

    await ensureAvatarCached("battle_host", "anchor-bad-ct", ALLOWED_URL);

    expect(send).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("MEDIA_BUCKET未設定(getMediaBucketClientがnull)なら何もしない", async () => {
    vi.resetModules();
    vi.doMock("./media-bucket", () => ({ getMediaBucketClient: () => null }));
    const { ensureAvatarCached: ensureWithNoBucket } = await import("./avatar-storage");

    findUnique.mockResolvedValue(null);
    mockFetchOnce({ ok: true });

    await ensureWithNoBucket("battle_host", "anchor-no-bucket", ALLOWED_URL);

    expect(send).not.toHaveBeenCalled();
  });
});

describe("resolveAvatarUrls", () => {
  it("空配列ならDBを引かない", async () => {
    const result = await resolveAvatarUrls("battle_host", []);

    expect(result.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("ヒットした分だけpresigned URLを返す", async () => {
    findMany.mockResolvedValue([{ subjectId: "anchor1", storageKey: "avatars/battle-host/anchor1.webp" }]);

    const result = await resolveAvatarUrls("battle_host", ["anchor1", "anchor2"]);

    expect(result.get("anchor1")).toBe("https://signed.example/avatars/battle-host/anchor1.webp");
    expect(result.has("anchor2")).toBe(false);
  });
});
