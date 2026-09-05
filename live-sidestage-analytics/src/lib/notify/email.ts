const RESEND_API_URL = "https://api.resend.com/emails";

export type EmailInlineImage = {
  /** htmlの`<img src="cid:...">`と対応させるID。 */
  contentId: string;
  filename: string;
  content: Buffer;
};

export type AlertEmail = {
  subject: string;
  text: string;
  /** 省略時はtextのみのプレーンメールを送る。 */
  html?: string;
  /** htmlのcid参照に対応する埋め込み画像。 */
  inlineImages?: EmailInlineImage[];
};

/**
 * Resend APIでメールを1通送る。html+埋め込み画像(cid参照)にも対応する。
 *
 * 環境変数未設定・送信失敗のいずれもエラーを投げずログのみで済ませる
 * (event-workerの他のtickと同じく、通知の失敗で集計ループ自体を止めない方針)。
 */
export async function sendAlertEmail(email: AlertEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.DB_STATS_ALERT_EMAIL_FROM;
  const to = process.env.DB_STATS_ALERT_EMAIL_TO;

  if (!apiKey || !from || !to) {
    console.warn("[db-stats] RESEND_API_KEY/DB_STATS_ALERT_EMAIL_FROM/DB_STATS_ALERT_EMAIL_TO未設定のため通知をスキップ");
    return;
  }

  const attachments = email.inlineImages?.map((img) => ({
    filename: img.filename,
    content: img.content.toString("base64"),
    content_id: img.contentId,
  }));

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject: email.subject,
        text: email.text,
        ...(email.html ? { html: email.html } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[db-stats] メール通知の送信に失敗(${res.status}): ${body}`);
    }
  } catch (err) {
    console.error("[db-stats] メール通知の送信でエラー:", err);
  }
}
