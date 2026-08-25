// 音源の実ファイルを消してよいかの判定。
//
// セット複製は `fileName` を引き継ぐので、1つの実ファイルを複数の GiftSound が
// 参照しうる。「その行を消したから実ファイルも消してよい」とは限らない、というのが
// この改修で変わった前提で、ここはその前提を実ファイルごと固定する。
//
// 純粋な `referencedFileNames` の単体テストは app_config_test.dart 側にある。
// こちらは実ディレクトリを使って、掃除と削除が本当にファイルを残す/消すことを見る。
import 'dart:io';

import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/app_config_store.dart';
import 'package:live_sidestage_mobile/core/sound_file_cleanup.dart';
import 'package:live_sidestage_mobile/core/sound_library.dart';
import 'package:live_sidestage_mobile/models/app_config.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// サービスは停止しているものとして扱う。停止中は ACK を待たないので、
/// `waitForSync()` が即 true を返す（= 削除まで進む）。
class _StoppedForegroundTaskPlatform extends FlutterForegroundTaskPlatform
    with MockPlatformInterfaceMixin {
  @override
  Future<bool> get isRunningService async => false;

  @override
  void sendDataToTask(Object data) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory root;
  late SoundLibrary library;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterForegroundTaskPlatform.instance = _StoppedForegroundTaskPlatform();
    root = Directory.systemTemp.createTempSync('sound_file_lifecycle_test');
    library = SoundLibrary(overrideDirectory: root);
  });

  tearDown(() {
    library.dispose();
    if (root.existsSync()) root.deleteSync(recursive: true);
  });

  Future<File> putSound(String fileName) async {
    final dir = await library.soundsDirectory();
    return File('${dir.path}${Platform.pathSeparator}$fileName')
      ..writeAsStringSync('dummy');
  }

  GiftSound giftSound(String id, String fileName) =>
      GiftSound(id: id, giftName: '', fileName: fileName);

  Future<AppConfigStore> loadedStore() async {
    final store = AppConfigStore();
    await store.load();
    return store;
  }

  group('pruneOrphans', () {
    test('選択していないセットの音源を消さない', () async {
      final a = await putSound('a.mp3');
      final b = await putSound('b.mp3');
      final orphan = await putSound('orphan.mp3');

      final config = SoundConfig(
        sets: [
          SoundSet(id: 'a', gifts: [giftSound('g1', 'a.mp3')]),
          SoundSet(id: 'b', gifts: [giftSound('g2', 'b.mp3')]),
        ],
        selectedSetId: 'a',
      );

      // minAge は取り込み直後のファイルを守るための猶予。ここでは邪魔なので外す。
      final removed = await library.pruneOrphans(
        config.referencedFileNames,
        minAge: Duration.zero,
      );

      expect(removed, 1);
      expect(a.existsSync(), isTrue);
      // 裏のセットが使っているだけで、選択中セットからは見えない。ここを
      // selectedGifts で渡すと消える。
      expect(b.existsSync(), isTrue);
      expect(orphan.existsSync(), isFalse);
    });

    test('参照が空なら全部消える', () async {
      final a = await putSound('a.mp3');
      final removed = await library.pruneOrphans(const <String>{}, minAge: Duration.zero);

      expect(removed, 1);
      expect(a.existsSync(), isFalse);
    });
  });

  group('deleteUnreferencedSoundFiles', () {
    test('どこからも参照されなくなったファイルは消す', () async {
      final lonely = await putSound('lonely.mp3');

      final store = await loadedStore();
      await store.updateSound(
        (c) => c.updateSet(SoundSet.defaultId, (_) => [giftSound('g1', 'lonely.mp3')]),
      );
      await store.updateSound((c) => c.updateSet(SoundSet.defaultId, (_) => const []));

      await deleteUnreferencedSoundFiles(store, library, ['lonely.mp3']);

      expect(lonely.existsSync(), isFalse);
    });

    test('複製で共有したファイルは、片方のギフト行を消しても残る', () async {
      final shared = await putSound('shared.mp3');

      final store = await loadedStore();
      await store.updateSound(
        (c) => c.updateSet(SoundSet.defaultId, (_) => [giftSound('g1', 'shared.mp3')]),
      );
      await store.updateSound((c) => c.duplicateSet(SoundSet.defaultId, 'コピー', id: 'copy'));
      // 複製元の行を消す。複製先はまだ同じ実ファイルを指している。
      await store.updateSound((c) => c.updateSet(SoundSet.defaultId, (_) => const []));

      await deleteUnreferencedSoundFiles(store, library, ['shared.mp3']);

      expect(shared.existsSync(), isTrue);
    });

    test('セットごと消しても、他セットが使うファイルは残す', () async {
      final shared = await putSound('shared.mp3');
      final only = await putSound('only.mp3');

      final store = await loadedStore();
      await store.updateSound(
        (c) => c.updateSet(SoundSet.defaultId, (_) => [giftSound('g1', 'shared.mp3')]),
      );
      await store.updateSound((c) => c.duplicateSet(SoundSet.defaultId, 'コピー', id: 'copy'));
      // 複製先だけが持つ音源を足す。
      await store.updateSound(
        (c) => c.updateSet('copy', (gifts) => [...gifts, giftSound('g9', 'only.mp3')]),
      );

      final removedSet = store.sound.sets.firstWhere((s) => s.id == 'copy');
      final candidates = [for (final g in removedSet.gifts) g.fileName];
      await store.updateSound((c) => c.removeSet('copy'));
      await deleteUnreferencedSoundFiles(store, library, candidates);

      expect(shared.existsSync(), isTrue, reason: 'メインセットがまだ参照している');
      expect(only.existsSync(), isFalse, reason: '消したセットしか使っていなかった');
    });

    test('存在しないファイル名を渡しても落ちない', () async {
      final store = await loadedStore();
      await deleteUnreferencedSoundFiles(store, library, ['missing.mp3', '']);
    });
  });
}
