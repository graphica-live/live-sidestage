// 開催準備チェック。**「開催中にする」を押せる状態かどうか**を1箇所で決める。
//
// トーナメント表を作らないまま開催中にすると、バトルの自動検知が一切動かないまま
// イベントが進む(検知の対象は `EventMatch` なので、表が無ければ候補すら無い)。
// 出場者がいないまま開催中にすると、集計は回るのに順位表が空のまま公開される。
// どちらも主催者が開催後に気づくので、遷移の時点で止める。
//
// **判定は純粋関数、DB からの数え方は `loadReadinessInput()` に集約する。**
// API のゲートと管理画面の残タスク表示が同じ判定・同じクエリを見るようにするため。
//
// **これはベストエフォートのゲートで、開催中も維持される不変条件ではない。**
// 参加者の削除・チームの削除は同じ advisory lock を取らないので、遷移の直後に
// 出場者が2組未満へ減ることはありうる。もともと「開催中に参加者を追加・削除できる」
// のは仕様(集計は毎回全期間を計算し直す)なので、ここで守るのは
// 「開催中にした時点で明らかに不完全ではない」ことだけ。

import type { DbClient } from "./analytics-db";
import type { EntryMode, EventFormat } from "./validation";

// 公開範囲(visibility)はここに入れていない。作成UIが廃止されて**常に PUBLIC で作られる**ため、
// 「非公開だから公開にする」は主催者が操作できるタスクにならない
// (非公開のまま残っている旧イベントへの注記は EventAdminControls の privateNotice が出す)。
//
// 開催日程も入れていない。日程を1件も持たない旧イベントは `resolveEventWindows()` が
// 外枠を1日程として扱うので、**日程0件でも集計も検知も動く**(sessions.ts)。
// ここで止めると、その旧イベントを開催準備中へ戻したとき二度と開催中にできなくなる。
export type ReadinessTaskKey = "ENTRANTS" | "BRACKET" | "MATCHES";

export type ReadinessTask = {
  key: ReadinessTaskKey;
  /** 一覧に出す行。命令形にする(「〜する」) */
  label: string;
  /** なぜ必要か。1文 */
  detail: string;
  /** クリックしたときの遷移先 */
  href: string;
  /** true = これが残っている間は RUNNING へ遷移できない */
  blocking: boolean;
};

export type ReadinessInput = {
  eventId: string;
  format: EventFormat;
  entryMode: EntryMode;
  /**
   * 実際に出場できるエントリーの数。
   * 個人戦なら ACTIVE な参加者の数、チーム戦なら **ACTIVE なメンバーを持つ**チームの数。
   *
   * メンバーのいないチームを数に入れない理由は `createBracket()` と同じ —
   * サイドの room が空になり、バトルの検知(room 集合の一致)が永久に成立しないため。
   * 逆に、表に使わない空のチームが1つあるだけで開催を止めることもない。
   */
  eligibleEntrantCount: number;
  /** EventMatch の件数(status を問わない) */
  matchCount: number;
};

/**
 * 開催に必要なエントリー数。
 *
 * 対戦する種目は2組ないと組み合わせが作れない(`createBracket` も
 * `TOO_FEW_ENTRANTS` で弾く)。獲得ダイヤレースは対戦しないので1組でも成立する。
 */
export function requiredEntrantCount(format: EventFormat): number {
  return format === "DIAMOND_RACE" ? 1 : 2;
}

/**
 * 開催までに残っているタスクを、着手する順に並べて返す。
 *
 * 空配列 = 残タスク無し。`blocking: true` が1件でもあれば「開催中にする」は通さない。
 */
export function evaluateEventReadiness(input: ReadinessInput): ReadinessTask[] {
  const { eventId, format, entryMode, eligibleEntrantCount, matchCount } = input;
  const tasks: ReadinessTask[] = [];
  const required = requiredEntrantCount(format);
  const participantsHref = `/events/${eventId}/participants`;
  const matchesHref = `/events/${eventId}/matches`;

  if (eligibleEntrantCount < required) {
    tasks.push(
      entryMode === "TEAM"
        ? {
            key: "ENTRANTS",
            label: `参加者のいるチームを${required}組以上そろえる`,
            detail: `いまは${eligibleEntrantCount}組。メンバーが1人もいないチームは出場できない(対戦を検知できない)。`,
            href: participantsHref,
            blocking: true,
          }
        : {
            key: "ENTRANTS",
            label: `参加者を${required}人以上登録する`,
            detail: `いまは${eligibleEntrantCount}人。登録した参加者の配信だけが監視・集計の対象になる。`,
            href: participantsHref,
            blocking: true,
          }
    );
  }

  if (format === "TOURNAMENT" && matchCount === 0) {
    tasks.push({
      key: "BRACKET",
      label: "トーナメント表を作る",
      detail: "表が無いとバトルの自動検知も勝敗の確定も動かない。",
      href: matchesHref,
      blocking: true,
    });
  }

  // デスマッチの対戦カードは開催中に随時足す運用なので、開催そのものは止めない。
  if (format === "DEATHMATCH" && matchCount === 0) {
    tasks.push({
      key: "MATCHES",
      label: "対戦カードを組む",
      detail: "対戦は開催中にも追加できる。組むまで勝敗もライフも動かない。",
      href: matchesHref,
      blocking: false,
    });
  }

  return tasks;
}

export function blockingReadinessTasks(tasks: ReadinessTask[]): ReadinessTask[] {
  return tasks.filter((t) => t.blocking);
}

/**
 * 判定に要る数を DB から集める。**API のゲートと画面表示で同じクエリを使う。**
 *
 * API 側はステータス更新と同じトランザクション(= advisory lock の内側)から呼ぶこと。
 */
export async function loadReadinessInput(
  db: DbClient,
  event: { id: string; format: string; entryMode: string }
): Promise<ReadinessInput> {
  const entryMode = event.entryMode === "TEAM" ? "TEAM" : "SOLO";

  const [eligibleEntrantCount, matchCount] = await Promise.all([
    entryMode === "TEAM"
      ? // ACTIVE なメンバーを1人以上持つチームだけを数える。
        db.eventTeam.count({
          where: { eventId: event.id, participants: { some: { status: "ACTIVE" } } },
        })
      : db.eventParticipant.count({ where: { eventId: event.id, status: "ACTIVE" } }),
    db.eventMatch.count({ where: { eventId: event.id } }),
  ]);

  return {
    eventId: event.id,
    // 未知の種目は「対戦する種目」として扱う(required=2)。緩い側へ倒さない。
    format: event.format as EventFormat,
    entryMode,
    eligibleEntrantCount,
    matchCount,
  };
}
