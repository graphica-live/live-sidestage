import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/gift_history_event.dart';

void main() {
  group('GiftHistoryEvent.tryParse', () {
    test('正常な行を解析できる', () {
      final event = GiftHistoryEvent.tryParse({
        'id': 'g1',
        'uniqueId': 'user_a',
        'nickname': 'ユーザーA',
        'profileImageUrl': 'https://example.com/a.png',
        'giftId': 5655,
        'giftName': 'Rose',
        'giftPictureUrl': 'https://example.com/rose.png',
        'repeatCount': 3,
        'totalDiamonds': 15,
        'receivedAt': '2026-08-28T10:00:00.000Z',
        'edited': false,
      });

      expect(event, isNotNull);
      expect(event!.id, 'g1');
      expect(event.giftName, 'Rose');
      expect(event.repeatCount, 3);
      expect(event.totalDiamonds, 15);
      expect(event.edited, isFalse);
    });

    test('編集済みでマイナスのtotalDiamondsも正当値として扱う', () {
      final event = GiftHistoryEvent.tryParse({
        'id': 'g1',
        'uniqueId': 'user_a',
        'giftName': 'Rose',
        'totalDiamonds': -5,
        'edited': true,
      });

      expect(event!.totalDiamonds, -5);
      expect(event.edited, isTrue);
    });

    test('id・uniqueId・giftNameのいずれかが無ければnull', () {
      expect(GiftHistoryEvent.tryParse({'uniqueId': 'a', 'giftName': 'Rose'}), isNull);
      expect(GiftHistoryEvent.tryParse({'id': 'g1', 'giftName': 'Rose'}), isNull);
      expect(GiftHistoryEvent.tryParse({'id': 'g1', 'uniqueId': 'a'}), isNull);
    });

    test('Map以外はnull', () {
      expect(GiftHistoryEvent.tryParse('not a map'), isNull);
      expect(GiftHistoryEvent.tryParse(null), isNull);
    });

    test('httpsでない画像URLは捨てる', () {
      final event = GiftHistoryEvent.tryParse({
        'id': 'g1',
        'uniqueId': 'a',
        'giftName': 'Rose',
        'giftPictureUrl': 'http://example.com/rose.png',
      });
      expect(event!.giftPictureUrl, isNull);
    });

    test('数値フィールドが欠けていれば0、edited未指定はfalse', () {
      final event = GiftHistoryEvent.tryParse({'id': 'g1', 'uniqueId': 'a', 'giftName': 'Rose'});
      expect(event!.giftId, 0);
      expect(event.repeatCount, 0);
      expect(event.totalDiamonds, 0);
      expect(event.edited, isFalse);
      expect(event.receivedAt, isNull);
    });
  });
}
