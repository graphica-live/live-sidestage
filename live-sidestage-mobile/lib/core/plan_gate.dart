import '../models/account_status.dart';

/// [AccountStatus.hasFeature]を使った機能可否判定の集約。
///
/// **これはUIの出し分け用。サーバー側のrequireFeature(またはオンデバイス処理では
/// UIロックそのもの)が最終防衛線。** ここでの判定はロック表示・アップグレード導線の
/// 出し分けにだけ使う。
class PlanGate {
  const PlanGate(this.status);

  final AccountStatus status;

  // mobile領域のβが有効な間は、実プラン(status.plan)がFREEでもこれらの
  // オンデバイス制限を一時的にバイパスする(プラン自体は書き換えない設計)。
  bool get isFree => status.plan == 'FREE' && !status.mobileBetaActive;

  // ランダムボイス・速度調整・全ボイス選択・効果音登録数上限はサーバーにデータが
  // 存在しないオンデバイス処理なので、featuresキーではなくisFreeで直接判定する。
  bool get canUseRandomVoice => !isFree;
  bool get canAdjustTtsSpeed => !isFree;
  bool get canUseAllVoices => !isFree;

  /// 全SoundSet合計のGiftSound登録数の上限(FREEのみ)。ULTRA/PROは無制限(null)。
  int? get maxSoundRegistrations => isFree ? 5 : null;

  bool get canUseExtendedHistoryRange => status.hasFeature('mobile.history.extendedRange');
  bool get canUseListenerFilter => status.hasFeature('mobile.history.listenerFilter');
}
