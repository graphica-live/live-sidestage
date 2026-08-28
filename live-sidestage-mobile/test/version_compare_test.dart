import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/version_compare.dart';

void main() {
  group('compareVersions', () {
    test('等しいバージョンは0', () {
      expect(compareVersions('1.2.3', '1.2.3'), 0);
    });

    test('大小を正しく判定する', () {
      expect(compareVersions('1.2.3', '1.2.4'), lessThan(0));
      expect(compareVersions('1.3.0', '1.2.9'), greaterThan(0));
      expect(compareVersions('2.0.0', '1.9.9'), greaterThan(0));
    });

    test('ビルド番号(+以降)は無視する', () {
      expect(compareVersions('1.0.0+5', '1.0.0+1'), 0);
    });

    test('セクション数が違っても比較できる("1.2"と"1.2.0"は等しい)', () {
      expect(compareVersions('1.2', '1.2.0'), 0);
      expect(compareVersions('1.2', '1.2.1'), lessThan(0));
    });
  });

  group('isVersionAtLeast', () {
    test('現在値が最小値以上ならtrue', () {
      expect(isVersionAtLeast('1.2.3', '1.2.3'), isTrue);
      expect(isVersionAtLeast('1.3.0', '1.2.3'), isTrue);
    });

    test('現在値が最小値未満ならfalse', () {
      expect(isVersionAtLeast('1.2.0', '1.2.3'), isFalse);
    });

    test('最小値が"0.0.0"なら常にtrue(未設定時のフォールバック)', () {
      expect(isVersionAtLeast('0.0.1', '0.0.0'), isTrue);
    });
  });
}
