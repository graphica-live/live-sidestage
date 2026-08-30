import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';

void main() {
  group('rangeParams', () {
    test('startDatetime/endDatetimeが両方nullならperiod/dateを返す', () {
      final result = rangeParams(period: 'day', date: '2026-08-30');
      expect(result, {'period': 'day', 'date': '2026-08-30'});
    });

    test('startDatetime/endDatetimeが両方指定されたらそちらを返し、period/dateは送らない', () {
      final result = rangeParams(
        period: 'day',
        date: '2026-08-30',
        startDatetime: DateTime.utc(2026, 8, 30, 9, 0),
        endDatetime: DateTime.utc(2026, 8, 30, 14, 0),
      );
      expect(result, {
        'startDatetime': '2026-08-30T09:00:00.000Z',
        'endDatetime': '2026-08-30T14:00:00.000Z',
      });
      expect(result.containsKey('period'), isFalse);
      expect(result.containsKey('date'), isFalse);
    });

    test('端末ローカルのDateTimeを渡してもtoUtc()経由でZ付きにシリアライズされる', () {
      final result = rangeParams(
        period: 'day',
        date: '2026-08-30',
        startDatetime: DateTime.utc(2026, 8, 30, 9, 0).toLocal(),
        endDatetime: DateTime.utc(2026, 8, 30, 14, 0).toLocal(),
      );
      expect(result['startDatetime'], '2026-08-30T09:00:00.000Z');
      expect(result['endDatetime'], '2026-08-30T14:00:00.000Z');
    });

    test('startDatetimeだけの指定はArgumentError', () {
      expect(
        () => rangeParams(period: 'day', date: '2026-08-30', startDatetime: DateTime.utc(2026, 8, 30)),
        throwsArgumentError,
      );
    });

    test('endDatetimeだけの指定はArgumentError', () {
      expect(
        () => rangeParams(period: 'day', date: '2026-08-30', endDatetime: DateTime.utc(2026, 8, 30)),
        throwsArgumentError,
      );
    });
  });
}
