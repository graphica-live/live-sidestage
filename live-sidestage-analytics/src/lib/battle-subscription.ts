/**
 * バトル履歴(BattleHistory)を確定してよい room かどうかの判定。
 *
 * 「バトル履歴を作ってよい条件」= 以下いずれか1つでも true:
 * - Streamer登録あり(streamerCount > 0)
 * - AgencyWatch登録あり(watchCount > 0)
 * - specialWatch(管理者が /admin/workers から手動ON、または ensureRoomWatchedByAdmin
 *   が管理者手動追加時に自動セット)
 * - monitorUntil が未来(イベント参加中)
 *
 * いずれにも該当しない room(コラボ検知・battle_start検知だけで見つかった匿名監視room)は
 * 「購読なし」として扱い、呼び出し元(computeBattleSnapshot)は BattleHistory を確定しない。
 *
 * `watchSource` はこの判定に使わない。`watchSource` は「最初に発見された経路」の記録であって
 * 「現在の購読状態」ではないため、条件に加えると双方向の誤判定が起きる(過去にコラボ検知で
 * watchSource が付いた room を管理者が後から手動追加しても上書きされない/Streamer登録が
 * 後で解除されても watchSource===null のまま残り続ける)。管理者による明示的な監視追加は
 * `ensureRoomWatchedByAdmin`(tiktok-room.ts)が specialWatch を立てることで表現する。
 *
 * 既知の残存リスク: 将来 COLLAB 監視向けの理由別 lease 管理(reason:"COLLAB")を
 * monitorUntil とは別に持たせる実装が入ると、コラボ検知由来の room も monitorUntil を
 * 持つようになりうる。その場合この判定式の monitorUntil 条件が常に true へ倒れて
 * 今回のゲートが静かに無効化されうるため、その実装が入った時点でこの判定式の再検討が必要。
 */
export interface BattleSubscriptionRoom {
  streamerCount: number;
  watchCount: number;
  specialWatch: boolean;
  monitorUntil: Date | null;
}

export function hasBattleSubscriber(room: BattleSubscriptionRoom, now: Date): boolean {
  return (
    room.streamerCount > 0 ||
    room.watchCount > 0 ||
    room.specialWatch ||
    (room.monitorUntil !== null && room.monitorUntil > now)
  );
}
