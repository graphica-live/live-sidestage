// TikTok LIVEのコラボ(linkMic。バトルでない通常のマルチゲスト配信)への参加を検出するための
// payload解釈。ここは純粋関数だけ。DB書き込み(監視対象への追加)はtiktok-listener.tsが行う。
//
// 調査知見の正本は `~/.claude/skills/tiktok-probe/KNOWLEDGE.md`。
//
// `WebcastLinkLayerMessage`(legacy client の `linkLayer` イベント。fork独自追加、
// shared/tiktok-live-connector/CHANGELOG.md 1.1.0参照)の `messageType:18`
// (`LinkLayerMessageType.Linker_Group_Change`)が、コラボメンバーリストの変化(参加・離脱)を示す。
// `source`フィールドは`"ベース文字列"`または`"ベース文字列[REPLY_STATUS_xxx]"`という文字列連結
// 形式で、参加確定時のみ`REPLY_STATUS_AGREE`を含む(離脱は`"live_end"`等、別の値)。
//
// **このメッセージは「誰が参加したか」を差分で教えてくれない。** `businessContent.cohostContent.
// listChangeBizContent.userInfos`は受信時点のコラボメンバー全員(配信主own含む)のスナップショット。
// 新規参加者だけを狙って特定するより、参加確定イベントを受けるたびに「その時点の全メンバー
// (自分以外)」を監視対象に入れる方が単純かつ安全(取りこぼしにくい。ensureRoomWatchedForCollab()は
// 冪等なので、既に監視中のメンバーへの再呼び出しは無害)。

const GROUP_CHANGE_MESSAGE_TYPE = 18; // LinkLayerMessageType.Linker_Group_Change

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** `source`に参加確定(招待への承諾)を示す値が含まれるか。 */
export function isCollabJoinSource(source: unknown): boolean {
  return typeof source === "string" && source.includes("REPLY_STATUS_AGREE");
}

export type CollabGroupChange = {
  source: string;
  /** コラボメンバー(配信主own含む)のTikTokハンドル一覧。取れなかった要素は含めない。 */
  displayIds: string[];
};

/**
 * `linkLayer`イベントのpayloadを解釈する。`messageType:18`(groupChangeContent)以外はnullを返す。
 */
export function parseCollabGroupChange(data: unknown): CollabGroupChange | null {
  const record = asRecord(data);
  if (!record) return null;

  if (Number(record.messageType) !== GROUP_CHANGE_MESSAGE_TYPE) return null;

  const source = typeof record.source === "string" ? record.source : "";

  const businessContent = asRecord(record.businessContent);
  const cohostContent = asRecord(businessContent?.cohostContent);
  const listChangeBizContent = asRecord(cohostContent?.listChangeBizContent);
  const userInfos = asRecord(listChangeBizContent?.userInfos);

  const displayIds: string[] = [];
  if (userInfos) {
    for (const info of Object.values(userInfos)) {
      const user = asRecord(info);
      const displayId = user ? nonEmptyString(user.displayId) : null;
      if (displayId !== null && !displayIds.includes(displayId)) displayIds.push(displayId);
    }
  }

  return { source, displayIds };
}
