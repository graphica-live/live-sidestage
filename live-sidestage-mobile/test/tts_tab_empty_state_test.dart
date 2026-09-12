import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/app_config_store.dart';
import 'package:live_sidestage_mobile/core/feature_status.dart';
import 'package:live_sidestage_mobile/screens/home_screen.dart' show SpeechState;
import 'package:live_sidestage_mobile/screens/tabs/tts_tab.dart';
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

  testWidgets('コメント0件の空状態に読み上げの説明が出る', (tester) async {
    final store = AppConfigStore();
    await store.load();
    final scroll = ScrollController();

    await tester.pumpWidget(
      ChangeNotifierProvider<AppConfigStore>.value(
        value: store,
        child: MaterialApp(
          home: Scaffold(
            body: TtsTab(
              comments: const [],
              scrollController: scroll,
              speech: const SpeechState(),
              status: FeatureStatus.stopped,
              errors: const [],
              notice: null,
              started: false,
              busy: false,
              onToggle: (_) {},
              roomSwitching: false,
              switchingToTiktokHandle: null,
              showFirstRunGuide: false,
              onDismissFirstRunGuide: () {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.textContaining('ここに表示されているコメントが読み上げられます'),
      findsOneWidget,
    );
    expect(find.textContaining('登録直後は反映まで最大60秒'), findsOneWidget);

    scroll.dispose();
  });
}
