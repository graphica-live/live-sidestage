// 停止中 = 設定モード / 開始中 = 運用モード の作り分け。
//
// ロックの条件は `started` ではなく **`started || busy`**。開始処理は
// 「設定を保存 → サービス起動」の順に進むので（home_screen.dart の _toggleFeature）、
// その途中は設定だけ有効でサービスがまだ動いておらず、started は false のままになる。
// そこで編集を許すと、背景 Isolate へ渡らない変更や起動と競合する変更が入る。
import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/account_status_store.dart';
import 'package:live_sidestage_mobile/core/app_config_store.dart';
import 'package:live_sidestage_mobile/core/feature_status.dart';
import 'package:live_sidestage_mobile/models/app_config.dart';
import 'package:live_sidestage_mobile/screens/home_screen.dart' show SoundState;
import 'package:live_sidestage_mobile/screens/tabs/sound_tab.dart';
import 'package:live_sidestage_mobile/screens/widgets/gradient_kit.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _StoppedForegroundTaskPlatform extends FlutterForegroundTaskPlatform
    with MockPlatformInterfaceMixin {
  @override
  Future<bool> get isRunningService async => false;

  @override
  void sendDataToTask(Object data) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterForegroundTaskPlatform.instance = _StoppedForegroundTaskPlatform();
  });

  /// 「メイン」を A に改名し、B を足して A を選択した状態。A にギフトが1件ある。
  Future<AppConfigStore> storeWithTwoSets() async {
    final store = AppConfigStore();
    await store.load();
    await store.updateSound((c) => c
        .renameSet(SoundSet.defaultId, 'A')
        .addSet('B', id: 'setB')
        .updateSet(SoundSet.defaultId, (_) => const [
              GiftSound(
                id: 'g1',
                giftName: 'rose',
                giftLabel: 'Rose',
                fileName: 'a.mp3',
                soundName: 'ぽん',
              ),
            ])
        .selectSet(SoundSet.defaultId));
    return store;
  }

  Future<void> pumpTab(
    WidgetTester tester,
    AppConfigStore store, {
    required bool started,
    required bool busy,
  }) async {
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AppConfigStore>.value(value: store),
          ChangeNotifierProvider<AccountStatusStore>(create: (_) => AccountStatusStore()),
        ],
        child: MaterialApp(
          home: SoundTab(
            sound: const SoundState(),
            status: started ? FeatureStatus.live : FeatureStatus.stopped,
            errors: const [],
            notice: null,
            started: started,
            busy: busy,
            onToggle: (_) {},
          ),
        ),
      ),
    );
    // busy 中は開始ボタンが CircularProgressIndicator を回し続けるので、
    // pumpAndSettle は永久に返ってこない。
    if (busy) {
      await tester.pump();
    } else {
      await tester.pumpAndSettle();
    }
  }

  Switch giftSwitch(WidgetTester tester) => tester.widget<Switch>(find.byType(Switch));

  /// 「＋追加」は光彩デザインで `ActionChip` から [KosaiChip] へ変わった。
  /// **押せる/押せないは `onTap` ではなく `dimmed` で示す**（押せば理由を伝えるため）。
  KosaiChip addChip(WidgetTester tester) => tester.widget<KosaiChip>(
        find.ancestor(of: find.text('＋追加'), matching: find.byType(KosaiChip)),
      );

  KosaiExtendedFab fab(WidgetTester tester) =>
      tester.widget<KosaiExtendedFab>(find.byType(KosaiExtendedFab));

  /// 「音を追加」はロック中も押せる（押されたら停止を促す）ので、ロックは
  /// `onPressed` ではなく薄さで示している。
  double fabOpacity(WidgetTester tester) => fab(tester).dimmed ? 0.45 : 1;

  group('停止中は設定モード', () {
    testWidgets('「現在のセット」を出す', (tester) async {
      await pumpTab(tester, await storeWithTwoSets(), started: false, busy: false);
      expect(find.text('現在のセット：A'), findsOneWidget);
    });

    testWidgets('タブを押すとその場でセットが変わる', (tester) async {
      final store = await storeWithTwoSets();
      await pumpTab(tester, store, started: false, busy: false);

      await tester.tap(find.text('B'));
      await tester.pumpAndSettle();

      expect(store.sound.selectedSetId, 'setB');
      expect(find.text('現在のセット：B'), findsOneWidget);
    });

    testWidgets('セット操作・追加・ギフト編集がすべて有効', (tester) async {
      await pumpTab(tester, await storeWithTwoSets(), started: false, busy: false);

      expect(find.byIcon(Icons.more_horiz), findsOneWidget);
      expect(addChip(tester).dimmed, isFalse);
      expect(giftSwitch(tester).onChanged, isNotNull);
      expect(fab(tester).onPressed, isNotNull);
      expect(fabOpacity(tester), 1);
    });
  });

  group('開始中は運用モード', () {
    testWidgets('「使用中」を出す', (tester) async {
      await pumpTab(tester, await storeWithTwoSets(), started: true, busy: false);
      expect(find.text('使用中：A'), findsOneWidget);
    });

    testWidgets('他セットを押してもセットは変わらず、停止を促す', (tester) async {
      final store = await storeWithTwoSets();
      await pumpTab(tester, store, started: true, busy: false);

      await tester.tap(find.text('B'));
      await tester.pump();

      expect(store.sound.selectedSetId, SoundSet.defaultId);
      expect(find.text('セットを変更するには停止してください'), findsOneWidget);
      // 案内のSnackBarはTimerで自動的に消す実装。ウィジェットdispose前に消化しないと
      // 「pending timer」でテストが落ちる(showTimedNotice参照)。
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('ギフト行を押しても画面遷移せず、停止を促す', (tester) async {
      final store = await storeWithTwoSets();
      await pumpTab(tester, store, started: true, busy: false);

      await tester.tap(find.text('Rose'));
      await tester.pump();

      expect(find.text('設定を変更するには停止してください'), findsOneWidget);
      // 編集画面へ行っていない（一覧のままである）。
      expect(find.text('使用中：A'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('「音を追加」を押しても画面遷移せず、停止を促す', (tester) async {
      await pumpTab(tester, await storeWithTwoSets(), started: true, busy: false);

      await tester.tap(find.text('音を追加'));
      await tester.pump();

      expect(find.text('設定を変更するには停止してください'), findsOneWidget);
      // 編集画面へ行っていない（一覧のままである）。
      expect(find.text('使用中：A'), findsOneWidget);
      // 押せる状態のままなので、ロックは薄さで示す。
      expect(fabOpacity(tester), lessThan(1));
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('セット追加・操作メニュー・Switch を禁止する', (tester) async {
      await pumpTab(tester, await storeWithTwoSets(), started: true, busy: false);

      // 全項目が禁止なので、空のメニューを出す意味がない。
      expect(find.byIcon(Icons.more_horiz), findsNothing);
      // 消すとタブ行の幅が変わって並びが飛ぶので、非表示ではなく薄くする。
      expect(addChip(tester).dimmed, isTrue);
      expect(giftSwitch(tester).onChanged, isNull);
    });

    // 全体音量は設定タブへ移した（運用中も触れること・遷移中は止まることの検証は
    // settings_voice_test.dart にある）。
  });

  group('開始/停止の遷移中(busy)', () {
    testWidgets('started が false でも構造変更を止める', (tester) async {
      final store = await storeWithTwoSets();
      await pumpTab(tester, store, started: false, busy: true);

      await tester.tap(find.text('B'));
      await tester.pump();

      expect(store.sound.selectedSetId, SoundSet.defaultId);
      expect(find.text('セットを変更するには停止してください'), findsOneWidget);
      expect(find.byIcon(Icons.more_horiz), findsNothing);
      expect(addChip(tester).dimmed, isTrue);
      expect(giftSwitch(tester).onChanged, isNull);
      expect(fabOpacity(tester), lessThan(1));
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('遷移中も「音を追加」は停止を促す', (tester) async {
      await pumpTab(tester, await storeWithTwoSets(), started: false, busy: true);

      await tester.tap(find.text('音を追加'));
      await tester.pump();

      expect(find.text('設定を変更するには停止してください'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
    });
  });

  group('セット数の上限', () {
    testWidgets('上限に達したら「＋」を薄くする', (tester) async {
      final store = AppConfigStore();
      await store.load();
      await store.updateSound((c) {
        var next = c;
        for (var i = 1; i < SoundConfig.maxSets; i++) {
          next = next.addSet('セット$i', id: 'set$i');
        }
        return next;
      });
      expect(store.sound.sets, hasLength(SoundConfig.maxSets));

      await pumpTab(tester, store, started: false, busy: false);

      expect(addChip(tester).dimmed, isTrue);
    });
  });
}
