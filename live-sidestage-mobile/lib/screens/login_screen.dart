import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/session_controller.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit(SessionController controller) async {
    if (!_formKey.currentState!.validate()) return;
    await controller.login(
      email: _emailController.text.trim(),
      password: _passwordController.text,
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<SessionController>();

    return Scaffold(
      appBar: AppBar(title: const Text('ログイン')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
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
                  decoration: const InputDecoration(labelText: 'パスワード'),
                  validator: (v) => (v == null || v.isEmpty) ? 'パスワードを入力してください' : null,
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
                      : const Text('ログイン'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
