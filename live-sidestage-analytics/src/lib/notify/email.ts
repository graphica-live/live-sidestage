const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Resend APIでメールを1通送る。
 *
 * 環境変数未設定・送信失敗のいずれもエラーを投げずログのみで済ませる
 * (event-workerの他のtickと同じく、通知の失敗で集計ループ自体を止めない方針)。
 */
export async function sendAlertEmail(subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.DB_STATS_ALERT_EMAIL_FROM;
  const to = process.env.DB_STATS_ALERT_EMAIL_TO;

  if (!apiKey || !from || !to) {
    console.warn("[db-stats] RESEND_API_KEY/DB_STATS_ALERT_EMAIL_FROM/DB_STATS_ALERT_EMAIL_TO未設定のため通知をスキップ");
    return;
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, subject, text }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[db-stats] メール通知の送信に失敗(${res.status}): ${body}`);
    }
  } catch (err) {
    console.error("[db-stats] メール通知の送信でエラー:", err);
  }
}
