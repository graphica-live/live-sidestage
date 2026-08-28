import 'package:flutter/material.dart';

/// 貢献/ギフト履歴/バトル履歴タブ共通のエラー表示。`FeatureStatusBar`と同じ
/// 視覚言語(赤・装飾シャドウ無し)。取得失敗時にリストの代わりに出す。
class AnalyticsErrorBanner extends StatelessWidget {
  const AnalyticsErrorBanner({super.key, required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Colors.red.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: [
          Expanded(
            child: SelectableText(message, style: const TextStyle(color: Colors.red, fontSize: 12)),
          ),
          TextButton(onPressed: onRetry, child: const Text('再試行')),
        ],
      ),
    );
  }
}

/// TikTok連携(verified)が未完了のときの補足。**閲覧はブロックしない**
/// (BIO認証ロックはこのアプリではまだ実装しない。将来サーバー側でブロックする
/// ようになったとき、このバナーがそのまま「データが空である理由」の説明に転用できる)。
class VerifiedLockNotice extends StatelessWidget {
  const VerifiedLockNotice({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Colors.grey.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: const Text(
        'TikTokアカウント連携が未完了です。',
        style: TextStyle(fontSize: 12, color: Colors.grey),
      ),
    );
  }
}

/// 一覧が空のときの案内文。
class EmptyListNotice extends StatelessWidget {
  const EmptyListNotice({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Center(
        child: Text(message, style: TextStyle(color: Theme.of(context).disabledColor)),
      ),
    );
  }
}
