import 'package:flutter/material.dart';
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

  testWidgets('scheduleClampToDayOnlyHistoryPeriodはFREE相当でweek選択をtodayのdayへ戻す', (tester) async {
    AnalyticsPeriodSelection? clamped;

    await tester.pumpWidget(
      MaterialApp(
        home: _ClampScheduleHost(
          onSchedule: (schedule) => schedule(
            mounted: true,
            extendedRangeAllowed: false,
            hasCustomRange: false,
            selection: AnalyticsPeriodSelection(period: AnalyticsPeriod.week, date: '2026-09-12'),
            onClamp: (c) => clamped = c,
          ),
        ),
      ),
    );
    await tester.pump();

    expect(clamped?.period, AnalyticsPeriod.day);
    expect(clamped?.date, isNotEmpty);
  });
}

class _ClampScheduleHost extends StatefulWidget {
  const _ClampScheduleHost({required this.onSchedule});

  final void Function(void Function({
    required bool mounted,
    required bool extendedRangeAllowed,
    required bool hasCustomRange,
    required AnalyticsPeriodSelection selection,
    required void Function(AnalyticsPeriodSelection clamped) onClamp,
  }) schedule) onSchedule;

  @override
  State<_ClampScheduleHost> createState() => _ClampScheduleHostState();
}

class _ClampScheduleHostState extends State<_ClampScheduleHost> {
  @override
  void initState() {
    super.initState();
    widget.onSchedule(scheduleClampToDayOnlyHistoryPeriod);
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
