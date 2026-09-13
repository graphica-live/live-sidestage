import 'package:flutter/material.dart';

import '../../core/upgrade_notice.dart';
import 'gradient_kit.dart';

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


/// FREEプラン制限の常時案内。エラー帯([AnalyticsErrorBanner])とは色を分け、
/// [VerifiedLockNotice]と同じ控えめなカード骨格。CTA文言だけ Kosai c2 で導線と分かる。
class FreePlanLimitNotice extends StatelessWidget {
  const FreePlanLimitNotice({
    super.key,
    required this.message,
    required this.ctaLabel,
    this.onUpgrade,
  });

  final String message;
  final String ctaLabel;
  final VoidCallback? onUpgrade;

  @override
  Widget build(BuildContext context) {
    final sub = Theme.of(context).colorScheme.onSurfaceVariant;
    final ctaIndex = message.indexOf(ctaLabel);
    final TextSpan body;
    if (ctaIndex < 0) {
      body = TextSpan(text: message, style: TextStyle(fontSize: 11.5, color: sub, height: 1.45));
    } else {
      final base = TextStyle(fontSize: 11.5, color: sub, height: 1.45);
      body = TextSpan(
        style: base,
        children: [
          TextSpan(text: message.substring(0, ctaIndex)),
          TextSpan(
            text: ctaLabel,
            style: const TextStyle(
              color: KosaiPalette.c2,
              fontWeight: FontWeight.w800,
              decoration: TextDecoration.underline,
              decorationColor: KosaiPalette.c2,
            ),
          ),
          TextSpan(text: message.substring(ctaIndex + ctaLabel.length)),
        ],
      );
    }

    return Semantics(
      button: true,
      label: message,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onUpgrade ?? () => openSubscriptionScreen(context),
          borderRadius: BorderRadius.circular(14),
          child: Container(
            width: double.infinity,
            margin: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: sub.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(14),
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 28),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text.rich(body),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
