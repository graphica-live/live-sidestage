import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/analytics_period.dart';
import 'package:live_sidestage_mobile/core/gift_activity.dart';

void main() {
  group('GiftActivityNotifier', () {
    test('最後のギフトから debounce 後に1回だけ通知する', () {
      fakeAsync((async) {
        final n = GiftActivityNotifier(
          debounce: const Duration(seconds: 2),
          maxWait: const Duration(seconds: 6),
        );
        var fired = 0;
        n.addListener(() => fired++);

        n.onGiftTick();
        async.elapse(const Duration(milliseconds: 1900));
        // まだ待っている。ここで取りに行くと、サーバー側のDB書き込みが
        // 終わっていないので古い数字が返る。
        expect(fired, 0);

        async.elapse(const Duration(milliseconds: 200));
        expect(fired, 1);

        async.elapse(const Duration(seconds: 10));
        expect(fired, 1);
        n.dispose();
      });
    });

    test('連打中は debounce が延び続けるが、maxWait で必ず1回通知する', () {
      fakeAsync((async) {
        final n = GiftActivityNotifier(
          debounce: const Duration(seconds: 2),
          maxWait: const Duration(seconds: 6),
        );
        var fired = 0;
        n.addListener(() => fired++);

        // 1秒おきにギフトが届き続ける。debounce(2秒)だけなら永久に発火しない。
        for (var i = 0; i < 8; i++) {
          n.onGiftTick();
          async.elapse(const Duration(seconds: 1));
        }

        expect(fired, greaterThanOrEqualTo(1), reason: 'maxWait で必ず更新されること');
        n.dispose();
      });
    });

    test('連打が止まれば、最後に必ずもう一度通知する', () {
      fakeAsync((async) {
        final n = GiftActivityNotifier(
          debounce: const Duration(seconds: 2),
          maxWait: const Duration(seconds: 6),
        );
        var fired = 0;
        n.addListener(() => fired++);

        for (var i = 0; i < 8; i++) {
          n.onGiftTick();
          async.elapse(const Duration(seconds: 1));
        }
        final duringCombo = fired;

        // コンボ終了。最終tickの2秒後に最終同期が入る。
        async.elapse(const Duration(seconds: 3));
        expect(fired, greaterThan(duringCombo));
        n.dispose();
      });
    });

    test('dispose 後は発火しない', () {
      fakeAsync((async) {
        final n = GiftActivityNotifier(debounce: const Duration(seconds: 2));
        var fired = 0;
        n.addListener(() => fired++);

        n.onGiftTick();
        n.dispose();
        async.elapse(const Duration(seconds: 10));
        expect(fired, 0);
      });
    });
  });

  group('giftAutoReloadAction', () {
    test('過去の期間を見ているときは何もしない', () {
      // ここで取り直すと、過去の数字が勝手に動いたように見える。
      for (final active in [true, false]) {
        for (final resumed in [true, false]) {
          expect(
            giftAutoReloadAction(active: active, resumed: resumed, containsToday: false),
            GiftAutoReloadAction.ignore,
          );
        }
      }
    });

    test('見えていない・前面に無いときは後回しにする', () {
      expect(
        giftAutoReloadAction(active: false, resumed: true, containsToday: true),
        GiftAutoReloadAction.defer,
      );
      expect(
        giftAutoReloadAction(active: true, resumed: false, containsToday: true),
        GiftAutoReloadAction.defer,
      );
    });

    test('見えていて前面で今日を見ているときだけ取り直す', () {
      expect(
        giftAutoReloadAction(active: true, resumed: true, containsToday: true),
        GiftAutoReloadAction.reload,
      );
    });
  });

  group('AnalyticsPeriodSelection.containsJstToday', () {
    AnalyticsPeriodSelection sel(AnalyticsPeriod p, String date) =>
        AnalyticsPeriodSelection(period: p, date: date);

    test('日は完全一致のみ', () {
      expect(sel(AnalyticsPeriod.day, '2026-08-28').containsJstToday(today: '2026-08-28'), isTrue);
      expect(sel(AnalyticsPeriod.day, '2026-08-27').containsJstToday(today: '2026-08-28'), isFalse);
    });

    test('週は月曜起点。日曜も同じ週に含める', () {
      // 2026-08-28 は金曜。その週は 08-24(月)〜08-30(日)。
      expect(sel(AnalyticsPeriod.week, '2026-08-24').containsJstToday(today: '2026-08-28'), isTrue);
      expect(sel(AnalyticsPeriod.week, '2026-08-30').containsJstToday(today: '2026-08-28'), isTrue);
      // 前の週を見ているときは更新しない。
      expect(sel(AnalyticsPeriod.week, '2026-08-23').containsJstToday(today: '2026-08-28'), isFalse);
      expect(sel(AnalyticsPeriod.week, '2026-08-31').containsJstToday(today: '2026-08-28'), isFalse);
    });

    test('日曜を基準日にしても、その日を含む週として扱う', () {
      // サーバー getDateRange の `day === 0 ? -6 : 1 - day` と同じ結果になること。
      expect(sel(AnalyticsPeriod.week, '2026-08-30').containsJstToday(today: '2026-08-24'), isTrue);
    });

    test('月は同じ年月のみ', () {
      expect(sel(AnalyticsPeriod.month, '2026-08-01').containsJstToday(today: '2026-08-28'), isTrue);
      expect(sel(AnalyticsPeriod.month, '2026-08-31').containsJstToday(today: '2026-08-28'), isTrue);
      expect(sel(AnalyticsPeriod.month, '2026-07-31').containsJstToday(today: '2026-08-01'), isFalse);
    });
  });
}
