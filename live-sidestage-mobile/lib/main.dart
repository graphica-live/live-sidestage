import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/comment_feed.dart';
import 'core/session_controller.dart';
import 'screens/home_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/welcome_screen.dart';

void main() {
  runApp(const TikCaptionReaderApp());
}

class TikCaptionReaderApp extends StatelessWidget {
  const TikCaptionReaderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => SessionController()..loadPersisted()),
        ChangeNotifierProvider(create: (_) => CommentFeed()),
      ],
      child: MaterialApp(
        title: 'TikCaptionReader',
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
