// 設定タブに集約した読み上げ・効果音の設定。
//
// 固定ボイスの選択肢は同梱 vvm の静的な一覧(VoiceCatalog)から出す。VOICEVOX が返す
// 実際の一覧は読み上げを開始しないと存在せず、停止中に開くのが普通のこの画面では
// 使えないため。
import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/app_config_store.dart';
import 'package:live_sidestage_mobile/core/session_controller.dart';
import 'package:live_sidestage_mobile/screens/home_screen.dart' show SpeechState;
import 'package:live_sidestage_mobile/screens/tabs/settings_tab.dart';
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
          ChangeNotifierProvider<SessionController>(create: (_) => SessionController()),
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

  ListTile voiceTile(WidgetTester tester) =>
      tester.widget<ListTile>(find.widgetWithText(ListTile, 'ボイス'));

  /// タイトルで音量スライダーを1つに絞る（設定タブには読み上げと効果音の2つある）。
  Slider volumeSlider(WidgetTester tester, String title) => tester.widget<Slider>(
        find.descendant(
          of: find.widgetWithText(ListTile, title),
          matching: find.byType(Slider),
        ),
      );

  group('固定ボイスの選択', () {
    testWidgets('ランダムボイスON中は選べないが、選択中のボイスは見える', (tester) async {
      await pumpSettings(tester);

      // 既定はランダムON。
      expect(voiceTile(tester).onTap, isNull);
      expect(voiceTile(tester).enabled, isFalse);
      // 「OFFにすると使えます」だけに差し替えると、OFFにしたとき何の声になるのか
      // 確かめられない。
      expect(find.textContaining('四国めたん ノーマル'), findsOneWidget);
    });

    testWidgets('ランダムボイスOFFならシートから選べて、設定に保存される', (tester) async {
      final store = await pumpSettings(tester);
      await store.setRandomVoice(false);
      await tester.pumpAndSettle();

      expect(voiceTile(tester).onTap, isNotNull);

      await tester.tap(find.widgetWithText(ListTile, 'ボイス'));
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

      volumeSlider(tester, '読み上げの音量').onChanged!(30);
      await tester.pumpAndSettle();
      // つまみは指に付いてくるが、設定はまだ書き換わっていない。
      expect(find.text('30'), findsOneWidget);
      expect(store.config.ttsVolume, 100);

      volumeSlider(tester, '読み上げの音量').onChangeEnd!(30);
      await tester.pumpAndSettle();
      expect(store.config.ttsVolume, 30);
    });

    testWidgets('効果音の全体音量は運用中も触れる', (tester) async {
      await pumpSettings(tester);
      expect(volumeSlider(tester, '全体の音量').onChanged, isNotNull);
    });

    testWidgets('効果音の全体音量は開始/停止の遷移中だけ止める', (tester) async {
      await pumpSettings(tester, busy: true);
      expect(volumeSlider(tester, '全体の音量').onChanged, isNull);
    });
  });
}
