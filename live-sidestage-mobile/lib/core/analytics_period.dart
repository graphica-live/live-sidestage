import 'package:flutter/material.dart' show DateTimeRange;

/// 貢献/ギフト履歴/バトル履歴タブが共有する期間種別。サーバー側 `period` クエリと同じ4値。
enum AnalyticsPeriod {
  day,
  week,
  month,
  year;

  /// クエリパラメータへそのまま渡せる値("day"/"week"/"month"/"year")。
  String get apiValue => name;

  String get label => switch (this) {
        AnalyticsPeriod.day => '日',
        AnalyticsPeriod.week => '週',
        AnalyticsPeriod.month => '月',
        AnalyticsPeriod.year => '年',
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
  /// week は月曜起点（日曜は -6 補正）、month は暦月、year は暦年。ここがずれると、
  /// 週や年の境目だけ自動更新されない／されすぎる、という気づきにくい食い違いになる。
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
      case AnalyticsPeriod.year:
        return date.substring(0, 4) == t.substring(0, 4);
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
      case AnalyticsPeriod.year:
        // 年移動も同様に1/1へ丸める。getDateRange()はdateの「年」しか見ない。
        shifted = DateTime.utc(base.year + direction, 1, 1);
    }
    return AnalyticsPeriodSelection(period: period, date: _formatDate(shifted));
  }
}

/// 日付ピッカー/時刻ピッカーが返した「JSTの壁時計」の年月日時分を、対応するUTC時刻に変換する。
///
/// `showDatePicker`/`showTimePicker`はいずれも「時計の見た目の数字」を返すだけで、端末の
/// タイムゾーン設定とは無関係。素朴に`.toUtc()`すると端末設定に引きずられるため、呼び出し側は
/// ピッカーが返した年月日時分の数値を`DateTime.utc(...)`でいったんUTC成分として組み立ててから
/// この関数へ渡し、「JSTの壁時計である」という意味づけをここで確定させる(端末ローカルの
/// `DateTime(...)`コンストラクタを経由しない — 理論上はタイムゾーン正規化の影響を受けうるため)。
DateTime jstWallClockToUtc(DateTime jstLocalWallClock) {
  return DateTime.utc(
    jstLocalWallClock.year,
    jstLocalWallClock.month,
    jstLocalWallClock.day,
    jstLocalWallClock.hour,
    jstLocalWallClock.minute,
    jstLocalWallClock.second,
    jstLocalWallClock.millisecond,
  ).subtract(const Duration(hours: 9));
}

/// [jstWallClockToUtc]の逆変換。UTCの絶対時刻をJST壁時計の年月日時分に戻す
/// (既存の[jstDateKeyOf]と同じ+9時間シフト)。既存のカスタム範囲を再度開いて調整する場合
/// (ピッカーのinitialDate/initialTime)や、行の表示に使う。
DateTime jstWallClockFromUtc(DateTime utcInstant) {
  return utcInstant.toUtc().add(const Duration(hours: 9));
}

String _formatJstDateTime(DateTime utcInstant) {
  final jst = jstWallClockFromUtc(utcInstant);
  final y = jst.year.toString().padLeft(4, '0');
  final m = jst.month.toString().padLeft(2, '0');
  final d = jst.day.toString().padLeft(2, '0');
  final hh = jst.hour.toString().padLeft(2, '0');
  final mi = jst.minute.toString().padLeft(2, '0');
  return '$y/$m/$d $hh:$mi';
}

/// UTCレンジをJST(+9)表示に変換し、"2026/08/30 18:00 〜 2026/08/30 23:00"形式に整形する。
/// 年を常に含める(366日範囲で年をまたぎ得るため)。
String formatDateTimeRangeLabel(DateTimeRange utcRange) {
  return '${_formatJstDateTime(utcRange.start)} 〜 ${_formatJstDateTime(utcRange.end)}';
}

/// [utcRange]が「現在(UTC)」を含むか。カスタム範囲表示中のライブ自動更新(silent reload)を
/// 続けるかどうかの判定に使う。
bool customRangeContainsNow(DateTimeRange utcRange) {
  final now = DateTime.now().toUtc();
  return !now.isBefore(utcRange.start) && !now.isAfter(utcRange.end);
}
