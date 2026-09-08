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
// listChangeBizContent.userInfos`は受信時点のスナップショットだが、**参加確定した人(LINKED)だけでなく
// 招待送信済みでまだ返事の無い人(WAITING)も含む**。probeログ169件の実測で、`userInfos`の要素数は
// `groupChangeContent.groupUser.userList`のstatus:3(LINKED)+status:1(WAITING)の件数と167件で一致した。
// **`userList`のエントリは`channelId`キーで`userInfos`のtiktokUidと対応付けられない**ため、
// 「誰がLINKEDか」を個人単位で判別する手段はこのメッセージ単体には無い。使えるのは件数の一致だけ。
//
// したがって`userInfos`を無条件に監視対象へ入れると、招待を送っただけの相手(承諾していない、
// そもそもコラボしない)まで接続対象になる。TikTok接続はプロキシ枠とEulerStream署名枠を消費する
// 有限リソースなので、これは資源の暴走に直結する(実測: おすすめリストから連続招待する配信者で
// 15分に20〜30room)。判定は`shouldWatchCollabSnapshot()`に集約してある。

const GROUP_CHANGE_MESSAGE_TYPE = 18; // LinkLayerMessageType.Linker_Group_Change

/**
 * `groupChangeContent.groupUser.userList[].status`(proto の `GroupStatus`)。
 * 実測で観測できたのはこの2値だけだが、proto には `GROUP_STATUS_UNKNOWN = 0` もある。
 */
const LINK_STATUS_WAITING = 1; // 招待送信済み・返事待ち
const LINK_STATUS_LINKED = 3; // 参加確定

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * `userInfos`のキー(tiktokUid)の正規化。`src/lib/tiktok-user.ts`の`normalizeTikTokUserId()`と
 * 同一の判定だが、このファイルはprismaを引かないpureなパーサとして保つためインライン化してある
 * (`"0"`はprotobuf proto3の既定値なので欠落と同義)。
 */
function normalizeUidKey(value: string): string | null {
  if (!/^\d{1,32}$/.test(value)) return null;
  if (value === "0") return null;
  return value;
}

/** `source`に参加確定(招待への承諾)を示す値が含まれるか。 */
export function isCollabJoinSource(source: unknown): boolean {
  return typeof source === "string" && source.includes("REPLY_STATUS_AGREE");
}

/**
 * `userInfos`の1エントリ。キーがtiktokUid(不変の数値ID)、値に`displayId`(= tiktokHandle)と
 * `nickname`が入っている。uidとハンドルが同じオブジェクトに揃っているので、対応付けのずれは
 * 構造的に起きない。
 */
export type CollabSubject = {
  tiktokUid: string;
  tiktokHandle: string;
  nickname: string | null;
};

export type CollabGroupChange = {
  source: string;
  /**
   * `userInfos`に載っていた参加者一覧(配信主own含む)。uidまたはdisplayIdが取れなかった要素は
   * 含めない。**参加確定した人だけでなく招待中の人も混ざる**(冒頭コメント参照)。
   */
  subjects: CollabSubject[];
  /** `userList`のstatus:3(LINKED = 参加確定)の件数。`userList`が取れなければ0。 */
  linkedCount: number;
  /** `userList`のstatus:1(WAITING = 招待送信済みで返事待ち)の件数。`userList`が取れなければ0。 */
  waitingCount: number;
  /** LINKEDでもWAITINGでもないstatus(`GROUP_STATUS_UNKNOWN`・未定義値・将来値)の件数。 */
  otherCount: number;
};

/**
 * この`messageType:18`の`userInfos`を、そのまま監視対象として採用してよいか。
 *
 * **`userList`が全員LINKED**なら`userInfos`は参加確定メンバーと一致するので、`source`の値によらず安全に
 * 全員採用できる(`live_end` / `click_quick_leave_button` / `""` / `"1"` など未文書化の値も拾える)。
 * `source`を限定列挙しないのは、実測でAGREEが全体の8%しかなく、参加が別の`source`で初めて観測される
 * ケースが33%あったため(承諾イベントを取り逃すと相手roomをバトル開始まで発見できない)。
 *
 * 「WAITINGが0」ではなく「**LINKED以外が0**」で判定する。protoには`GROUP_STATUS_UNKNOWN = 0`があり、
 * 未知のstatus(将来TikTokが中間状態へ新しい値を使う場合を含む)をWAITING扱いにしないと、
 * 招待中の相手を全員接続する暴走側へ倒れる。`displayIds`がLINKED件数より多い場合も同様に採用しない
 * (`userInfos`にuserListへ居ない人が混ざる実例あり。`displayIds`は重複除去と空文字除去で
 * 小さくなる方向にしかずれないので、多い=余分な人が居る)。
 *
 * 上記に当てはまらない場合は誰が確定メンバーか判別できないので、承諾(`REPLY_STATUS_AGREE`)を含む
 * イベントだけ従来どおり通す(既存動作の互換)。`userList`が取れないpayload構造の変化も同じ扱いで
 * **fail-closed**。構造・値が変わったときに資源の暴走側へ倒れないことを優先する。
 */
export function shouldWatchCollabSnapshot(parsed: CollabGroupChange): boolean {
  if (parsed.subjects.length === 0) return false;
  const allLinked =
    parsed.linkedCount > 0 &&
    parsed.waitingCount === 0 &&
    parsed.otherCount === 0 &&
    parsed.subjects.length <= parsed.linkedCount;
  if (allLinked) return true;
  return isCollabJoinSource(parsed.source);
}

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

  const subjects: CollabSubject[] = [];
  if (userInfos) {
    for (const [key, info] of Object.entries(userInfos)) {
      const tiktokUid = normalizeUidKey(key);
      if (tiktokUid === null) continue;
      const user = asRecord(info);
      const tiktokHandle = user ? nonEmptyString(user.displayId) : null;
      if (tiktokHandle === null) continue;
      if (subjects.some((s) => s.tiktokUid === tiktokUid)) continue;
      subjects.push({
        tiktokUid,
        tiktokHandle,
        nickname: user ? nonEmptyString(user.nickname) : null,
      });
    }
  }

  const groupChangeContent = asRecord(record.groupChangeContent);
  const groupUser = asRecord(groupChangeContent?.groupUser);
  const userList = Array.isArray(groupUser?.userList) ? groupUser.userList : [];
  let linkedCount = 0;
  let waitingCount = 0;
  let otherCount = 0;
  for (const entry of userList) {
    const status = Number(asRecord(entry)?.status);
    if (status === LINK_STATUS_LINKED) linkedCount += 1;
    else if (status === LINK_STATUS_WAITING) waitingCount += 1;
    else otherCount += 1;
  }

  return { source, subjects, linkedCount, waitingCount, otherCount };
}
