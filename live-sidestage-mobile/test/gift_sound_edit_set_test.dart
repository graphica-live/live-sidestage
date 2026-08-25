// 編集画面の保存先は「画面を開いたときのセット」で固定する。
//
// 「現在選択中のセット」を都度読み直す作りにすると、編集している間にセットが
// 切り替わったとき別のセットへ保存してしまう（しかも対象セットに同じ id の行が
// 無いので、上書きではなく**追加**になる）。
import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/app_config_store.dart';
import 'package:live_sidestage_mobile/models/app_config.dart';
import 'package:live_sidestage_mobile/screens/gift_sound_edit_screen.dart';
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

  /// メイン（ギフト1件）と setB（空）。選択はメイン。
  Future<AppConfigStore> storeWithTwoSets() async {
    final store = AppConfigStore();
    await store.load();
    await store.updateSound((c) => c
        .updateSet(SoundSet.defaultId, (_) => const [
              GiftSound(
                id: 'g1',
                giftName: 'rose',
                giftLabel: 'Rose',
                fileName: 'a.mp3',
                soundName: 'ぽん',
                volume: 50,
              ),
            ])
        .addSet('B', id: 'setB')
        .selectSet(SoundSet.defaultId));
    return store;
  }

  Future<void> pumpEditScreen(
    WidgetTester tester,
    AppConfigStore store, {
    required String setId,
    String? giftSoundId,
  }) async {
    await tester.pumpWidget(
      ChangeNotifierProvider<AppConfigStore>.value(
        value: store,
        child: MaterialApp(
          home: GiftSoundEditScreen(setId: setId, giftSoundId: giftSoundId),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  SoundSet setOf(AppConfigStore store, String id) =>
      store.sound.sets.firstWhere((s) => s.id == id);

  testWidgets('編集中に選択セットが変わっても、開いたときのセットへ保存する', (tester) async {
    final store = await storeWithTwoSets();
    await pumpEditScreen(tester, store, setId: SoundSet.defaultId, giftSoundId: 'g1');

    // 裏で選択が B へ移る（別タブ操作・復帰時の再選択など）。
    await store.updateSound((c) => c.selectSet('setB'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();

    expect(setOf(store, SoundSet.defaultId).gifts.map((g) => g.id), ['g1']);
    // 「現在選択中」へ保存していたら、ここに g1 が増えている。
    expect(setOf(store, 'setB').gifts, isEmpty);
  });

  testWidgets('新規追加も、開いたときのセットへ入る', (tester) async {
    final store = await storeWithTwoSets();
    await pumpEditScreen(tester, store, setId: 'setB');

    await store.updateSound((c) => c.selectSet(SoundSet.defaultId));
    await tester.pumpAndSettle();

    // 音が選ばれていないと保存できない。
    expect(tester.widget<TextButton>(find.widgetWithText(TextButton, '保存')).onPressed, isNull);
  });

  testWidgets('セットごと消えていたら編集画面を開かない', (tester) async {
    final store = await storeWithTwoSets();
    await store.updateSound((c) => c.removeSet('setB'));

    await pumpEditScreen(tester, store, setId: 'setB');

    expect(find.text('この設定は削除されています'), findsOneWidget);
  });
}
