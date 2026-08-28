import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/gift_ranking_entry.dart';

void main() {
  group('GiftRankingEntry.tryParse', () {
    test('正常な行を解析できる', () {
      final entry = GiftRankingEntry.tryParse({
        'uniqueId': 'user_a',
        'nickname': 'ユーザーA',
        'profileImageUrl': 'https://example.com/a.png',
        'giftCount': 12,
        'totalDiamonds': 3400,
        'lastGiftAt': '2026-08-28T10:00:00.000Z',
      });

      expect(entry, isNotNull);
      expect(entry!.uniqueId, 'user_a');
      expect(entry.nickname, 'ユーザーA');
      expect(entry.profileImageUrl, 'https://example.com/a.png');
      expect(entry.giftCount, 12);
      expect(entry.totalDiamonds, 3400);
      expect(entry.lastGiftAt, DateTime.parse('2026-08-28T10:00:00.000Z'));
    });

    test('uniqueIdが無ければnull', () {
      expect(GiftRankingEntry.tryParse({'nickname': 'x'}), isNull);
    });

    test('Map以外はnull', () {
      expect(GiftRankingEntry.tryParse('not a map'), isNull);
      expect(GiftRankingEntry.tryParse(null), isNull);
    });

    test('nicknameが無ければuniqueIdへ落ちる', () {
      final entry = GiftRankingEntry.tryParse({'uniqueId': 'user_a', 'giftCount': 1, 'totalDiamonds': 1});
      expect(entry!.nickname, 'user_a');
    });

    test('httpsでない画像URLは捨てる', () {
      final entry = GiftRankingEntry.tryParse({
        'uniqueId': 'user_a',
        'profileImageUrl': 'http://example.com/a.png',
        'giftCount': 1,
        'totalDiamonds': 1,
      });
      expect(entry!.profileImageUrl, isNull);
    });

    test('数値フィールドが欠けていれば0へ落ちる', () {
      final entry = GiftRankingEntry.tryParse({'uniqueId': 'user_a'});
      expect(entry!.giftCount, 0);
      expect(entry.totalDiamonds, 0);
      expect(entry.lastGiftAt, isNull);
    });
  });
}
