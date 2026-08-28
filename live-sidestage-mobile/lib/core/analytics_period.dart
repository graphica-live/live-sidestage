/// 貢献/ギフト履歴/バトル履歴タブが共有する期間種別。サーバー側 `period` クエリと同じ3値。
enum AnalyticsPeriod {
  day,
  week,
  month;

  /// クエリパラメータへそのまま渡せる値("day"/"week"/"month")。
  String get apiValue => name;

  String get label => switch (this) {
        AnalyticsPeriod.day => '日',
        AnalyticsPeriod.week => '週',
        AnalyticsPeriod.month => '月',
      };
}

/// JSTの今日の日付("YYYY-MM-DD")。サーバー(overlay/day-key.tsのjstDateKey)と同じ計算。
///
/// `DateTime.now()`は端末のローカルタイムゾーンなので、そのまま使うとJST圏外の端末や
/// UTC設定の端末で日付がずれる。UTCへ正規化してから+9時間する。
String jstTodayDateKey() {
  final jstNow = DateTime.now().toUtc().add(const Duration(hours: 9));
  return _formatDate(jstNow);
}

String _formatDate(DateTime d) {
  final y = d.year.toString().padLeft(4, '0');
  final m = d.month.toString().padLeft(2, '0');
  final day = d.day.toString().padLeft(2, '0');
  return '$y-$m-$day';
}

/// 期間タブが共有する「期間の種類 + 基準日」。[date] はJSTの"YYYY-MM-DD"。
class AnalyticsPeriodSelection {
  final AnalyticsPeriod period;
  final String date;

  const AnalyticsPeriodSelection({required this.period, required this.date});

  factory AnalyticsPeriodSelection.today() {
    return AnalyticsPeriodSelection(period: AnalyticsPeriod.day, date: jstTodayDateKey());
  }

  AnalyticsPeriodSelection withPeriod(AnalyticsPeriod newPeriod) {
    return AnalyticsPeriodSelection(period: newPeriod, date: date);
  }

  AnalyticsPeriodSelection shiftPrevious() => _shift(-1);
  AnalyticsPeriodSelection shiftNext() => _shift(1);

  AnalyticsPeriodSelection _shift(int direction) {
    final parts = date.split('-').map(int.parse).toList();
    final base = DateTime.utc(parts[0], parts[1], parts[2]);
    final DateTime shifted;
    switch (period) {
      case AnalyticsPeriod.day:
        shifted = base.add(Duration(days: direction));
      case AnalyticsPeriod.week:
        shifted = base.add(Duration(days: 7 * direction));
      case AnalyticsPeriod.month:
        // 月移動は月初に丸める。day=31のまま月をまたぐとDateTimeが自動繰り上げて
        // 意図しない月になる(例: 1/31の1ヶ月前を2/2などに解釈しうる)ため。
        // getDateRange()はdateの「月」しか見ないので、day=1に丸めても実害は無い。
        shifted = DateTime.utc(base.year, base.month + direction, 1);
    }
    return AnalyticsPeriodSelection(period: period, date: _formatDate(shifted));
  }
}
