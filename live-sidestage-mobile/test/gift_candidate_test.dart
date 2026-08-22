// ギフト候補のパースとコイン帯の絞り込みを検証する。
//
// TikTok のカタログには同じ名前でコイン数の違うギフトが存在する（`freestyle` は
// 1 コインと 1800 コインの両方が実在する）。一致キーは名前なのでどちらが飛んできても
// 同じ音が鳴る。したがって候補は単一の価格ではなく範囲として扱い、コイン帯の絞り込みも
// 範囲同士の重なりで判定する必要がある。
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';

void main() {
  group('GiftCandidate.tryParse', () {
    test('min/max を読む', () {
      final gift = GiftCandidate.tryParse({
        'name': 'freestyle',
        'label': 'Freestyle',
        'diamondCount': 1,
        'minDiamondCount': 1,
        'maxDiamondCount': 1800,
        'seen': true,
      })!;

      expect(gift.name, 'freestyle');
      expect(gift.label, 'Freestyle');
      expect(gift.minDiamondCount, 1);
      expect(gift.maxDiamondCount, 1800);
      expect(gift.hasCoinRange, isTrue);
      expect(gift.seen, isTrue);
    });

    test('min/max が無ければ diamondCount へフォールバックする（旧サーバー互換）', () {
      final gift = GiftCandidate.tryParse({
        'name': 'rose',
        'label': 'Rose',
        'diamondCount': 1,
      })!;

      expect(gift.minDiamondCount, 1);
      expect(gift.maxDiamondCount, 1);
      expect(gift.hasCoinRange, isFalse);
      expect(gift.seen, isFalse);
    });

    test('コイン数が欠落・不正でも 0 として通す', () {
      for (final coins in [null, -1, 'abc', true, 1.5]) {
        final gift = GiftCandidate.tryParse({'name': 'x', 'diamondCount': coins})!;
        expect(gift.minDiamondCount, 0, reason: '$coins');
        expect(gift.maxDiamondCount, 0, reason: '$coins');
      }
    });

    test('label が無ければ name を表示に使う', () {
      expect(GiftCandidate.tryParse({'name': 'rose'})!.label, 'rose');
      expect(GiftCandidate.tryParse({'name': 'rose', 'label': ''})!.label, 'rose');
    });

    test('name が無い・空・文字列でないものは捨てる', () {
      expect(GiftCandidate.tryParse({'label': 'Rose'}), isNull);
      expect(GiftCandidate.tryParse({'name': ''}), isNull);
      expect(GiftCandidate.tryParse({'name': 123}), isNull);
      expect(GiftCandidate.tryParse('rose'), isNull);
      expect(GiftCandidate.tryParse(null), isNull);
    });

    test('min > max が来ても順序を正す', () {
      final gift = GiftCandidate.tryParse({
        'name': 'broken',
        'minDiamondCount': 500,
        'maxDiamondCount': 10,
      })!;
      expect(gift.minDiamondCount, 10);
      expect(gift.maxDiamondCount, 500);
    });

    test('未知のフィールドを無視する', () {
      final gift = GiftCandidate.tryParse({
        'name': 'rose',
        'label': 'Rose',
        'diamondCount': 1,
        'somethingNew': {'nested': true},
      })!;
      expect(gift.name, 'rose');
    });
  });

  group('overlapsCoins', () {
    const single = GiftCandidate.single(name: 'rose', label: 'Rose', diamondCount: 1);
    const ranged = GiftCandidate(
      name: 'freestyle',
      label: 'Freestyle',
      minDiamondCount: 1,
      maxDiamondCount: 1800,
    );

    test('単一価格は自分の帯だけに入る', () {
      expect(single.overlapsCoins(1, 9), isTrue);
      expect(single.overlapsCoins(10, 99), isFalse);
      expect(single.overlapsCoins(1000, null), isFalse);
    });

    test('価格に幅がある候補はどの帯でも見つかる', () {
      expect(ranged.overlapsCoins(1, 9), isTrue);
      expect(ranged.overlapsCoins(10, 99), isTrue);
      expect(ranged.overlapsCoins(100, 999), isTrue);
      expect(ranged.overlapsCoins(1000, null), isTrue);
    });

    test('境界値を含む', () {
      const gift = GiftCandidate(
        name: 'x',
        label: 'X',
        minDiamondCount: 10,
        maxDiamondCount: 99,
      );
      expect(gift.overlapsCoins(1, 9), isFalse);
      expect(gift.overlapsCoins(9, 10), isTrue);
      expect(gift.overlapsCoins(99, 999), isTrue);
      expect(gift.overlapsCoins(100, 999), isFalse);
    });

    test('「すべて」の帯（下限0・上限なし）は全部通す', () {
      expect(single.overlapsCoins(0, null), isTrue);
      expect(ranged.overlapsCoins(0, null), isTrue);
      expect(
        const GiftCandidate.single(name: 'free', label: 'Free', diamondCount: 0)
            .overlapsCoins(0, null),
        isTrue,
      );
    });
  });
}
