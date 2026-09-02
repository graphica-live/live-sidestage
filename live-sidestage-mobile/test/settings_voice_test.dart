// 設定タブに集約した読み上げ・効果音の設定。
//
// 固定ボイスの選択肢は同梱 vvm の静的な一覧(VoiceCatalog)から出す。VOICEVOX が返す
// 実際の一覧は読み上げを開始しないと存在せず、停止中に開くのが普通のこの画面では
// 使えないため。
import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/account_status_store.dart';
import 'package:live_sidestage_mobile/core/app_config_store.dart';
import 'package:live_sidestage_mobile/core/battle_filter_store.dart';
import 'package:live_sidestage_mobile/core/session_controller.dart';
import 'package:live_sidestage_mobile/core/theme_mode_store.dart';
import 'package:live_sidestage_mobile/models/account_status.dart';
import 'package:live_sidestage_mobile/screens/home_screen.dart' show SpeechState;
import 'package:live_sidestage_mobile/screens/tabs/settings_tab.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

// このファイルのテストはプラン制限とは無関係な既存挙動(ボイス選択・音量)の確認が目的。
// FREE(fallback)だとボイス選択がロックされてしまうので、ULTRA相当で固定して検証する。
const _ultraStatus = AccountStatus(
  userId: 'u1',
  plan: 'ULTRA',
  mobileBetaActive: false,
  planLabel: 'ULTRA',
  features: ['mobile.history.extendedRange', 'mobile.history.listenerFilter'],
  minimumSupportedVersion: '0.0.0',
  maintenanceMode: false,
);

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

  Future<AppConfigStore> pumpSettings(
    WidgetTester tester, {
    bool busy = false,
    AppConfigStore? existing,
  }) async {
    final store = existing ?? AppConfigStore();
    if (existing == null) await store.load();

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AppConfigStore>.value(value: store),
          ChangeNotifierProvider<AccountStatusStore>(
            create: (_) => AccountStatusStore()
              ..status = _ultraStatus
              ..loaded = true,
          ),
          ChangeNotifierProvider<SessionController>(create: (_) => SessionController()),
          ChangeNotifierProvider<ThemeModeStore>(create: (_) => ThemeModeStore()),
          ChangeNotifierProvider<BattleFilterStore>(create: (_) => BattleFilterStore()),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: SettingsTab(
              speech: const SpeechState(),
              busy: busy,
              onChangeTiktokId: () async {},
              onBeforeLogout: () async {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return store;
  }

  /// 光彩デザインでは設定の各行が `ListTile` ではなく `InkWell` の行になった。
  /// 触れる/触れないは `onTap` が null かどうかで表れる。
  InkWell settingRow(WidgetTester tester, String title) => tester.widget<InkWell>(
        find.ancestor(of: find.text(title), matching: find.byType(InkWell)).first,
      );

  InkWell voiceTile(WidgetTester tester) => settingRow(tester, 'ボイス');

  /// 数値設定は一覧では「値 + ›」の行で、スライダーはタップで開くシートの中にある
  /// (`settings-tab-kosai/spec.md`)。開いた状態のスライダーを返す。
  Future<Slider> openVolumeSlider(WidgetTester tester, String title) async {
    await tester.tap(find.text(title));
    await tester.pumpAndSettle();
    return tester.widget<Slider>(find.byType(Slider));
  }

  Future<void> closeSheet(WidgetTester tester) async {
    Navigator.of(tester.element(find.byType(Slider))).pop();
    await tester.pumpAndSettle();
  }

  group('固定ボイスの選択', () {
    testWidgets('ランダムボイスON中は選べないが、選択中のボイスは見える', (tester) async {
      await pumpSettings(tester);

      // 既定はランダムON。
      expect(voiceTile(tester).onTap, isNull);
      // 「OFFにすると使えます」だけに差し替えると、OFFにしたとき何の声になるのか
      // 確かめられない。
      expect(find.textContaining('四国めたん ノーマル'), findsOneWidget);
    });

    testWidgets('ランダムボイスOFFならシートから選べて、設定に保存される', (tester) async {
      final store = await pumpSettings(tester);
      await store.setRandomVoice(false);
      await tester.pumpAndSettle();

      expect(voiceTile(tester).onTap, isNotNull);

      await tester.tap(find.text('ボイス'));
      await tester.pumpAndSettle();

      expect(find.text('ボイスを選ぶ'), findsOneWidget);
      expect(find.text('ずんだもん'), findsOneWidget);

      // 「あまあま」はキャラをまたいで重複するので、テキストではなく styleId で
      // 指す（1 = ずんだもん あまあま）。行はスクロールしないと生成されない。
      final target = find.byKey(const ValueKey('voice-style-1'));
      await tester.scrollUntilVisible(
        target,
        100,
        // 設定タブ自身も ListView なので、スクロール先をシート内に限定する。
        scrollable: find.descendant(
          of: find.byType(BottomSheet),
          matching: find.byType(Scrollable),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(target);
      await tester.pumpAndSettle();

      expect(store.config.fixedStyleId, 1);
      expect(find.text('ずんだもん あまあま'), findsOneWidget);
    });

    // ttsEnabled は「読み上げ機能のON/OFF設定」ではなく**開始しているか**の記録で、
    // 停止すると false になる。これで無効化すると「一度開始しないとボイスを選べない」
    // 画面になり、停止中でも選べるように静的カタログを持たせた意味が無くなる。
    testWidgets('読み上げを開始していなくても設定を触れる', (tester) async {
      final store = AppConfigStore();
      await store.load();
      await store.setFeatureMask(tts: false, sound: false);
      await store.setRandomVoice(false);
      await pumpSettings(tester, existing: store);

      expect(store.config.ttsEnabled, isFalse);
      expect(voiceTile(tester).onTap, isNotNull);
      expect((await openVolumeSlider(tester, '読み上げの音量')).onChanged, isNotNull);
      await closeSheet(tester);
      expect((await openVolumeSlider(tester, 'すべての効果音の音量')).onChanged, isNotNull);
      await closeSheet(tester);
    });

    testWidgets('同じボイスを選び直しても revision を進めない', (tester) async {
      final store = await pumpSettings(tester);
      await store.setRandomVoice(false);
      await tester.pumpAndSettle();

      final before = store.config.revision;
      await store.setFixedStyleId(store.config.fixedStyleId);

      expect(store.config.revision, before);
    });
  });

  group('音量', () {
    testWidgets('ドラッグ中は保存せず、指を離したときだけ保存する', (tester) async {
      final store = await pumpSettings(tester);

      final slider = await openVolumeSlider(tester, '読み上げの音量');
      slider.onChanged!(30);
      await tester.pumpAndSettle();
      // つまみは指に付いてくるが、設定はまだ書き換わっていない。
      expect(find.text('30'), findsOneWidget);
      expect(store.config.ttsVolume, 100);

      tester.widget<Slider>(find.byType(Slider)).onChangeEnd!(30);
      await tester.pumpAndSettle();
      expect(store.config.ttsVolume, 30);
      await closeSheet(tester);
    });

    testWidgets('効果音の全体音量は運用中も触れる', (tester) async {
      await pumpSettings(tester);
      expect((await openVolumeSlider(tester, 'すべての効果音の音量')).onChanged, isNotNull);
      await closeSheet(tester);
    });

    // 開始処理は「設定を保存 → サービス起動」の順に進むので、その間の変更は背景
    // Isolate へ渡らない。
    testWidgets('開始/停止の遷移中はどの設定も止める', (tester) async {
      await pumpSettings(tester, busy: true);

      // 行の onTap を null にするのでシート自体が開かない。
      expect(settingRow(tester, 'すべての効果音の音量').onTap, isNull);
      expect(settingRow(tester, '読み上げの音量').onTap, isNull);
      expect(voiceTile(tester).onTap, isNull);
      expect(tester.widget<Switch>(find.byType(Switch)).onChanged, isNull);
    });
  });
}
