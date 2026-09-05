const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

/**
 * LINE Messaging APIのpush messageで1通送る。
 *
 * 環境変数未設定・送信失敗のいずれもエラーを投げずログのみで済ませる
 * (event-workerの他のtickと同じく、通知の失敗で集計ループ自体を止めない方針)。
 */
export async function sendLineMessage(text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_ALERT_TARGET_ID;

  if (!token || !to) {
    console.warn("[db-stats] LINE_CHANNEL_ACCESS_TOKEN/LINE_ALERT_TARGET_ID未設定のため通知をスキップ");
    return;
  }

  try {
    const res = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[db-stats] LINE通知の送信に失敗(${res.status}): ${body}`);
    }
  } catch (err) {
    console.error("[db-stats] LINE通知の送信でエラー:", err);
  }
}
