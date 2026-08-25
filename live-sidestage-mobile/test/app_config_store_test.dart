// AppConfigStore の「読み上げ・効果音の有効状態」まわりの検証。
//
// ここで押さえたいのは2点。どちらも実際に踏んだ落とし穴に対応する。
//
//  1. 2つのフラグを1回の revision でまとめて書くこと。別々に保存すると、その間に
//     中間状態が背景 Isolate へ送られる。AppConfig の既定値は両方 true なので、
//     「停止中に読み上げだけ開始」を setTtsEnabled(true) では表現できない
//     （効果音も true のままなので一緒に起動してしまう）
//  2. サービス停止中の保存は ACK を待たないこと。待つと syncPending が永久に残り、
//     設定タブの「設定を反映中…」が消えず、音源ファイルの削除もブロックされる
import 'dart:convert';

import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/app_config_store.dart';
import 'package:live_sidestage_mobile/models/app_config.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// `isRunningService` だけ差し替えられる最小の実装。
/// `sendDataToTask` は呼ばれた回数だけ数える（稼働中に applyConfig を送るため）。
class _FakeForegroundTaskPlatform extends FlutterForegroundTaskPlatform
    with MockPlatformInterfaceMixin {
  _FakeForegroundTaskPlatform({required this.running});

  bool running;
  int sentToTaskCount = 0;

  @override
  Future<bool> get isRunningService async => running;

  @override
  void sendDataToTask(Object data) {
    sentToTaskCount++;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _FakeForegroundTaskPlatform platform;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    platform = _FakeForegroundTaskPlatform(running: false);
    FlutterForegroundTaskPlatform.instance = platform;
  });

  group('setFeatureMask', () {
    test('2つのフラグを1回のrevisionでまとめて書く', () async {
      final store = AppConfigStore();
      await store.load();
      final before = store.config.revision;

      await store.setFeatureMask(tts: true, sound: false);

      expect(store.config.ttsEnabled, isTrue);
      expect(store.sound.enabled, isFalse);
      expect(store.config.revision, before + 1);
    });

    // 既定値は両方 true。停止中からの「読み上げだけ開始」で効果音まで有効に
    // なってしまうのが、この API を足した理由そのもの。
    test('既定の両方ONから、押した機能だけを有効にできる', () async {
      final store = AppConfigStore();
      await store.load();
      expect(store.config.ttsEnabled, isTrue);
      expect(store.sound.enabled, isTrue);

      await store.setFeatureMask(tts: true, sound: false);

      expect(store.config.ttsEnabled, isTrue);
      expect(store.sound.enabled, isFalse);
    });

    test('変化がなければrevisionを進めない', () async {
      final store = AppConfigStore();
      await store.load();
      final before = store.config.revision;

      await store.setFeatureMask(tts: true, sound: true); // 既定値と同じ

      expect(store.config.revision, before);
    });

    test('効果音の他の設定(音量・ギフト一覧)は巻き込まない', () async {
      final store = AppConfigStore();
      await store.load();
      await store.updateSound((c) => c.copyWith(masterVolume: 42));

      await store.setFeatureMask(tts: false, sound: false);

      expect(store.sound.masterVolume, 42);
      expect(store.sound.enabled, isFalse);
    });

    test('保存した内容は読み直しても残る', () async {
      final store = AppConfigStore();
      await store.load();
      await store.setFeatureMask(tts: false, sound: true);

      final reloaded = AppConfigStore();
      await reloaded.load();

      expect(reloaded.config.ttsEnabled, isFalse);
      expect(reloaded.sound.enabled, isTrue);
    });
  });

  group('syncPending', () {
    test('サービス停止中の保存はACKを待たない', () async {
      final store = AppConfigStore();
      await store.load();

      await store.setFeatureMask(tts: false, sound: false);

      expect(store.syncPending, isFalse);
      expect(platform.sentToTaskCount, 0);
      // 待っても返らない ACK を待たないので、音源ファイルの削除もすぐ進む。
      expect(await store.waitForSync(), isTrue);
    });

    test('サービス稼働中の保存は背景へ送ってACKを待つ', () async {
      platform.running = true;
      final store = AppConfigStore();
      await store.load();

      await store.setFeatureMask(tts: true, sound: false);

      expect(store.syncPending, isTrue);
      expect(platform.sentToTaskCount, 1);

      store.onAck(store.config.revision);
      expect(store.syncPending, isFalse);
    });

    // 「最後の機能をOFFにする」操作は、先にサービスを止めてから保存する
    // （home_screen.dart の _toggleFeature）。その順序ならACK待ちに入らない。
    test('停止後に保存すればsyncPendingは残らない', () async {
      platform.running = true;
      final store = AppConfigStore();
      await store.load();

      platform.running = false; // _stopService() 相当
      await store.setFeatureMask(tts: false, sound: false);

      expect(store.syncPending, isFalse);
    });
  });

  group('セット操作', () {
    test('1回の操作で進む revision は1つ', () async {
      final store = AppConfigStore();
      await store.load();
      final before = store.config.revision;

      await store.updateSound((c) => c.addSet('ダンス', id: 'dance'));

      expect(store.config.revision, before + 1);
      expect(store.sound.sets.map((s) => s.id), [SoundSet.defaultId, 'dance']);
      expect(store.sound.selectedSetId, 'dance');
    });

    test('保存した内容は読み直しても残る', () async {
      final store = AppConfigStore();
      await store.load();
      await store.updateSound((c) => c
          .addSet('ダンス', id: 'dance')
          .updateSet('dance', (_) => const [
                GiftSound(id: 'g1', giftName: 'rose', fileName: 'a.mp3', volume: 30),
              ]));

      final reloaded = AppConfigStore();
      await reloaded.load();

      expect(reloaded.sound.sets.map((s) => s.id), [SoundSet.defaultId, 'dance']);
      expect(reloaded.sound.selectedSetId, 'dance');
      expect(reloaded.sound.selectedGifts.single.volume, 30);
    });

    test('全体音量はセットをまたいで共通', () async {
      final store = AppConfigStore();
      await store.load();
      await store.updateSound((c) => c.copyWith(masterVolume: 42).addSet('ダンス', id: 'dance'));

      await store.updateSound((c) => c.selectSet(SoundSet.defaultId));

      expect(store.sound.masterVolume, 42);
    });
  });

  // 新しいアプリで作った設定を古い形式で上書きすると、次のサービス起動で
  // pruneOrphans が音源の実ファイルまで消す。schemaVersion を上げるだけでは
  // 防げない（背景 Isolate は掃除をスキップするが、UI 側が保存し直してしまう）。
  group('未来バージョンの設定を上書きしない', () {
    Future<void> seedFutureConfig() {
      return FlutterForegroundTask.saveData(
        key: appConfigStorageKey,
        value: jsonEncode({
          'schemaVersion': AppConfig.currentSchemaVersion + 1,
          'revision': 9,
          'sound': {'somethingNew': true},
        }),
      );
    }

    Future<Object?> storedSchemaVersion() async {
      final raw = await FlutterForegroundTask.getData<String>(key: appConfigStorageKey);
      return (jsonDecode(raw!) as Map)['schemaVersion'];
    }

    test('読み込んだ時点で検出する', () async {
      await seedFutureConfig();
      final store = AppConfigStore();
      await store.load();

      expect(store.configFromFutureVersion, isTrue);
      expect(store.configReadable, isFalse);
    });

    test('setFeatureMask は保存しない', () async {
      await seedFutureConfig();
      final store = AppConfigStore();
      await store.load();

      await store.setFeatureMask(tts: false, sound: false);

      expect(await storedSchemaVersion(), AppConfig.currentSchemaVersion + 1);
    });

    test('updateSound は保存しない', () async {
      await seedFutureConfig();
      final store = AppConfigStore();
      await store.load();

      await store.updateSound((c) => c.addSet('ダンス', id: 'dance'));

      expect(await storedSchemaVersion(), AppConfig.currentSchemaVersion + 1);
      expect(store.sound.sets.any((s) => s.id == 'dance'), isFalse);
    });

    test('背景 Isolate へも送らない', () async {
      platform.running = true;
      await seedFutureConfig();
      final store = AppConfigStore();
      await store.load();

      await store.setTtsVolume(10);

      expect(platform.sentToTaskCount, 0);
      expect(store.syncPending, isFalse);
    });

    // 壊れたJSONは上書きで復旧させたい。未来バージョンと同じ扱いにしてはいけない。
    test('壊れたJSONは従来どおり上書きできる', () async {
      await FlutterForegroundTask.saveData(key: appConfigStorageKey, value: '{');
      final store = AppConfigStore();
      await store.load();

      expect(store.configFromFutureVersion, isFalse);
      await store.setFeatureMask(tts: false, sound: false);

      expect(await storedSchemaVersion(), AppConfig.currentSchemaVersion);
    });
  });
}
