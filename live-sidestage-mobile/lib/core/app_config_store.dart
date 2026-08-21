import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

import '../models/app_config.dart';

/// 設定の永続化キー。UI Isolate と Foreground Service Isolate の両方から読む。
/// `FlutterForegroundTask.saveData` は Map を保存できないので JSON 文字列で入れる。
const String appConfigStorageKey = 'appConfig';

/// UI Isolate 側の設定ストア。
///
/// 背景 Isolate との同期は revision 方式:
///
/// 1. revision を +1 して永続化する（await する）
/// 2. サービス稼働中なら `applyConfig` コマンドで背景へ直接渡す
/// 3. 背景は自分が持つものより新しい revision のときだけ適用し、ACK を返す
///
/// 背景が永続ストレージを読むのは `onStart` のときだけ。連続編集で非同期ロードが
/// 逆順に完了しても古い設定が勝たないようにするため。
///
/// **サービス停止中は ACK を待たない。** 待つと「反映待ち」表示と音源削除待ちが
/// 永久に残る。停止中は永続化の成功をもって確定とみなす。
class AppConfigStore extends ChangeNotifier {
  AppConfig _config = const AppConfig();
  bool _loaded = false;

  /// 背景へ送ったが ACK が返ってきていない revision。null なら同期済み。
  int? _pendingRevision;

  AppConfig get config => _config;
  bool get loaded => _loaded;
  SoundConfig get sound => _config.sound;

  /// 背景 Isolate への反映待ちかどうか。UI で「反映待ち」を出す用。
  bool get syncPending => _pendingRevision != null;

  Future<void> load() async {
    final raw = await FlutterForegroundTask.getData<String>(key: appConfigStorageKey);
    _config = AppConfig.decode(raw);
    _loaded = true;
    notifyListeners();
  }

  /// 背景から届いた ACK を反映する。
  void onAck(int revision) {
    if (_pendingRevision != null && revision >= _pendingRevision!) {
      _pendingRevision = null;
      notifyListeners();
    }
  }

  Future<void> setTtsEnabled(bool value) => _mutate(_config.bumped(ttsEnabled: value));

  Future<void> setRandomVoice(bool value) => _mutate(_config.bumped(randomVoice: value));

  Future<void> updateSound(SoundConfig Function(SoundConfig current) transform) {
    return _mutate(_config.bumped(sound: transform(_config.sound)));
  }

  /// 音源ファイルの削除など「背景が参照をやめたことを確認してから実行したい」処理に使う。
  /// サービス停止中は即座に true を返す（待っても ACK は来ない）。
  Future<bool> waitForSync({Duration timeout = const Duration(seconds: 3)}) async {
    if (_pendingRevision == null) return true;
    final deadline = DateTime.now().add(timeout);
    while (_pendingRevision != null && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    return _pendingRevision == null;
  }

  Future<void> _mutate(AppConfig next) async {
    _config = next;
    notifyListeners();

    await FlutterForegroundTask.saveData(key: appConfigStorageKey, value: next.encode());

    final running = await FlutterForegroundTask.isRunningService;
    if (!running) {
      // 次回 onStart で永続ストレージから読まれる。ACK は来ないので待たない。
      _pendingRevision = null;
      notifyListeners();
      return;
    }

    _pendingRevision = next.revision;
    notifyListeners();
    FlutterForegroundTask.sendDataToTask({
      'command': 'applyConfig',
      'revision': next.revision,
      'json': next.encode(),
    });
  }
}
