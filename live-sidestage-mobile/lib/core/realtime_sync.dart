
/// Socket.IO push用のenvelope型。
///
/// 貢献ランキング・ギフト履歴・バトル履歴の3機能で共有する
/// envelope型。各機能のpayloadは異なるが、version整合性チェックの
/// スキーマは統一されている。
class SyncEnvelope<T> {
  /// スキーマバージョン。機能ごとに独立したカウンタ。
  final int schemaVersion;

  /// 配信者ID(streamerId)。このenvelopeがどの配信者のデータかを示す。
  final String streamerId;

  /// 同期方式。snapshot(全データ置換)・append(末尾追加)・upsert(該当行更新)の3値。
  final String kind; // "snapshot" | "append" | "upsert"

  /// webプロセスの起動識別子(UUID)。プロセス再起動のたびに変わる。
  /// version-storeはプロセス内メモリのみで永続化しないため、再起動後は
  /// version/epochが0から再スタートする。クライアントは保持していたbootIdと
  /// 異なるbootIdを受け取ったら、version/epochの大小に関わらず必ずsnapshot
  /// resyncする。
  final String bootId;

  /// epoch。full reset単位（ランキングのみ使用、他は常に0）。
  /// 日付変更など「過去データをすべて破棄して再開」するタイミングで
  /// incrementし、versionをリセットする。
  final int epoch;

  /// version。(streamerId, syncKind, epoch)単位の単調増加番号。
  /// クライアント側がversion欠損を検知してresyncを要求するキー。
  final int version;

  /// 集計期間。ranking(貢献ランキング)のみ必須("today"等)。
  /// クライアントは自分が選択中の期間と一致しないsnapshotを破棄する。
  final String? period;

  /// ペイロード。RankingSnapshot・GiftHistoryEvent・BattleSummaryなど、
  /// 機能ごとに異なる型が入る。
  final T payload;

  SyncEnvelope({
    required this.schemaVersion,
    required this.streamerId,
    required this.kind,
    required this.bootId,
    required this.epoch,
    required this.version,
    this.period,
    required this.payload,
  });

  /// JSONマップからのパース用ファクトリ。ペイロードは呼び出し側で別途parseする。
  static SyncEnvelope<dynamic> fromMap(Map<String, dynamic> map) {
    return SyncEnvelope<dynamic>(
      schemaVersion: map['schemaVersion'] as int? ?? 0,
      streamerId: map['streamerId'] as String? ?? '',
      kind: map['kind'] as String? ?? 'snapshot',
      bootId: map['bootId'] as String? ?? '',
      epoch: map['epoch'] as int? ?? 0,
      version: map['version'] as int? ?? 0,
      period: map['period'] as String?,
      payload: null,
    );
  }
}

/// Sync受信時にversion/epochの整合性を判定する。
/// 純関数設計で、単体テスト容易性を優先する。
class VersionTracker {
  /// 前回保持していたbootId。受信したbootIdが異なれば無条件でfull resyncを要求。
  String? lastBootId;

  /// 前回保持していたepoch。
  int lastEpoch = 0;

  /// 前回保持していたversion。
  int lastVersion = 0;

  VersionTracker({
    this.lastBootId,
    this.lastEpoch = 0,
    this.lastVersion = 0,
  });

  /// 受信したenvelopeが「次に期待する値」か、または何らかの処理が要るか判定する。
  VersionCheckResult check(SyncEnvelope<dynamic> envelope) {
    // bootIdが前回と異なる → 無条件でfull resync要求。
    // (version/epochの大小を見ない — web再起動直後は必ずこの経路)
    if (lastBootId != null && lastBootId != envelope.bootId) {
      return VersionCheckResult.fullResyncRequired(
        reason: 'bootId不一致(前:$lastBootId, 現:${envelope.bootId})',
      );
    }

    // epochが進んでいる → full reset。適用前にsnapshot要求(REST再取得)が必要。
    if (envelope.epoch > lastEpoch) {
      return VersionCheckResult.snapshotRequired(
        reason: 'epoch進行(前:$lastEpoch, 現:${envelope.epoch})',
      );
    }

    // 期待どおりの次version → 適用してよい。
    if (envelope.version == lastVersion + 1) {
      lastBootId = envelope.bootId;
      lastEpoch = envelope.epoch;
      lastVersion = envelope.version;
      return VersionCheckResult.canApply();
    }

    // versionが飛んでいる(欠損) → mismatch。snapshot要求が必要。
    if (envelope.version > lastVersion + 1) {
      return VersionCheckResult.snapshotRequired(
        reason: 'version欠損(期待:${lastVersion + 1}, 受信:${envelope.version})',
      );
    }

    // 古いversion(重複再送) → 無視。
    if (envelope.version <= lastVersion) {
      return VersionCheckResult.ignoreDuplicate(
        reason: 'version重複(前:$lastVersion, 現:${envelope.version})',
      );
    }

    // ここには到達しないはず。
    return VersionCheckResult.snapshotRequired(reason: '予期しない状態');
  }

  /// テスト用リセット。
  void reset() {
    lastBootId = null;
    lastEpoch = 0;
    lastVersion = 0;
  }
}

/// version整合性チェックの結果。
/// sealed class相当(Dartに無いので判定型で実装)。
class VersionCheckResult {
  /// 結果の種類。
  // ignore: library_private_types_in_public_api
  final _ResultKind kind;

  /// 理由(デバッグログ用)。
  final String? reason;

  VersionCheckResult._(this.kind, this.reason);

  /// 適用してよい。
  factory VersionCheckResult.canApply() {
    return VersionCheckResult._(_ResultKind.canApply, null);
  }

  /// 古いversion(重複再送)なので無視。
  factory VersionCheckResult.ignoreDuplicate({required String reason}) {
    return VersionCheckResult._(_ResultKind.ignoreDuplicate, reason);
  }

  /// snapshotを取り直す必要がある。
  factory VersionCheckResult.snapshotRequired({required String reason}) {
    return VersionCheckResult._(_ResultKind.snapshotRequired, reason);
  }

  /// 無条件でfull resyncを要求(bootId不一致など)。
  factory VersionCheckResult.fullResyncRequired({required String reason}) {
    return VersionCheckResult._(_ResultKind.fullResyncRequired, reason);
  }

  bool get canApply => kind == _ResultKind.canApply;
  bool get ignoreDuplicate => kind == _ResultKind.ignoreDuplicate;
  bool get snapshotRequired => kind == _ResultKind.snapshotRequired;
  bool get fullResyncRequired => kind == _ResultKind.fullResyncRequired;

  @override
  String toString() {
    if (reason != null) {
      return '$kind($reason)';
    }
    return kind.toString();
  }
}

enum _ResultKind {
  canApply,
  ignoreDuplicate,
  snapshotRequired,
  fullResyncRequired,
}

/// 機能別のsyncイベント用schemaVersionの定数。
/// 既存のCHAT_EVENT_SCHEMA_VERSIONと独立している。
const int supportedRankingSchemaVersion = 1;
const int supportedGiftHistorySchemaVersion = 1;
const int supportedBattleHistorySchemaVersion = 1;
