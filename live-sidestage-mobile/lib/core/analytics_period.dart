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
String jstTodayDateKey() => jstDateKeyOf(DateTime.now());

/// 任意の時刻をJSTの日付("YYYY-MM-DD")へ変換する。
///
/// `DateTime.now()`は端末のローカルタイムゾーンなので、そのまま使うとJST圏外の端末や
/// UTC設定の端末で日付がずれる。UTCへ正規化してから+9時間する。バトル終了通知の
/// `startedAt`のように「今」ではない時刻をJST日付キーにするときはこちらを使う
/// (「今日」ではなくバトルの開始日で期間判定するため — 深夜0時をまたぐバトルが
/// 「今日」判定だと漏れる)。
String jstDateKeyOf(DateTime instant) {
  final jst = instant.toUtc().add(const Duration(hours: 9));
  return _formatDate(jst);
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

  /// 表示中の期間が「JSTの今日」を含むか。
  ///
  /// **ギフト受信での自動更新は、これが true のときだけ行うこと。** 先月や昨日を
  /// 見ているときに取り直すと、過去の数字が勝手に動いたように見える。
  ///
  /// 判定はサーバー `gift-analytics.ts` の `getDateRange` と**同じ規則**にしてある。
  /// week は月曜起点（日曜は -6 補正）、month は暦月。ここがずれると、週の境目だけ
  /// 自動更新されない／されすぎる、という気づきにくい食い違いになる。
  ///
  /// サーバー応答の期間には頼らない。初回ロード前は手元に無いし、期間を切り替えた
  /// 直後は古い応答が残っている。
  bool containsJstToday({String? today}) {
    final t = today ?? jstTodayDateKey();
    switch (period) {
      case AnalyticsPeriod.day:
        return date == t;
      case AnalyticsPeriod.week:
        final base = _parse(date);
        final weekday = base.weekday; // DateTime は月=1..日=7
        final monday = base.subtract(Duration(days: weekday - 1));
        final sunday = monday.add(const Duration(days: 6));
        final target = _parse(t);
        return !target.isBefore(monday) && !target.isAfter(sunday);
      case AnalyticsPeriod.month:
        return date.substring(0, 7) == t.substring(0, 7);
    }
  }

  static DateTime _parse(String date) {
    final parts = date.split('-').map(int.parse).toList();
    return DateTime.utc(parts[0], parts[1], parts[2]);
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
