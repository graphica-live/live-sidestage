import 'package:flutter/material.dart';

import 'login_screen.dart';
import 'register_screen.dart';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'TikCaptionReader',
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                const Text(
                  'TikTok Liveのコメントを読み上げます',
                  style: TextStyle(color: Colors.grey),
                ),
                const SizedBox(height: 40),
                FilledButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const RegisterScreen()),
                  ),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text('新規登録（LiveAnalyticsに登録）'),
                  ),
                ),
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const LoginScreen()),
                  ),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text('ログイン'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
