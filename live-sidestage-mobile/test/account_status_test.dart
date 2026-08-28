import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/account_status.dart';

void main() {
  group('AccountStatus.fromJson', () {
    test('サーバー応答をそのままパースする', () {
      final status = AccountStatus.fromJson({
        'userId': 'u1',
        'effectivePlan': 'ULTRA',
        'betaAccess': true,
        'features': ['mobile.entitlementProbe'],
        'minimumSupportedVersion': '1.2.0',
        'latestVersion': '1.3.0',
        'maintenanceMode': false,
      });

      expect(status.userId, 'u1');
      expect(status.effectivePlan, 'ULTRA');
      expect(status.betaAccess, isTrue);
      expect(status.hasFeature('mobile.entitlementProbe'), isTrue);
      expect(status.hasFeature('no-such-feature'), isFalse);
      expect(status.minimumSupportedVersion, '1.2.0');
      expect(status.latestVersion, '1.3.0');
      expect(status.maintenanceMode, isFalse);
    });

    test('欠落フィールドは安全側の既定値になる', () {
      final status = AccountStatus.fromJson({});

      expect(status.effectivePlan, 'FREE');
      expect(status.betaAccess, isFalse);
      expect(status.features, isEmpty);
      expect(status.minimumSupportedVersion, '0.0.0');
      expect(status.latestVersion, isNull);
      expect(status.maintenanceMode, isFalse);
    });
  });

  test('fallbackはFREE・制限なしの安全側の値', () {
    expect(AccountStatus.fallback.effectivePlan, 'FREE');
    expect(AccountStatus.fallback.betaAccess, isFalse);
    expect(AccountStatus.fallback.minimumSupportedVersion, '0.0.0');
  });
}
