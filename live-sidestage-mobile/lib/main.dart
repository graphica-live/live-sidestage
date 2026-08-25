import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:provider/provider.dart';

import 'core/app_config_store.dart';
import 'core/background_task_handler.dart';
import 'core/gift_name_ja.dart';
import 'core/session_controller.dart';
import 'screens/home_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/welcome_screen.dart';

@pragma('vm:entry-point')
void startCallback() {
  // audioplayers等プラットフォームチャンネルを使うプラグインはBinding初期化が必須。
  // このcallbackは専用のバックグラウンドIsolateで実行されるため、main()側のbindingとは別に必要。
  WidgetsFlutterBinding.ensureInitialized();
  FlutterForegroundTask.setTaskHandler(CommentSpeechTaskHandler());
}

Future<void> main() async {
  // ギフト名辞書はアセットなので rootBundle が要る。
  WidgetsFlutterBinding.ensureInitialized();
  FlutterForegroundTask.initCommunicationPort();
  // 25KB ほどの JSON を1度だけ読む。以降はどの画面からも同期で引ける。
  // 読めなくても英語名のまま動くので、失敗しても起動は止めない。
  await GiftNameJa.ensureLoaded();
  runApp(const LiveSidestageApp());
}

class LiveSidestageApp extends StatelessWidget {
  const LiveSidestageApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => SessionController()..loadPersisted()),
        ChangeNotifierProvider(create: (_) => AppConfigStore()..load()),
      ],
      child: MaterialApp(
        title: 'LIVE Sidestage',
        theme: ThemeData(colorSchemeSeed: Colors.deepPurple, useMaterial3: true),
        home: const AuthGate(),
      ),
    );
  }
}

class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<SessionController>();
    final configStore = context.watch<AppConfigStore>();

    if (!controller.initialized) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final session = controller.session;
    if (session == null) return const WelcomeScreen();
    if (session.onboardingRequired) return const OnboardingScreen();

    // HomeScreen 配下だけが AppConfig を編集する。ロード完了前に操作させると、
    // 既定値からの編集がロード結果を上書きしてユーザーの設定を消す。
    // ログイン前の画面は AppConfig を触らないのでここまでは待たせない。
    if (!configStore.loaded) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return const HomeScreen();
  }
}
