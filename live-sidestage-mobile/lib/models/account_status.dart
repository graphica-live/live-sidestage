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
    );
  }
}
