import 'app_config_store.dart';
import 'sound_library.dart';

/// 設定から外した音源ファイルのうち、**どのセットからも参照されなくなったものだけ**を消す。
///
/// セット複製は `fileName` を引き継ぐので、1つの実ファイルを複数の `GiftSound` が
/// 参照しうる。「その行を消したから実ファイルも消してよい」とは限らない。
///
/// 呼ぶ前に**設定の更新を完了させておくこと**。順序を逆にすると、まだ参照されている
/// ファイルを消す。
///
/// 背景 Isolate が新しい設定を受け取るまで待ち、確認できなければ**何も消さない**
/// （再生中・キュー保持中のファイルを消しうるため）。消し漏らしたぶんは次回起動時の
/// [SoundLibrary.pruneOrphans] が回収する。
///
/// なお `waitForSync` が保証するのは「背景が新しい設定を適用した」ことまでで、
/// 既に再生中のプレイヤーの完了は待たない。Android では open 済みのファイルを
/// unlink しても再生は続くので、そこまでは追わない。
Future<void> deleteUnreferencedSoundFiles(
  AppConfigStore store,
  SoundLibrary library,
  Iterable<String> candidates,
) async {
  final targets = {
    for (final fileName in candidates)
      if (fileName.isNotEmpty) fileName,
  };
  if (targets.isEmpty) return;

  if (!await store.waitForSync()) return;

  // 参照集合は1度だけ作る。候補ごとに全セットを走査すると無駄に重い。
  final referenced = store.sound.referencedFileNames;
  for (final fileName in targets) {
    if (referenced.contains(fileName)) continue;
    try {
      await library.deleteFile(fileName);
    } catch (_) {
      // 1件失敗しても残りは消す。失敗ぶんは次回起動時の掃除に任せる。
    }
  }
}
