import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../core/api_client.dart';
import '../core/privacy_policy.dart';
import '../core/session_controller.dart';
import 'email_auth_screen.dart';
import 'widgets/gradient_kit.dart';

// Google と Apple のボタンは実装元が別（自前のグラデーションpillと
// sign_in_with_apple のウィジェット）で既定値も揃っていないため、
// 並べて破綻しないよう寸法はここに集約して両方へ同じ値を渡す。
const double _buttonHeight = 48;

/// 光彩(Kosai)のpill。**8dpではなく999dp**(`login-screen-kosai/spec.md` 変更点)。
const BorderRadius _buttonRadius = BorderRadius.all(Radius.circular(999));

/// SignInWithAppleButton は Apple のガイドラインに従って文字サイズを
/// `height * 0.43` で決め打ちしており、外から差し替えられない。Google 側を
/// Material の既定（14px）のままにすると並んだときに露骨にちぐはぐになるので、
/// 同じ式で合わせる。
const double _buttonFontSize = _buttonHeight * 0.43;

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  Future<void> _signIn(SessionController controller) async {
    await controller.signInWithGoogle();
  }

  Future<void> _signInWithApple(SessionController controller) async {
    await controller.signInWithApple();
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
                GradientText(
                  'LIVE Sidestage',
                  style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontSize: 28, fontWeight: FontWeight.w700) ??
                      const TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                Text(
                  'TikTok Liveのコメントを読み上げます',
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 36),
                if (controller.errorMessage != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      controller.errorMessage!,
                      style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.error),
                      textAlign: TextAlign.center,
                    ),
                  ),
                SizedBox(
                  width: double.infinity,
                  height: _buttonHeight,
                  child: KosaiPrimaryButton(
                    label: 'Googleでログイン',
                    fontSize: _buttonFontSize,
                    // 高さは外側の SizedBox が決める。padding で稼ぐと 48dp を超える。
                    verticalPadding: 8,
                    busy: controller.isLoading,
                    onPressed: () => _signIn(controller),
                  ),
                ),
                // Apple 側の設定(Services ID)がビルドに渡っていなければ出さない。
                // 未設定のまま押させると必ず失敗するため。
                if (isAppleSignInConfigured) ...[
                  const SizedBox(height: 12),
                  // Apple の表示要件に沿うため、独自ボタンではなくパッケージ提供の
                  // ものを使う（ロゴ・配色・角丸・文言の規定がある）。寸法だけ
                  // Google 側と同じ値に揃える。
                  SizedBox(
                    width: double.infinity,
                    child: SignInWithAppleButton(
                      text: 'Appleでサインイン',
                      height: _buttonHeight,
                      borderRadius: _buttonRadius,
                      onPressed: () {
                        if (controller.isLoading) return;
                        _signInWithApple(controller);
                      },
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  height: _buttonHeight,
                  child: KosaiOutlineButton(
                    label: 'メールアドレスでログイン',
                    fontSize: _buttonFontSize,
                    verticalPadding: 8,
                    onPressed: controller.isLoading
                        ? null
                        : () => Navigator.of(context).push(
                              MaterialPageRoute(builder: (_) => const EmailAuthScreen()),
                            ),
                  ),
                ),
                const SizedBox(height: 26),
                TextButton(
                  onPressed: () => launchPrivacyPolicy(context),
                  child: Text(
                    'プライバシーポリシー',
                    style: TextStyle(
                      fontSize: 12,
                      decoration: TextDecoration.underline,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                      decorationColor: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
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
