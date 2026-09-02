import 'package:flutter/material.dart';

/// 貢献/ギフト履歴/バトル履歴タブ共通のエラー表示。
///
/// 光彩(Kosai)では画面幅いっぱいの帯ではなく、他のカードと同じ16dpの内側に
/// 角丸14dpで置く。**色は状態伝達色のまま**(装飾グラデーションは使わない)。
class AnalyticsErrorBanner extends StatelessWidget {
  const AnalyticsErrorBanner({super.key, required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final error = Theme.of(context).colorScheme.error;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: error.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Expanded(
            child: SelectableText(message, style: TextStyle(color: error, fontSize: 12)),
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
    final sub = Theme.of(context).colorScheme.onSurfaceVariant;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: sub.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(
        'TikTokアカウント連携が未完了です。',
        style: TextStyle(fontSize: 11.5, color: sub),
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
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ),
    );
  }
}
