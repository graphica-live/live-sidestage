export async function verifyTikTokProfile(
  tiktokId: string,
  code: string
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://www.tiktok.com/@${tiktokId}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 404) {
      return { ok: false, error: "TikTokアカウントが見つかりません" };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `TikTokページ取得失敗 (${response.status})`,
      };
    }

    const html = await response.text();

    if (!html.includes("tiktok")) {
      return { ok: false, error: "TikTokページの取得に失敗しました。再度お試しください" };
    }

    if (html.includes(code)) {
      return { ok: true };
    }

    return {
      ok: false,
      error: "プロフィールに認証コードが見つかりませんでした。bioに正確に記載されているか確認してください",
    };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, error: "タイムアウト。再度お試しください" };
    }
    return { ok: false, error: "通信エラーが発生しました" };
  }
}

export function generateVerificationCode(): string {
  const digits = Math.floor(1000 + Math.random() * 9000).toString();
  return `LIVE-${digits}-VERIFY`;
}
