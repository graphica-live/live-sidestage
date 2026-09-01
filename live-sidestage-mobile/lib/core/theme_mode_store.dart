import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

/// 表示テーマの永続化キー。UI Isolateだけが読み書きする
/// (firstRunGuideDismissedStorageKeyと同じく、FlutterForegroundTaskの
/// ストレージへ集約するが、AppConfigのrevision同期には乗せない — 背景Isolateは
/// 表示に関与しないため)。
const String themeModeStorageKey = 'themeMode';

/// 表示テーマ(システム/ライト/ダーク)のストア。
class ThemeModeStore extends ChangeNotifier {
  ThemeMode _themeMode = ThemeMode.system;

  ThemeMode get themeMode => _themeMode;

  Future<void> load() async {
    final raw = await FlutterForegroundTask.getData<String>(key: themeModeStorageKey);
    _themeMode = _parse(raw);
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode value) async {
    if (_themeMode == value) return;
    _themeMode = value;
    notifyListeners();
    await FlutterForegroundTask.saveData(key: themeModeStorageKey, value: value.name);
  }

  static ThemeMode _parse(String? raw) {
    for (final mode in ThemeMode.values) {
      if (mode.name == raw) return mode;
    }
    return ThemeMode.system;
  }
}
