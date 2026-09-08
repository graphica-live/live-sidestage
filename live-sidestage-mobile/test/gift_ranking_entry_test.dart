import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/gift_ranking_entry.dart';

void main() {
  group('GiftRankingEntry.tryParse', () {
    test('正常な行を解析できる', () {
      final entry = GiftRankingEntry.tryParse({
        'tiktokUid': 'user_a',
        'tiktokHandle': 'user_a_handle',
        'nickname': 'ユーザーA',
        'profileImageUrl': 'https://example.com/a.png',
        'giftCount': 12,
        'totalDiamonds': 3400,
        'lastGiftAt': '2026-08-28T10:00:00.000Z',
      });

      expect(entry, isNotNull);
      expect(entry!.tiktokUid, 'user_a');
      expect(entry.tiktokHandle, 'user_a_handle');
      expect(entry.nickname, 'ユーザーA');
      expect(entry.profileImageUrl, 'https://example.com/a.png');
      expect(entry.giftCount, 12);
      expect(entry.totalDiamonds, 3400);
      expect(entry.lastGiftAt, DateTime.parse('2026-08-28T10:00:00.000Z'));
    });

    test('tiktokUidが無ければnull', () {
      expect(GiftRankingEntry.tryParse({'nickname': 'x'}), isNull);
    });

    test('Map以外はnull', () {
      expect(GiftRankingEntry.tryParse('not a map'), isNull);
      expect(GiftRankingEntry.tryParse(null), isNull);
    });

    // 表示名は nickname → tiktokHandle → tiktokUid の順に落とす。
    // **tiktokUid をそのまま出すのは最後の手段**(数値IDなので人間には読めない)。
    test('nicknameが無ければtiktokHandleへ落ちる', () {
      final entry = GiftRankingEntry.tryParse(
        {'tiktokUid': 'user_a', 'tiktokHandle': 'handle_a', 'giftCount': 1, 'totalDiamonds': 1},
      );
      expect(entry!.nickname, 'handle_a');
    });

    test('nicknameもtiktokHandleも無ければtiktokUidへ落ちる', () {
      final entry = GiftRankingEntry.tryParse({'tiktokUid': 'user_a', 'giftCount': 1, 'totalDiamonds': 1});
      expect(entry!.nickname, 'user_a');
    });

    // TikTokUser 行が無ければサーバーは tiktokHandle に null を返す。
    // 空文字も同じ扱いにして、プロフィール導線側の `== null` 判定1つで済ませる。
    test('tiktokHandleが欠落・空文字ならnull(プロフィール導線を出さない印)', () {
      expect(GiftRankingEntry.tryParse({'tiktokUid': 'user_a'})!.tiktokHandle, isNull);
      expect(
        GiftRankingEntry.tryParse({'tiktokUid': 'user_a', 'tiktokHandle': ''})!.tiktokHandle,
        isNull,
      );
    });

    test('httpsでない画像URLは捨てる', () {
      final entry = GiftRankingEntry.tryParse({
        'tiktokUid': 'user_a',
        'profileImageUrl': 'http://example.com/a.png',
        'giftCount': 1,
        'totalDiamonds': 1,
      });
      expect(entry!.profileImageUrl, isNull);
    });

    test('数値フィールドが欠けていれば0へ落ちる', () {
      final entry = GiftRankingEntry.tryParse({'tiktokUid': 'user_a'});
      expect(entry!.giftCount, 0);
      expect(entry.totalDiamonds, 0);
      expect(entry.lastGiftAt, isNull);
    });
  });
}
