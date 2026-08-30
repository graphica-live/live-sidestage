import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

import '../models/app_config.dart';

/// 設定の永続化キー。UI Isolate と Foreground Service Isolate の両方から読む。
/// `FlutterForegroundTask.saveData` は Map を保存できないので JSON 文字列で入れる。
const String appConfigStorageKey = 'appConfig';

/// 「開始」後にライブが一定時間始まらず自動停止したが、UI側の永続設定
/// ([AppConfig].ttsEnabled/sound.enabled)へまだ反映していないことを示すフラグ。
/// UI Isolate と Foreground Service Isolate の両方から読み書きする。
///
/// [appConfigStorageKey] とは独立させ、AppConfig の revision 管理を一切
/// 経由しない（自動停止はユーザーの「意思」であるAppConfigを書き換えない設計
/// のため。詳細は background_task_handler.dart の自動停止まわりのコメント参照）。
const String autoStopPendingStorageKey = 'noLiveAutoStopPending';

/// フォアグラウンド通知に出す、読み上げ・効果音が両方停止しているときの文言。
/// UI Isolate([HomeScreen]の`_notificationText`)と背景Isolate(自動停止時)の
/// 両方から参照する固定文言なので、表記ゆれを避けるためここへ集約する。
const String idleNotificationText = '接続中です（読み上げ・効果音は停止中）';

/// UI Isolate 側の設定ストア。
///
/// 背景 Isolate との同期は revision 方式:
///
/// 1. revision を +1 して永続化する（await する）
/// 2. サービス稼働中なら `applyConfig` コマンドで背景へ直接渡す
/// 3. 背景は自分が持つものより新しい revision のときだけ適用し、**常に自分の現在
///    revision を ACK で返す**（古い・同じ revision を受けても返す。返さないと
///    UI 側が永久に「反映待ち」のままになる）
///
/// 背景が永続ストレージを読むのは `onStart` のときだけ。連続編集で非同期ロードが
/// 逆順に完了しても古い設定が勝たないようにするため。
///
/// **サービス停止中は ACK を待たない。** 待つと「反映待ち」表示と音源削除待ちが
/// 永久に残る。停止中は永続化の成功をもって確定とみなす。
class AppConfigStore extends ChangeNotifier {
  AppConfig _config = const AppConfig();
  bool _loaded = false;

  /// 永続化された設定を解釈できたか。既定値へフォールバックした場合は false。
  ///
  /// false のときに音源ファイルの掃除を走らせてはいけない（設定が読めていないだけで
  /// ファイルが不要とは限らない）。
  bool _configReadable = false;

  /// 保存済み設定がこのアプリより新しいスキーマだった。
  ///
  /// **このとき一切保存しない。** 新しいアプリで作った設定を古い形式で上書きすると、
  /// 次のサービス起動で `pruneOrphans` が音源の実ファイルまで消してしまう。
  /// [configReadable] が false になる理由のうち、壊れたJSONは上書きで復旧させたいので、
  /// 2つの理由を分けて持つ。
  bool _configFromFutureVersion = false;

  /// 背景へ送ったが ACK が返ってきていない revision。null なら同期済み。
  int? _pendingRevision;

  /// 永続化 → 送信を直列化する。await せずに連続で呼ばれても、
  /// 書き込み順と revision の順序がずれないようにする。
  Future<void> _writeChain = Future<void>.value();

  AppConfig get config => _config;
  bool get loaded => _loaded;
  bool get configReadable => _configReadable;
  SoundConfig get sound => _config.sound;

  /// このアプリより新しいバージョンで作られた設定を読んだ状態。
  ///
  /// UI はこのとき「アプリを更新してください」を出し、**開始させない**。
  /// サービスを起動しなければ背景 Isolate の孤児ファイル掃除も走らない。
  bool get configFromFutureVersion => _configFromFutureVersion;

  /// 背景 Isolate への反映待ちかどうか。UI で「反映待ち」を出す用。
  bool get syncPending => _pendingRevision != null;

  /// アカウント削除時の後始末。設定を既定値へ戻し、`FlutterForegroundTask`の
  /// ストレージ(ForegroundTaskが保持する`apiKey`もこの仕組みで入っている)を
  /// 丸ごとクリアする。同一端末で別アカウントへログインしたとき、前アカウントの
  /// 設定・接続情報を引き継がないようにするため。
  Future<void> resetToDefaults() async {
    await FlutterForegroundTask.clearAllData();
    _config = const AppConfig();
    _configReadable = true;
    _configFromFutureVersion = false;
    _pendingRevision = null;
    notifyListeners();
  }

  Future<void> load() async {
    final raw = await FlutterForegroundTask.getData<String>(key: appConfigStorageKey);
    final decoded = AppConfig.tryDecode(raw);
    _configReadable = decoded != null || raw == null || raw.isEmpty;
    _configFromFutureVersion = AppConfig.isFutureVersion(raw);
    _config = decoded ?? const AppConfig();
    _loaded = true;
    notifyListeners();
  }

  /// 背景から届いた ACK を反映する。
  void onAck(int revision) {
    final pending = _pendingRevision;
    if (pending != null && revision >= pending) {
      _pendingRevision = null;
      notifyListeners();
    }
  }

  Future<void> setTtsEnabled(bool value) => _mutate((c) => c.bumped(ttsEnabled: value));

  /// 読み上げと効果音の有効状態を **1回の revision で** まとめて書く。
  ///
  /// 別々に保存すると、その間に中間状態が背景 Isolate へ送られてしまう。
  /// 具体的には「サービス停止中に読み上げだけ開始」を `setTtsEnabled(true)` で
  /// 表現できない — [AppConfig] の既定値は効果音も true なので、その1手だけで
  /// 両方が有効な設定が保存され、効果音まで一緒に起動する。
  Future<void> setFeatureMask({required bool tts, required bool sound}) {
    return _mutate((c) => c.ttsEnabled == tts && c.sound.enabled == sound
        ? null
        : c.bumped(ttsEnabled: tts, sound: c.sound.copyWith(enabled: sound)));
  }

  Future<void> setRandomVoice(bool value) => _mutate((c) => c.bumped(randomVoice: value));

  Future<void> setFixedStyleId(int value) {
    return _mutate((c) => c.fixedStyleId == value ? null : c.bumped(fixedStyleId: value));
  }

  Future<void> setTtsVolume(int value) {
    final clamped = value.clamp(0, 100);
    return _mutate((c) => c.ttsVolume == clamped ? null : c.bumped(ttsVolume: clamped));
  }

  Future<void> setTtsSpeed(int value) {
    final clamped = value.clamp(50, 200);
    return _mutate((c) => c.ttsSpeed == clamped ? null : c.bumped(ttsSpeed: clamped));
  }

  Future<void> updateSound(SoundConfig Function(SoundConfig current) transform) {
    return _mutate((c) => c.bumped(sound: transform(c.sound)));
  }

  /// 音源ファイルの削除など「背景が参照をやめたことを確認してから実行したい」処理に使う。
  /// サービス停止中は即座に true を返す（待っても ACK は来ない）。
  ///
  /// **false のときはファイルを消してはいけない。** 背景がまだ古い設定で動いており、
  /// そのファイルを再生中・キュー保持中の可能性がある。
  Future<bool> waitForSync({Duration timeout = const Duration(seconds: 3)}) async {
    // 進行中の書き込みが終わるまでは pending が確定しない。
    await _writeChain;
    if (_pendingRevision == null) return true;
    final deadline = DateTime.now().add(timeout);
    while (_pendingRevision != null && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    return _pendingRevision == null;
  }

  /// [transform] が null を返したら何もしない（変化なしの保存で revision を進めない）。
  Future<void> _mutate(AppConfig? Function(AppConfig current) transform) {
    final task = _writeChain.then((_) => _applyMutation(transform));
    // 1件失敗しても以降の保存を止めない。エラーは _applyMutation 側で握る。
    _writeChain = task.catchError((_) {});
    return task;
  }

  Future<void> _applyMutation(AppConfig? Function(AppConfig current) transform) async {
    // 未来バージョンの設定は読めていないだけで、正しい内容が保存されている。
    // 既定値ベースの設定で潰すと、次のサービス起動で音源の実ファイルまで失われる。
    if (_configFromFutureVersion) return;

    final next = transform(_config);
    if (next == null) return;

    _config = next;
    // 保存前でも UI には反映しておく。失敗時は _configReadable ではなく
    // エラー表示で扱う（設定の内容自体は正しいので巻き戻さない）。
    notifyListeners();

    await FlutterForegroundTask.saveData(key: appConfigStorageKey, value: next.encode());
    // 保存できた設定は当然読める。起動直後に壊れた設定を読んだ状態からでも、
    // 一度上書きすれば掃除を許可してよい。
    _configReadable = true;

    final running = await FlutterForegroundTask.isRunningService;
    if (!running) {
      // 次回 onStart で永続ストレージから読まれる。ACK は来ないので待たない。
      _pendingRevision = null;
      notifyListeners();
      return;
    }

    // revision は単調増加なので、常に最新のものを待てばよい。
    _pendingRevision = next.revision;
    notifyListeners();
    FlutterForegroundTask.sendDataToTask({
      'command': 'applyConfig',
      'revision': next.revision,
      'json': next.encode(),
    });
  }
}
