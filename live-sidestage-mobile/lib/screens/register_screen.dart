import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/session_controller.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _tiktokIdController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _tiktokIdController.dispose();
    super.dispose();
  }

  Future<void> _submit(SessionController controller) async {
    if (!_formKey.currentState!.validate()) return;
    await controller.register(
      name: _nameController.text.trim(),
      email: _emailController.text.trim(),
      password: _passwordController.text,
      tiktokId: _tiktokIdController.text.trim(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<SessionController>();

    return Scaffold(
      appBar: AppBar(title: const Text('新規登録')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'LiveAnalyticsのアカウントを新規作成します。\nこの登録がそのままLiveAnalyticsの会員登録になります。',
                  style: TextStyle(color: Colors.grey),
                ),
                const SizedBox(height: 24),
                TextFormField(
                  controller: _nameController,
                  decoration: const InputDecoration(labelText: '名前'),
                  validator: (v) => (v == null || v.trim().isEmpty) ? '名前を入力してください' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'メールアドレス'),
                  validator: (v) => (v == null || !v.contains('@')) ? '正しいメールアドレスを入力してください' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _passwordController,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'パスワード（8文字以上）'),
                  validator: (v) => (v == null || v.length < 8) ? 'パスワードは8文字以上にしてください' : null,
                ),
                const SizedBox(height: 12),
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
                      : const Text('登録する'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
