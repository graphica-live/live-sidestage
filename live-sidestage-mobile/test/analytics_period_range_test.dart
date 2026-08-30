import 'package:flutter/material.dart' show DateTimeRange;
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/analytics_period.dart';

void main() {
  group('jstWallClockToUtc / jstWallClockFromUtc', () {
    test('JST壁時計をUTCへ変換する(-9時間)', () {
      final jst = DateTime.utc(2026, 8, 30, 18, 0);
      final utc = jstWallClockToUtc(jst);
      expect(utc, DateTime.utc(2026, 8, 30, 9, 0));
    });

    test('日付をまたぐ変換も正しい(JST 0時台はUTC前日)', () {
      final jst = DateTime.utc(2026, 8, 30, 3, 0);
      final utc = jstWallClockToUtc(jst);
      expect(utc, DateTime.utc(2026, 8, 29, 18, 0));
    });

    test('往復しても値が変わらない(変更せず開いて再適用しても時刻がずれない)', () {
      final original = DateTime.utc(2026, 1, 1, 0, 30);
      final roundTrip = jstWallClockFromUtc(jstWallClockToUtc(original));
      expect(roundTrip, original);
    });

    test('逆変換(UTC→JST壁時計)も往復する', () {
      final utcInstant = DateTime.utc(2026, 12, 31, 20, 15);
      final roundTrip = jstWallClockToUtc(jstWallClockFromUtc(utcInstant));
      expect(roundTrip, utcInstant);
    });
  });

  group('formatDateTimeRangeLabel', () {
    test('年を含めてJST表示に整形する', () {
      final range = DateTimeRange(
        start: DateTime.utc(2026, 8, 30, 9, 0), // JST 18:00
        end: DateTime.utc(2026, 8, 30, 14, 0), // JST 23:00
      );
      expect(formatDateTimeRangeLabel(range), '2026/08/30 18:00 〜 2026/08/30 23:00');
    });

    test('年をまたぐ範囲でも両端の年をそれぞれ出す', () {
      final range = DateTimeRange(
        start: DateTime.utc(2026, 12, 31, 15, 0), // JST 2027-01-01 00:00
        end: DateTime.utc(2027, 1, 1, 15, 0), // JST 2027-01-02 00:00
      );
      expect(formatDateTimeRangeLabel(range), '2027/01/01 00:00 〜 2027/01/02 00:00');
    });
  });

  group('customRangeContainsNow', () {
    test('現在時刻を含む範囲はtrue', () {
      final now = DateTime.now().toUtc();
      final range = DateTimeRange(
        start: now.subtract(const Duration(hours: 1)),
        end: now.add(const Duration(hours: 1)),
      );
      expect(customRangeContainsNow(range), isTrue);
    });

    test('未来の範囲はfalse', () {
      final now = DateTime.now().toUtc();
      final range = DateTimeRange(
        start: now.add(const Duration(days: 1)),
        end: now.add(const Duration(days: 2)),
      );
      expect(customRangeContainsNow(range), isFalse);
    });

    test('過去の範囲はfalse', () {
      final now = DateTime.now().toUtc();
      final range = DateTimeRange(
        start: now.subtract(const Duration(days: 2)),
        end: now.subtract(const Duration(days: 1)),
      );
      expect(customRangeContainsNow(range), isFalse);
    });
  });
}
