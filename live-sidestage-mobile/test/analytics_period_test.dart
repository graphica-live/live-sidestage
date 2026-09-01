import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/analytics_period.dart';

void main() {
  group('AnalyticsPeriod.year', () {
    test('apiValueは"year"', () {
      expect(AnalyticsPeriod.year.apiValue, 'year');
    });

    test('labelは"年"', () {
      expect(AnalyticsPeriod.year.label, '年');
    });
  });

  group('AnalyticsPeriodSelection(year)', () {
    test('containsJstToday: 同じ年ならtrue', () {
      final selection = AnalyticsPeriodSelection(period: AnalyticsPeriod.year, date: '2026-01-01');
      expect(selection.containsJstToday(today: '2026-08-15'), isTrue);
    });

    test('containsJstToday: 違う年ならfalse', () {
      final selection = AnalyticsPeriodSelection(period: AnalyticsPeriod.year, date: '2025-12-31');
      expect(selection.containsJstToday(today: '2026-08-15'), isFalse);
    });

    test('shiftPrevious: 年初日でも前年の1/1になる', () {
      final selection = AnalyticsPeriodSelection(period: AnalyticsPeriod.year, date: '2026-06-15');
      expect(selection.shiftPrevious().date, '2025-01-01');
    });

    test('shiftNext: 翌年の1/1になる', () {
      final selection = AnalyticsPeriodSelection(period: AnalyticsPeriod.year, date: '2026-06-15');
      expect(selection.shiftNext().date, '2027-01-01');
    });

    test('withPeriod: dayからyearへ切り替えてもdateは維持', () {
      final selection = AnalyticsPeriodSelection(period: AnalyticsPeriod.day, date: '2026-08-15');
      final yearSelection = selection.withPeriod(AnalyticsPeriod.year);
      expect(yearSelection.period, AnalyticsPeriod.year);
      expect(yearSelection.date, '2026-08-15');
    });
  });
}
