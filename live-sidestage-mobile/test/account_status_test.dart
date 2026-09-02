import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/account_status.dart';

void main() {
  group('AccountStatus.fromJson', () {
    test('サーバー応答をそのままパースする', () {
      final status = AccountStatus.fromJson({
        'userId': 'u1',
        'plan': 'ULTRA',
        'mobileBetaActive': true,
        'planLabel': 'βULTRA',
        'features': ['mobile.entitlementProbe'],
        'minimumSupportedVersion': '1.2.0',
        'latestVersion': '1.3.0',
        'maintenanceMode': false,
      });

      expect(status.userId, 'u1');
      expect(status.plan, 'ULTRA');
      expect(status.mobileBetaActive, isTrue);
      expect(status.planLabel, 'βULTRA');
      expect(status.hasFeature('mobile.entitlementProbe'), isTrue);
      expect(status.hasFeature('no-such-feature'), isFalse);
      expect(status.minimumSupportedVersion, '1.2.0');
      expect(status.latestVersion, '1.3.0');
      expect(status.maintenanceMode, isFalse);
    });

    test('欠落フィールドは安全側の既定値になる', () {
      final status = AccountStatus.fromJson({});

      expect(status.plan, 'FREE');
      expect(status.mobileBetaActive, isFalse);
      expect(status.planLabel, 'FREE');
      expect(status.features, isEmpty);
      expect(status.minimumSupportedVersion, '0.0.0');
      expect(status.latestVersion, isNull);
      expect(status.maintenanceMode, isFalse);
    });

    test('planLabel欠落時はplanをそのまま使う', () {
      final status = AccountStatus.fromJson({'plan': 'PRO'});

      expect(status.plan, 'PRO');
      expect(status.planLabel, 'PRO');
    });
  });

  test('fallbackはFREE・制限なしの安全側の値', () {
    expect(AccountStatus.fallback.plan, 'FREE');
    expect(AccountStatus.fallback.mobileBetaActive, isFalse);
    expect(AccountStatus.fallback.planLabel, 'FREE');
    expect(AccountStatus.fallback.minimumSupportedVersion, '0.0.0');
  });
}
