import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/plan_gate.dart';
import 'package:live_sidestage_mobile/models/account_status.dart';

AccountStatus _status({
  String plan = 'FREE',
  bool mobileBetaActive = false,
  List<String> features = const [],
}) =>
    AccountStatus(
      userId: 'u1',
      plan: plan,
      mobileBetaActive: mobileBetaActive,
      planLabel: mobileBetaActive ? 'β$plan' : plan,
      features: features,
      minimumSupportedVersion: '0.0.0',
      maintenanceMode: false,
    );

void main() {
  test('FREEプランはisFree=trueでオンデバイス制限がかかる', () {
    final gate = PlanGate(_status(plan: 'FREE'));

    expect(gate.isFree, isTrue);
    expect(gate.canUseRandomVoice, isFalse);
    expect(gate.canAdjustTtsSpeed, isFalse);
    expect(gate.canUseAllVoices, isFalse);
    expect(gate.maxSoundRegistrations, 5);
  });

  test('mobileβが有効なFREEはisFree=falseになり制限が外れる(実プランはFREEのまま)', () {
    final gate = PlanGate(_status(plan: 'FREE', mobileBetaActive: true));

    expect(gate.status.plan, 'FREE');
    expect(gate.isFree, isFalse);
    expect(gate.canUseRandomVoice, isTrue);
    expect(gate.canAdjustTtsSpeed, isTrue);
    expect(gate.canUseAllVoices, isTrue);
    expect(gate.maxSoundRegistrations, isNull);
  });

  test('analyticsβ相当のfeatureキーはmobileβと独立してhasFeatureで判定する', () {
    final gate = PlanGate(_status(
      plan: 'FREE',
      features: ['mobile.history.extendedRange', 'mobile.history.listenerFilter'],
    ));

    expect(gate.isFree, isTrue); // mobileβは無効のまま
    expect(gate.canUseExtendedHistoryRange, isTrue);
    expect(gate.canUseListenerFilter, isTrue);
  });

  test('PRO/ULTRAはmobileβに関わらずisFree=false', () {
    final gate = PlanGate(_status(plan: 'PRO'));

    expect(gate.isFree, isFalse);
  });
}
