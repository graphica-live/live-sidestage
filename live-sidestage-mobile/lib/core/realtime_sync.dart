import 'dart:async';

import 'package:flutter/foundation.dart';

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

  /// JSONマップからのパース用ファクトリコンストラクタ。ペイロードは呼び出し側で別途parseする。
  factory SyncEnvelope.fromMap(Map<String, dynamic> map) {
    return SyncEnvelope<dynamic>(
      schemaVersion: map['schemaVersion'] as int? ?? 0,
      streamerId: map['streamerId'] as String? ?? '',
      kind: map['kind'] as String? ?? 'snapshot',
      bootId: map['bootId'] as String? ?? '',
      epoch: map['epoch'] as int? ?? 0,
      version: map['version'] as int? ?? 0,
      period: map['period'] as String?,
      payload: map['payload'],
    ) as SyncEnvelope<T>;
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

  /// REST再取得成功後、その時点でサーバーが返したbootId/epoch/versionを
  /// tracker側へ反映する。
  ///
  /// **[reset]とは意味が違う。** [reset]は全て0/nullへ戻すため、REST取得時点で
  /// サーバー側のversionが既に進んでいる場合(プロセス起動後にversionが単調増加した
  /// 状態でREST取得した場合)、直後に届くpushのversionは`lastVersion+1`にならず、
  /// version欠損と誤判定され続けてしまう(REST再取得→reset→また欠損判定…の無限ループ)。
  /// RESTレスポンス自身が返すbootId/epoch/versionをそのまま採用することで、
  /// 次に届くpushのversionと正しく連続させる。
  void acknowledge({required String bootId, required int epoch, required int version}) {
    lastBootId = bootId;
    lastEpoch = epoch;
    lastVersion = version;
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

// ===== Sync Store実装 =====
// 3つのタブが使う共通のenvelope受信・version整合性チェック・resyncトリガー。

/// 貢献ランキングのpush受信・管理を担当する Store。
/// CommentFeed から chat:ranking:snapshot イベントを購読し、
/// VersionTracker で整合性チェック → snapshot更新または resync要求。
class RankingSyncStore extends ChangeNotifier {
  /// UI側で表示する集計期間。
  String? _currentPeriod;

  /// 最新のランキングsnapshotペイロード。型は Map<String, dynamic>
  /// (analytics側の RankingSnapshot → entities/order)。
  Map<String, dynamic>? _snapshot;

  /// 受信したenvelopeのmismatch検知・trackingに使う tracker。
  final VersionTracker _versionTracker = VersionTracker();

  /// mismatchが発生した場合、REST再取得が必要なことを示すフラグ。
  bool _needsResync = false;

  /// streamControllerへ登録したリスナー(unsubscribeに使う)。
  StreamSubscription<Map<String, dynamic>>? _subscription;

  /// resyncが必要な場合に呼ぶコールバック。
  /// UI側の _load() (REST再取得)へ直接つなぐ。
  VoidCallback? _onResyncRequired;

  /// 初期化時に CommentFeed の ranking snapshot stream を購読。
  void initialize({
    required Stream<Map<String, dynamic>> rankingSnapshotStream,
    VoidCallback? onResyncRequired,
  }) {
    _onResyncRequired = onResyncRequired;
    // タブ再生成(配信者切替等)のたびにinitialize()が呼ばれうる。前回の
    // subscriptionをcancelせずに上書きするとリークし、同じイベントが
    // 複数リスナーで重複処理される(mismatch検知・resync要求の重複を招く)。
    _subscription?.cancel();
    _subscription = rankingSnapshotStream.listen(_onRankingSnapshot);
  }

  /// 配信者切替等で新しいセッションとして使い始める前に呼ぶ。
  ///
  /// Storeはmain.dartのMultiProviderに登録されアプリ生存中は破棄されない
  /// (タブWidget自体はtiktokIdをkeyにして再生成される)ため、これを呼ばずに
  /// 新しい配信者向けの購読を張ると、次のREST応答が返るまでの間、画面に
  /// 前配信者のsnapshotが一時的に残ってしまう。
  void resetForNewSession() {
    _snapshot = null;
    _needsResync = false;
    _versionTracker.reset();
    notifyListeners();
  }

  void _onRankingSnapshot(Map<String, dynamic> data) {
    try {
      final envelope = SyncEnvelope<dynamic>.fromMap(data);
      final result = _versionTracker.check(envelope);

      // schemaVersion検証(簡易)。厳密にはdecodeの責務だが、
      // mismatch時のログには含める。
      if (envelope.schemaVersion != supportedRankingSchemaVersion) {
        debugPrint('[ranking] schemaVersion不一致: ${envelope.schemaVersion}');
        return;
      }

      // 受信期間がUI側の選択期間と異なる場合は破棄。
      final period = envelope.period;
      if (period != null && period != _currentPeriod) {
        debugPrint('[ranking] period不一致(期待:$_currentPeriod, 受信:$period)');
        return;
      }

      if (result.canApply) {
        // 通常: snapshot をそのまま反映。
        _snapshot = envelope.payload as Map<String, dynamic>?;
        _needsResync = false;
        notifyListeners();
      } else if (result.snapshotRequired || result.fullResyncRequired) {
        // mismatch検知: REST再取得要求。
        debugPrint('[ranking] resync要求: ${result.reason}');
        _needsResync = true;
        _onResyncRequired?.call();
      } else if (result.ignoreDuplicate) {
        // 古いversion: 無視。
        debugPrint('[ranking] 重複無視: ${result.reason}');
      }
    } catch (e) {
      debugPrint('[ranking] envelopeパース失敗: $e');
    }
  }

  /// UI側が選択した期間を設定。異なる期間のsnapshotは破棄される。
  void setCurrentPeriod(String? period) {
    if (period == _currentPeriod) return;
    _currentPeriod = period;
    // 期間が変わった場合、保持中のsnapshotを初期化。
    _snapshot = null;
    _needsResync = false;
    notifyListeners();
  }

  /// 最新のsnapshotを取得(null = 未受信またはresync待機中)。
  Map<String, dynamic>? getSnapshot() => _snapshot;

  /// resyncが必要なことをUI側へ伝える。
  bool get needsResync => _needsResync;

  /// REST再取得成功後、版を更新する。
  ///
  /// [bootId]/[epoch]/[version]はRESTレスポンスがそのまま返す値を渡すこと。
  /// version tracker を`reset()`ではなく`acknowledge()`するのは、REST取得時点で
  /// 既にサーバー側のversionが進んでいることがあるため(realtime_sync.dartの
  /// [VersionTracker.acknowledge]のコメント参照)。
  void acknowledgeResync({
    required Map<String, dynamic> snapshot,
    required String? period,
    required String bootId,
    required int epoch,
    required int version,
  }) {
    _snapshot = snapshot;
    _currentPeriod = period;
    _needsResync = false;
    _versionTracker.acknowledge(bootId: bootId, epoch: epoch, version: version);
    notifyListeners();
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _subscription = null;
    super.dispose();
  }
}

/// ギフト履歴のappend受信・管理を担当する Store。
/// CommentFeed から chat:gift-history:append イベントを購読し、
/// VersionTracker で整合性チェック → append反映または resync要求。
class GiftHistorySyncStore extends ChangeNotifier {
  /// 受信済みギフト行のリスト。append順序を保持。
  List<Map<String, dynamic>> _history = [];

  /// 受信済みGift.idの集合。append冪等性チェック(重複防止)。
  final Set<dynamic> _seenGiftIds = {};

  /// version tracker。
  final VersionTracker _versionTracker = VersionTracker();

  /// mismatchが発生した場合のフラグ。
  bool _needsResync = false;

  /// streamControllerへ登録したリスナー。
  StreamSubscription<Map<String, dynamic>>? _subscription;

  /// resync要求コールバック。
  VoidCallback? _onResyncRequired;

  /// 初期化時に CommentFeed の gift-history append stream を購読。
  void initialize({
    required Stream<Map<String, dynamic>> giftHistoryAppendStream,
    VoidCallback? onResyncRequired,
  }) {
    _onResyncRequired = onResyncRequired;
    // タブ再生成(配信者切替等)のたびにinitialize()が呼ばれうる。前回の
    // subscriptionをcancelせずに上書きするとリークし、同じイベントが
    // 複数リスナーで重複処理される。
    _subscription?.cancel();
    _subscription = giftHistoryAppendStream.listen(_onGiftHistoryAppend);
  }

  /// 配信者切替等で新しいセッションとして使い始める前に呼ぶ。
  /// (理由はRankingSyncStore.resetForNewSessionのコメント参照)
  void resetForNewSession() {
    _history = [];
    _seenGiftIds.clear();
    _needsResync = false;
    _versionTracker.reset();
    notifyListeners();
  }

  void _onGiftHistoryAppend(Map<String, dynamic> data) {
    try {
      final envelope = SyncEnvelope<dynamic>.fromMap(data);
      final result = _versionTracker.check(envelope);

      if (envelope.schemaVersion != supportedGiftHistorySchemaVersion) {
        debugPrint('[gift-history] schemaVersion不一致: ${envelope.schemaVersion}');
        return;
      }

      if (result.canApply) {
        // append: payloadは単一のGiftHistoryEvent。
        final event = envelope.payload as Map<String, dynamic>?;
        if (event != null) {
          final giftId = event['id'];
          // 冪等適用: 既に受信済みのidは重複追加しない。
          if (!_seenGiftIds.contains(giftId)) {
            _seenGiftIds.add(giftId);
            _history.insert(0, event); // 時系列に新しい順(リスト先頭)
            _needsResync = false;
            notifyListeners();
          }
        }
      } else if (result.snapshotRequired || result.fullResyncRequired) {
        debugPrint('[gift-history] resync要求: ${result.reason}');
        _needsResync = true;
        _onResyncRequired?.call();
      } else if (result.ignoreDuplicate) {
        debugPrint('[gift-history] 重複無視: ${result.reason}');
      }
    } catch (e) {
      debugPrint('[gift-history] envelopeパース失敗: $e');
    }
  }

  /// 最新の履歴リストを取得。
  List<Map<String, dynamic>> getHistory() => List.unmodifiable(_history);

  /// resyncが必要なことをUI側へ伝える。
  bool get needsResync => _needsResync;

  /// REST再取得成功後、版を初期化・リセット。
  ///
  /// [bootId]/[version]はRESTレスポンスがそのまま返す値を渡すこと
  /// (理由はRankingSyncStore.acknowledgeResyncのコメント参照)。
  void acknowledgeResync({
    required List<Map<String, dynamic>> history,
    required String bootId,
    required int version,
  }) {
    _history = List.from(history);
    _seenGiftIds.clear();
    for (final event in history) {
      final giftId = event['id'];
      _seenGiftIds.add(giftId);
    }
    _needsResync = false;
    _versionTracker.acknowledge(bootId: bootId, epoch: 0, version: version);
    notifyListeners();
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _subscription = null;
    super.dispose();
  }
}

/// バトル履歴のupsert受信・管理を担当する Store。
/// CommentFeed から chat:battle-history:upsert イベントを購読し、
/// VersionTracker で整合性チェック → upsert反映または resync要求。
class BattleHistorySyncStore extends ChangeNotifier {
  /// 受信済みバトルのMap。key=battleId, value=BattleSummary相当。
  Map<String, dynamic> _battles = {};

  /// battleIdのリスト(表示順序保持)。
  List<String> _battleIds = [];

  /// version tracker。
  final VersionTracker _versionTracker = VersionTracker();

  /// mismatch フラグ。
  bool _needsResync = false;

  /// streamControllerへ登録したリスナー。
  StreamSubscription<Map<String, dynamic>>? _subscription;

  /// resync要求コールバック。
  VoidCallback? _onResyncRequired;

  /// 初期化時に CommentFeed の battle-history upsert stream を購読。
  void initialize({
    required Stream<Map<String, dynamic>> battleHistoryUpsertStream,
    VoidCallback? onResyncRequired,
  }) {
    _onResyncRequired = onResyncRequired;
    // タブ再生成(配信者切替等)のたびにinitialize()が呼ばれうる。前回の
    // subscriptionをcancelせずに上書きするとリークし、同じイベントが
    // 複数リスナーで重複処理される。
    _subscription?.cancel();
    _subscription = battleHistoryUpsertStream.listen(_onBattleHistoryUpsert);
  }

  /// 配信者切替等で新しいセッションとして使い始める前に呼ぶ。
  /// (理由はRankingSyncStore.resetForNewSessionのコメント参照)
  void resetForNewSession() {
    _battles = {};
    _battleIds = [];
    _needsResync = false;
    _versionTracker.reset();
    notifyListeners();
  }

  void _onBattleHistoryUpsert(Map<String, dynamic> data) {
    try {
      final envelope = SyncEnvelope<dynamic>.fromMap(data);
      final result = _versionTracker.check(envelope);

      if (envelope.schemaVersion != supportedBattleHistorySchemaVersion) {
        debugPrint('[battle-history] schemaVersion不一致: ${envelope.schemaVersion}');
        return;
      }

      if (result.canApply) {
        // upsert: payloadは単一のBattleSummary。
        final battle = envelope.payload as Map<String, dynamic>?;
        if (battle != null) {
          final battleId = battle['battleId'] as String?;
          if (battleId != null) {
            // upsert: 既存なら上書き、無ければ追加。
            if (!_battles.containsKey(battleId)) {
              _battleIds.add(battleId);
            }
            _battles[battleId] = battle;
            _needsResync = false;
            notifyListeners();
          }
        }
      } else if (result.snapshotRequired || result.fullResyncRequired) {
        debugPrint('[battle-history] resync要求: ${result.reason}');
        _needsResync = true;
        _onResyncRequired?.call();
      } else if (result.ignoreDuplicate) {
        debugPrint('[battle-history] 重複無視: ${result.reason}');
      }
    } catch (e) {
      debugPrint('[battle-history] envelopeパース失敗: $e');
    }
  }

  /// 最新のバトル一覧を取得(battleIds順)。
  List<Map<String, dynamic>> getBattles() {
    return _battleIds
        .map((id) => _battles[id])
        .whereType<Map<String, dynamic>>()
        .toList();
  }

  /// 特定のbattleIdを取得。
  Map<String, dynamic>? getBattle(String battleId) => _battles[battleId];

  /// resyncが必要なことをUI側へ伝える。
  bool get needsResync => _needsResync;

  /// REST再取得成功後、版を初期化・リセット。
  ///
  /// [bootId]/[version]はRESTレスポンスがそのまま返す値を渡すこと
  /// (理由はRankingSyncStore.acknowledgeResyncのコメント参照)。
  void acknowledgeResync({
    required List<Map<String, dynamic>> battles,
    required String bootId,
    required int version,
  }) {
    _battles.clear();
    _battleIds.clear();
    for (final battle in battles) {
      final battleId = battle['battleId'] as String?;
      if (battleId != null) {
        _battleIds.add(battleId);
        _battles[battleId] = battle;
      }
    }
    _needsResync = false;
    _versionTracker.acknowledge(bootId: bootId, epoch: 0, version: version);
    notifyListeners();
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _subscription = null;
    super.dispose();
  }
}
