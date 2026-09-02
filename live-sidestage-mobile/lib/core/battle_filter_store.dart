import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

/// 小さいバトルを隠すかどうかの永続化キー。
const String battleHideSmallEnabledStorageKey = 'battleHideSmallEnabled';

/// 「小さい」と見なすコイン数のしきい値の永続化キー。
const String battleHideSmallThresholdStorageKey = 'battleHideSmallThreshold';

/// しきい値の既定(comp `.threshold-row` の「100コイン未満を非表示」)。
const int defaultBattleHideSmallThreshold = 100;

/// しきい値スライダーの上限。
const int maxBattleHideSmallThreshold = 1000;

/// バトル履歴タブの表示フィルタ(小さいバトルを隠す)のストア。
///
/// **[AppConfig] には載せない。** AppConfigはrevision方式で背景Isolateへ同期する設定で、
/// 背景Isolateは一覧の表示に一切関与しない。表示専用の値を載せると触るたびに
/// 無駄な同期とACK待ちが走る。[ThemeModeStore]と同じ軽量ストアとして分ける。
class BattleFilterStore extends ChangeNotifier {
  bool _hideSmall = true;
  int _threshold = defaultBattleHideSmallThreshold;

  /// 既定はON(comp のトグルは初期状態でON)。
  bool get hideSmall => _hideSmall;

  int get threshold => _threshold;

  Future<void> load() async {
    final enabled = await FlutterForegroundTask.getData<bool>(key: battleHideSmallEnabledStorageKey);
    final threshold = await FlutterForegroundTask.getData<int>(key: battleHideSmallThresholdStorageKey);
    _hideSmall = enabled ?? true;
    _threshold = _clamp(threshold ?? defaultBattleHideSmallThreshold);
    notifyListeners();
  }

  Future<void> setHideSmall(bool value) async {
    if (_hideSmall == value) return;
    _hideSmall = value;
    notifyListeners();
    await FlutterForegroundTask.saveData(key: battleHideSmallEnabledStorageKey, value: value);
  }

  Future<void> setThreshold(int value) async {
    final clamped = _clamp(value);
    if (_threshold == clamped) return;
    _threshold = clamped;
    notifyListeners();
    await FlutterForegroundTask.saveData(key: battleHideSmallThresholdStorageKey, value: clamped);
  }

  static int _clamp(int value) => value.clamp(0, maxBattleHideSmallThreshold);
}

/// バトルを「小さい」とみなすか。
///
/// **両陣営ともしきい値未満のときだけ隠す。** 片方でもしきい値以上なら、自分が
/// 取れなかっただけの意味のあるバトルなので残す。スコアが両方とも取れていない
/// (未観測の)バトルは隠さない — 未観測を「小さい」と断定しない。
bool isSmallBattle({required String? selfScore, required String? opponentScore, required int threshold}) {
  final self = _parse(selfScore);
  final opponent = _parse(opponentScore);
  if (self == null && opponent == null) return false;
  final limit = BigInt.from(threshold);
  final selfSmall = self == null || self < limit;
  final opponentSmall = opponent == null || opponent < limit;
  return selfSmall && opponentSmall;
}

BigInt? _parse(String? score) => score == null ? null : BigInt.tryParse(score);
