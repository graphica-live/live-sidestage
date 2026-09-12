import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

/// ログイン前の紹介スライド(5枚)を見終えたか。端末ローカルのみ。
const String introOnboardingCompletedStorageKey = 'introOnboardingCompleted';

class IntroOnboardingStore extends ChangeNotifier {
  bool _loaded = false;
  bool _completed = false;

  bool get loaded => _loaded;
  bool get completed => _completed;

  Future<void> load() async {
    final raw = await FlutterForegroundTask.getData<String>(key: introOnboardingCompletedStorageKey);
    _completed = raw == 'true';
    _loaded = true;
    notifyListeners();
  }

  Future<void> markCompleted() async {
    if (_completed) return;
    _completed = true;
    notifyListeners();
    await FlutterForegroundTask.saveData(key: introOnboardingCompletedStorageKey, value: 'true');
  }

  @visibleForTesting
  void debugSeed({required bool completed}) {
    _loaded = true;
    _completed = completed;
  }
}
