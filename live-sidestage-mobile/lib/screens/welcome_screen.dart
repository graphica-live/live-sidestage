import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/session_controller.dart';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  Future<void> _signIn(SessionController controller) async {
    await controller.signInWithGoogle();
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<SessionController>();

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Live Sidestage',
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                const Text(
                  'TikTok Liveのコメントを読み上げます',
                  style: TextStyle(color: Colors.grey),
                ),
                const SizedBox(height: 40),
                if (controller.errorMessage != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      controller.errorMessage!,
                      style: const TextStyle(color: Colors.red),
                      textAlign: TextAlign.center,
                    ),
                  ),
                FilledButton(
                  onPressed: controller.isLoading ? null : () => _signIn(controller),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: controller.isLoading
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Googleでログイン'),
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
