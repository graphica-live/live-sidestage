/// GET /api/mobile/me の応答。
///
/// **これはUIの出し分け用の参照情報であって、権限の最終防衛線ではない。**
/// 実際の機能可否は毎回サーバー側(requireFeature)が判定する。ここでのfeaturesは
/// 「ボタンを出すかどうか」の目安に過ぎず、これを信じて権限チェックを省略しないこと。
class AccountStatus {
  final String userId;

  /// 実プラン(FREE/PRO/ULTRA)。βの影響を受けず、課金状態をそのまま反映する。
  final String plan;

  /// モバイル領域のβ(mobileBetaEnabled)が現在有効かどうか。プランバッジの表示だけに使う。
  /// analytics/eventsβ等の機能別βとは独立で、これらはバッジに影響しない。
  final bool mobileBetaActive;

  /// サーバー(analytics)が組み立てた表示用ラベル。βactive時は"βFREE"のように前置される。
  /// プラン表記はここが唯一の正本 — クライアント側でplan/mobileBetaActiveから組み立て直さない。
  final String planLabel;

  final List<String> features;
  final String minimumSupportedVersion;
  final String? latestVersion;
  final bool maintenanceMode;

  /// サーバー応答由来ではなく[fallback]既定値であることを示す。
  ///
  /// 通信断・タイムアウト・5xxでもここはFREEに倒れる(UIを誤って広く許可しないため)。
  /// **サーバーが実際にFREEと答えたわけではない**ので、降格に伴う破壊的な操作
  /// (保存済み設定の強制リセット等)の引き金にしてはいけない — 一時的な電波不良
  /// だけでPRO/ULTRAユーザーの設定が消える事故になる。
  final bool isFallback;

  /// TikTok ID自動合流の事後通知(未読が無ければnull)。閉じたらacknowledgeMergeNotice()で既読化する。
  final RecentMergeNotice? recentMerge;

  const AccountStatus({
    required this.userId,
    required this.plan,
    required this.mobileBetaActive,
    required this.planLabel,
    required this.features,
    required this.minimumSupportedVersion,
    required this.maintenanceMode,
    this.latestVersion,
    this.isFallback = false,
    this.recentMerge,
  });

  /// サーバーから取得できるまで(または取得に失敗したとき)の既定値。
  /// 未取得中に誤って機能を制限しないよう、最も広く許可される側(FREE=通常利用可)に倒す。
  /// **minimumSupportedVersionだけは"0.0.0"(=常に通過)にし、取得失敗を強制アップデート扱いにしない。**
  static const fallback = AccountStatus(
    userId: '',
    plan: 'FREE',
    mobileBetaActive: false,
    planLabel: 'FREE',
    features: [],
    minimumSupportedVersion: '0.0.0',
    maintenanceMode: false,
    latestVersion: null,
    isFallback: true,
  );

  bool hasFeature(String key) => features.contains(key);

  /// 通知バナーを閉じた直後、次のサーバー再取得を待たずローカルで既読反映するためだけに使う。
  AccountStatus withoutRecentMerge() => AccountStatus(
        userId: userId,
        plan: plan,
        mobileBetaActive: mobileBetaActive,
        planLabel: planLabel,
        features: features,
        minimumSupportedVersion: minimumSupportedVersion,
        maintenanceMode: maintenanceMode,
        latestVersion: latestVersion,
        isFallback: isFallback,
        recentMerge: null,
      );

  factory AccountStatus.fromJson(Map<String, dynamic> json) {
    final rawFeatures = json['features'];
    final plan = json['plan'] as String? ?? 'FREE';
    return AccountStatus(
      userId: json['userId'] as String? ?? '',
      plan: plan,
      mobileBetaActive: json['mobileBetaActive'] == true,
      planLabel: json['planLabel'] as String? ?? plan,
      features: rawFeatures is List ? rawFeatures.whereType<String>().toList() : const [],
      minimumSupportedVersion: json['minimumSupportedVersion'] as String? ?? '0.0.0',
      latestVersion: json['latestVersion'] as String?,
      maintenanceMode: json['maintenanceMode'] == true,
      recentMerge: RecentMergeNotice.tryParse(json['recentMerge']),
    );
  }
}

/// TikTok ID自動合流の事後通知バナー(Web版と同一の2パターン)。
class RecentMergeNotice {
  final String id;
  final String outcome; // "MERGED" | "BLOCKED_OLD_HANDLE_ALIVE" | "SELF_NOT_FOUND"
  final String? oldTiktokId;
  final int? giftCount;

  const RecentMergeNotice({
    required this.id,
    required this.outcome,
    this.oldTiktokId,
    this.giftCount,
  });

  bool get isMerged => outcome == 'MERGED';

  String get message => isMerged
      ? '旧ID @${oldTiktokId ?? ''} のギフト${giftCount ?? 0}件を引き継ぎました'
      : '引き継げなかったデータがあります。サポートへご連絡ください';

  static RecentMergeNotice? tryParse(Object? json) {
    if (json is! Map) return null;
    final id = json['id'];
    final outcome = json['outcome'];
    if (id is! String || outcome is! String) return null;
    return RecentMergeNotice(
      id: id,
      outcome: outcome,
      oldTiktokId: json['oldTiktokId'] as String?,
      giftCount: json['giftCount'] as int?,
    );
  }
}
