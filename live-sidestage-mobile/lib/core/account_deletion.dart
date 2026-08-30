import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app_config_store.dart';
import 'session_controller.dart';
import 'sound_library.dart';

/// 確認ダイアログ→削除実行→端末ローカルデータの後始末までを1箇所にまとめる。
/// Settings/Onboarding/UpdateRequiredの3画面すべてが同じ手順で呼ぶ
/// ([AuthGate]がsession==nullを検知して自動的にWelcomeScreenへ戻すので、
/// ここでの明示的な画面遷移は不要 — logoutと同じ)。
///
/// [onBeforeDelete] は確認後・削除リクエスト送信前に呼ぶ。HomeScreen配下の
/// 設定タブでは、開いている背景サービスをここで止める（Onboarding/
/// UpdateRequiredではサービスを開始できないので渡さなくてよい）。
Future<void> confirmAndDeleteAccount(
  BuildContext context, {
  Future<void> Function()? onBeforeDelete,
}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('アカウントを削除しますか？'),
      content: const Text(
        'この操作は取り消せません。ログイン情報・TikTok連携・課金情報など、'
        'LIVE Sidestageの全サービスに保存されたあなたの情報が削除されます。',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('キャンセル'),
        ),
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: const Text('削除する', style: TextStyle(color: Colors.red)),
        ),
      ],
    ),
  );
  if (confirmed != true) return;
  if (!context.mounted) return;

  if (onBeforeDelete != null) await onBeforeDelete();
  if (!context.mounted) return;

  final controller = context.read<SessionController>();
  final configStore = context.read<AppConfigStore>();
  final messenger = ScaffoldMessenger.of(context);

  final deleted = await controller.deleteAccount();
  if (!deleted) {
    messenger.showSnackBar(
      SnackBar(content: Text(controller.errorMessage ?? 'アカウント削除に失敗しました。')),
    );
    return;
  }

  // 同一端末で別アカウントへログインしたときに前アカウントの状態を
  // 引き継がないよう、通常ログアウトより広い範囲でローカルデータを消す。
  await configStore.resetToDefaults();
  await SoundLibrary().deleteAll();
}
