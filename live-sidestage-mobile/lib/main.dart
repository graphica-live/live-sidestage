import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:provider/provider.dart';

import 'core/app_config_store.dart';
import 'core/background_task_handler.dart';
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

void main() {
  FlutterForegroundTask.initCommunicationPort();
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
        title: 'Live Sidestage',
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

    if (!controller.initialized) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final session = controller.session;
    if (session == null) return const WelcomeScreen();
    if (session.onboardingRequired) return const OnboardingScreen();
    return const HomeScreen();
  }
}
