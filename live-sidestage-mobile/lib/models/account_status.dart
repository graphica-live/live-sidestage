/// GET /api/mobile/me の応答。
///
/// **これはUIの出し分け用の参照情報であって、権限の最終防衛線ではない。**
/// 実際の機能可否は毎回サーバー側(requireFeature)が判定する。ここでのfeaturesは
/// 「ボタンを出すかどうか」の目安に過ぎず、これを信じて権限チェックを省略しないこと。
class AccountStatus {
  final String userId;
  final String effectivePlan;

  /// mobileBetaEnabled(全体設定)が現在有効かどうか。ユーザー個別の参加可否ではない。
  final bool betaAccess;

  final List<String> features;
  final String minimumSupportedVersion;
  final String? latestVersion;
  final bool maintenanceMode;

  const AccountStatus({
    required this.userId,
    required this.effectivePlan,
    required this.betaAccess,
    required this.features,
    required this.minimumSupportedVersion,
    required this.maintenanceMode,
    this.latestVersion,
  });

  /// サーバーから取得できるまで(または取得に失敗したとき)の既定値。
  /// 未取得中に誤って機能を制限しないよう、最も広く許可される側(FREE=通常利用可)に倒す。
  /// **minimumSupportedVersionだけは"0.0.0"(=常に通過)にし、取得失敗を強制アップデート扱いにしない。**
  static const fallback = AccountStatus(
    userId: '',
    effectivePlan: 'FREE',
    betaAccess: false,
    features: [],
    minimumSupportedVersion: '0.0.0',
    maintenanceMode: false,
    latestVersion: null,
  );

  bool hasFeature(String key) => features.contains(key);

  factory AccountStatus.fromJson(Map<String, dynamic> json) {
    final rawFeatures = json['features'];
    return AccountStatus(
      userId: json['userId'] as String? ?? '',
      effectivePlan: json['effectivePlan'] as String? ?? 'FREE',
      betaAccess: json['betaAccess'] == true,
      features: rawFeatures is List ? rawFeatures.whereType<String>().toList() : const [],
      minimumSupportedVersion: json['minimumSupportedVersion'] as String? ?? '0.0.0',
      latestVersion: json['latestVersion'] as String?,
      maintenanceMode: json['maintenanceMode'] == true,
    );
  }
}
