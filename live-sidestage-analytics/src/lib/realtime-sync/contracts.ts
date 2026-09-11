/**
 * リアルタイム同期の共通契約型。
 *
 * 貢献ランキング・ギフト履歴・バトル履歴の3機能で共有する
 * Socket.IO push用のenvelope型を定義する。
 */

/**
 * Socket.IO push用のenvelope型。
 *
 * 機能ごとに異なるpayloadを包み、schemaVersion・version・epochを
 * 統一形式で運ぶ。クライアント側がversion整合性を判定し、
 * mismatchしたときにREST resyncを要求する基盤として機能する。
 */
export interface SyncEnvelope<T> {
  /**
   * スキーマバージョン。CHAT_EVENT_SCHEMA_VERSIONと独立した
   * 機能ごとのカウンタ。スキーマ非互換な変更が出たときに上げる。
   */
  schemaVersion: number;

  /**
   * 配信者ID(streamerId)。このenvelopeがどの配信者のデータかを示す。
   */
  streamerId: string;

  /**
   * 同期方式。snapshot(全データ置換)・append(末尾追加)・upsert(該当行更新)の3値。
   */
  kind: "snapshot" | "append" | "upsert";

  /**
   * webプロセスの起動識別子(UUID)。プロセス再起動のたびに変わる。
   * version-storeはプロセス内メモリのみで永続化しないため、再起動後は
   * version/epochが0から再スタートする。クライアントは保持しているbootIdと
   * 異なるbootIdを受け取ったら、version/epochの大小に関わらず必ずsnapshot
   * resyncする(起動済みのままpush待ちだったクライアントが、再起動後の
   * 新しいversion列を「古い版の重複」として恒久的に無視してしまう問題への対策)。
   */
  bootId: string;

  /**
   * epoch。full reset単位（ランキングのみ使用、他は常に0）。
   * 日付変更など「過去データをすべて破棄して再開」するタイミングで
   * incrementし、versionをリセットする。
   */
  epoch: number;

  /**
   * version。(streamerId, syncKind, epoch)単位の単調増加番号。
   * クライアント側がversion欠損を検知してresyncを要求するキー。
   */
  version: number;

  /**
   * 集計期間。ranking(貢献ランキング)のみ必須("today"等)。
   * クライアントは自分が選択中の期間と一致しないsnapshotを破棄する。
   */
  period?: string;

  /**
   * ペイロード。RankingSnapshot・GiftHistoryEvent・BattleSummaryなど、
   * 機能ごとに異なる型が入る。
   */
  payload: T;
}
