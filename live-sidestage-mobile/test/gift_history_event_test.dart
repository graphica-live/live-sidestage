import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/gift_history_event.dart';

void main() {
  group('GiftHistoryEvent.tryParse', () {
    test('正常な行を解析できる', () {
      final event = GiftHistoryEvent.tryParse({
        'id': 'g1',
        'tiktokUid': 'user_a',
        'tiktokHandle': 'user_a_handle',
        'nickname': 'ユーザーA',
        'profileImageUrl': 'https://example.com/a.png',
        'giftId': 5655,
        'giftName': 'Rose',
        'giftPictureUrl': 'https://example.com/rose.png',
        'repeatCount': 3,
        'totalDiamonds': 15,
        'receivedAt': '2026-08-28T10:00:00.000Z',
      });

      expect(event, isNotNull);
      expect(event!.id, 'g1');
      expect(event.tiktokUid, 'user_a');
      expect(event.tiktokHandle, 'user_a_handle');
      expect(event.nickname, 'ユーザーA');
      expect(event.giftName, 'Rose');
      expect(event.repeatCount, 3);
      expect(event.totalDiamonds, 15);
    });

    test('未知のキー(旧サーバーのedited等)は無視する', () {
      final event = GiftHistoryEvent.tryParse({
        'id': 'g1',
        'tiktokUid': 'user_a',
        'giftName': 'Rose',
        'totalDiamonds': 5,
        'edited': true,
      });

      expect(event!.totalDiamonds, 5);
    });

    test('id・tiktokUid・giftNameのいずれかが無ければnull', () {
      expect(GiftHistoryEvent.tryParse({'tiktokUid': 'a', 'giftName': 'Rose'}), isNull);
      expect(GiftHistoryEvent.tryParse({'id': 'g1', 'giftName': 'Rose'}), isNull);
      expect(GiftHistoryEvent.tryParse({'id': 'g1', 'tiktokUid': 'a'}), isNull);
    });

    test('Map以外はnull', () {
      expect(GiftHistoryEvent.tryParse('not a map'), isNull);
      expect(GiftHistoryEvent.tryParse(null), isNull);
    });

    test('httpsでない画像URLは捨てる', () {
      final event = GiftHistoryEvent.tryParse({
        'id': 'g1',
        'tiktokUid': 'a',
        'giftName': 'Rose',
        'giftPictureUrl': 'http://example.com/rose.png',
      });
      expect(event!.giftPictureUrl, isNull);
    });

    // TikTokUser 行が無ければサーバーは tiktokHandle / nickname に null を返す。
    // 行そのものは捨てず、表示名を tiktokHandle → tiktokUid の順で埋める。
    test('nicknameが無ければtiktokHandle、それも無ければtiktokUidへ落ちる', () {
      final withHandle = GiftHistoryEvent.tryParse(
        {'id': 'g1', 'tiktokUid': 'user_a', 'tiktokHandle': 'handle_a', 'giftName': 'Rose'},
      );
      expect(withHandle!.nickname, 'handle_a');

      final bare = GiftHistoryEvent.tryParse({'id': 'g1', 'tiktokUid': 'user_a', 'giftName': 'Rose'});
      expect(bare!.tiktokHandle, isNull);
      expect(bare.nickname, 'user_a');
    });

    test('数値フィールドが欠けていれば0', () {
      final event = GiftHistoryEvent.tryParse({'id': 'g1', 'tiktokUid': 'a', 'giftName': 'Rose'});
      expect(event!.giftId, 0);
      expect(event.repeatCount, 0);
      expect(event.totalDiamonds, 0);
      expect(event.receivedAt, isNull);
    });
  });
}
