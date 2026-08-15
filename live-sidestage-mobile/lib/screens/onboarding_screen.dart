import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/session_controller.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _formKey = GlobalKey<FormState>();
  final _tiktokIdController = TextEditingController();

  @override
  void dispose() {
    _tiktokIdController.dispose();
    super.dispose();
  }

  Future<void> _submit(SessionController controller) async {
    if (!_formKey.currentState!.validate()) return;
    await controller.completeOnboarding(tiktokId: _tiktokIdController.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<SessionController>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('TikTokアカウントの連携'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'ログアウト',
            onPressed: () => controller.logout(),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'ようこそ、${controller.session?.userName ?? ''}さん。\n最後にTikTok IDを連携してください。',
                  style: const TextStyle(color: Colors.grey),
                ),
                const SizedBox(height: 24),
                TextFormField(
                  controller: _tiktokIdController,
                  decoration: const InputDecoration(labelText: 'TikTok ID（@なし）'),
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'TikTok IDを入力してください' : null,
                ),
                const SizedBox(height: 24),
                if (controller.errorMessage != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      controller.errorMessage!,
                      style: const TextStyle(color: Colors.red),
                    ),
                  ),
                FilledButton(
                  onPressed: controller.isLoading ? null : () => _submit(controller),
                  child: controller.isLoading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('連携する'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
