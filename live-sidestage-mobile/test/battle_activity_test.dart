import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/analytics_period.dart';
import 'package:live_sidestage_mobile/core/battle_activity.dart';

void main() {
  group('BattleActivityNotifier', () {
    test('最後の通知から debounce 後に1回だけ発火する', () {
      fakeAsync((async) {
        final n = BattleActivityNotifier(
          debounce: const Duration(seconds: 2),
          maxWait: const Duration(seconds: 6),
        );
        var fired = 0;
        n.addListener(() => fired++);

        n.onBattleTick('2026-08-28');
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

    test('END直後とEND後のスコア確定が連続で届いても、maxWait で必ず1回発火する', () {
      fakeAsync((async) {
        final n = BattleActivityNotifier(
          debounce: const Duration(seconds: 2),
          maxWait: const Duration(seconds: 6),
        );
        var fired = 0;
        n.addListener(() => fired++);

        for (var i = 0; i < 8; i++) {
          n.onBattleTick('2026-08-28');
          async.elapse(const Duration(seconds: 1));
        }

        expect(fired, greaterThanOrEqualTo(1), reason: 'maxWait で必ず更新されること');
        n.dispose();
      });
    });

    test('直近に届いた通知のバトル開始日を保持する', () {
      fakeAsync((async) {
        final n = BattleActivityNotifier(
          debounce: const Duration(seconds: 2),
          maxWait: const Duration(seconds: 6),
        );

        n.onBattleTick('2026-08-27');
        expect(n.lastStartedDateKey, '2026-08-27');
        n.onBattleTick('2026-08-28');
        expect(n.lastStartedDateKey, '2026-08-28');

        async.elapse(const Duration(seconds: 10));
        n.dispose();
      });
    });

    test('dispose 後は発火しない', () {
      fakeAsync((async) {
        final n = BattleActivityNotifier(debounce: const Duration(seconds: 2));
        var fired = 0;
        n.addListener(() => fired++);

        n.onBattleTick('2026-08-28');
        n.dispose();
        async.elapse(const Duration(seconds: 10));
        expect(fired, 0);
      });
    });
  });

  group('battleAutoReloadAction', () {
    test('通知のバトル開始日が今の選択期間に含まれないときは何もしない', () {
      for (final active in [true, false]) {
        for (final resumed in [true, false]) {
          expect(
            battleAutoReloadAction(active: active, resumed: resumed, containsStartedDate: false),
            BattleAutoReloadAction.ignore,
          );
        }
      }
    });

    test('見えていない・前面に無いときは後回しにする', () {
      expect(
        battleAutoReloadAction(active: false, resumed: true, containsStartedDate: true),
        BattleAutoReloadAction.defer,
      );
      expect(
        battleAutoReloadAction(active: true, resumed: false, containsStartedDate: true),
        BattleAutoReloadAction.defer,
      );
    });

    test('見えていて前面で、バトル開始日を含む期間を見ているときだけ取り直す', () {
      expect(
        battleAutoReloadAction(active: true, resumed: true, containsStartedDate: true),
        BattleAutoReloadAction.reload,
      );
    });
  });

  group('jstDateKeyOf', () {
    test('深夜0時をまたぐバトルでも、開始時刻の日付で判定できる', () {
      // UTC 15:30 = JST 翌日00:30。「今日」ではなく開始日で判定する意義そのもの。
      final startedAt = DateTime.utc(2026, 8, 27, 15, 30);
      expect(jstDateKeyOf(startedAt), '2026-08-28');
    });
  });
}
