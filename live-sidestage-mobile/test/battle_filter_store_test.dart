import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/battle_filter_store.dart';

void main() {
  group('isSmallBattle', () {
    test('両陣営ともしきい値未満なら小さいと判定する', () {
      expect(isSmallBattle(selfScore: '50', opponentScore: '99', threshold: 100), isTrue);
    });

    test('片方でもしきい値以上なら小さいと判定しない', () {
      expect(isSmallBattle(selfScore: '50', opponentScore: '100', threshold: 100), isFalse);
    });

    test('両方とも未観測(null)なら小さいと判定しない', () {
      expect(isSmallBattle(selfScore: null, opponentScore: null, threshold: 100), isFalse);
    });
  });
}
