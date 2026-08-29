import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/session_controller.dart';

/// メールアドレス+パスワードでのログイン/新規登録。1画面で切り替える。
///
/// 確認メールは送らない(バックエンドにメール送信基盤が無いため)。登録が
/// 成功した時点でそのままログイン済みになる。成功後は [SessionController.session]
/// が確立し `AuthGate`(lib/main.dart) が自動で次の画面へ切り替えるので、
/// このスクリーンは自分自身を pop するだけでよい。
class EmailAuthScreen extends StatefulWidget {
  const EmailAuthScreen({super.key});

  @override
  State<EmailAuthScreen> createState() => _EmailAuthScreenState();
}

class _EmailAuthScreenState extends State<EmailAuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  bool _isRegisterMode = false;

  static const int _minPasswordLength = 8;
  static final RegExp _emailPattern = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  void _toggleMode(SessionController controller) {
    if (controller.isLoading) return;
    setState(() => _isRegisterMode = !_isRegisterMode);
  }

  Future<void> _submit(SessionController controller) async {
    if (!_formKey.currentState!.validate()) return;

    final email = _emailController.text.trim();
    final password = _passwordController.text;

    final success = _isRegisterMode
        ? await controller.registerWithEmail(email: email, password: password)
        : await controller.signInWithEmail(email: email, password: password);

    if (success && mounted) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<SessionController>();

    return Scaffold(
      appBar: AppBar(title: Text(_isRegisterMode ? '新規登録' : 'ログイン')),
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
                  autofillHints: const [AutofillHints.email],
                  decoration: const InputDecoration(labelText: 'メールアドレス'),
                  validator: (v) {
                    final value = v?.trim() ?? '';
                    if (value.isEmpty) return 'メールアドレスを入力してください';
                    if (!_emailPattern.hasMatch(value)) return 'メールアドレスの形式が正しくありません';
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _passwordController,
                  obscureText: true,
                  autofillHints: [
                    _isRegisterMode ? AutofillHints.newPassword : AutofillHints.password,
                  ],
                  decoration: const InputDecoration(labelText: 'パスワード'),
                  validator: (v) {
                    final value = v ?? '';
                    if (value.isEmpty) return 'パスワードを入力してください';
                    if (_isRegisterMode && value.length < _minPasswordLength) {
                      return 'パスワードは$_minPasswordLength文字以上で入力してください';
                    }
                    return null;
                  },
                ),
                if (_isRegisterMode) ...[
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _confirmPasswordController,
                    obscureText: true,
                    autofillHints: const [AutofillHints.newPassword],
                    decoration: const InputDecoration(labelText: 'パスワード(確認)'),
                    validator: (v) {
                      if (v != _passwordController.text) return 'パスワードが一致しません';
                      return null;
                    },
                  ),
                ],
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
                      : Text(_isRegisterMode ? '登録する' : 'ログインする'),
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: () => _toggleMode(controller),
                  child: Text(_isRegisterMode ? 'すでにアカウントをお持ちの方はこちら' : '新規登録はこちら'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
