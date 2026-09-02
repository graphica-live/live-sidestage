import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:provider/provider.dart';

import '../core/account_status_store.dart';
import '../core/billing_service.dart';

const List<String> _paidPlanBenefits = [
  'ランダムボイス',
  '読み上げ速度の調整',
  '全読み上げ音声を選択可能',
  '効果音の登録数が無制限',
  '履歴を月・年・カスタム範囲まで遡れる',
  'リスナー名での検索・絞り込み',
];

const List<String> _freePlanBenefits = [
  '基本的な読み上げ(100件ごとに5分の休憩あり)',
  'その日のギフト・貢献・バトル履歴を表示',
];

/// プラン選択画面。AppBarのプランバッジ、設定タブの「プランをアップグレード」から遷移する。
class SubscriptionScreen extends StatefulWidget {
  const SubscriptionScreen({super.key});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen> {
  late final BillingService _billing;

  @override
  void initState() {
    super.initState();
    _billing = context.read<BillingService>();
    _billing.addListener(_onBillingChanged);
  }

  @override
  void dispose() {
    _billing.removeListener(_onBillingChanged);
    super.dispose();
  }

  void _onBillingChanged() {
    if (!mounted) return;
    final billing = context.read<BillingService>();
    if (billing.state == BillingPurchaseState.error && billing.errorMessage != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(billing.errorMessage!)));
    } else if (billing.state == BillingPurchaseState.success) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('プランを更新しました')));
    }
  }

  @override
  Widget build(BuildContext context) {
    // Google Play課金はAndroid専用(BillingService.init()もAndroid以外では何もしない)。
    // iOS上でも購入・復元ボタンをそのまま出すと、押しても無反応な導線になる
    // (実装後レビュー指摘、MEDIUM)。
    if (!Platform.isAndroid) {
      return Scaffold(
        appBar: AppBar(title: const Text('プランを選択')),
        body: const Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Text('プランのご購入は現在Android版のみでご利用いただけます。', textAlign: TextAlign.center),
          ),
        ),
      );
    }

    final accountStatus = context.watch<AccountStatusStore>();
    final billing = context.watch<BillingService>();
    final currentPlan = accountStatus.status.plan;
    final busy = billing.state == BillingPurchaseState.processing;
    // サーバーのinitは有効な有料プラン保持中、provider問わず常に409で拒否する
    // (cross-provider二重課金防止)。プラン間の変更(upgrade/downgrade)は未実装なので、
    // 既に有料プランの間は他プランの購入ボタンも出さない(押しても常に失敗する導線にしない)。
    final onPaidPlan = currentPlan == 'PRO' || currentPlan == 'ULTRA';

    ProductDetails? productFor(String productId) {
      // Play Consoleで同一productIdに複数のbase plan/offerを設定すると、
      // in_app_purchase_androidはそれぞれを別々のProductDetailsとして返しうる。
      // どれを選ぶべきかをこのアプリは判定できないため、複数該当時は
      // fail-closedで購入させない(実装後レビュー指摘、CRITICAL)。
      ProductDetails? found;
      for (final p in billing.products) {
        if (p.id == productId) {
          if (found != null) return null;
          found = p;
        }
      }
      return found;
    }

    // 商品を1件も取得できていない=Google Playへの接続・商品照会に失敗している状態。
    // ボタンは productFor が null を返し押しても無反応になるだけなので、原因を案内する。
    final billingUnavailable =
        billing.products.isEmpty && billing.state == BillingPurchaseState.error;

    return Scaffold(
      appBar: AppBar(title: const Text('プランを選択')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (billingUnavailable)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                billing.errorMessage ?? 'Google Playに接続できませんでした。',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          _PlanCard(
            title: 'FREE',
            price: '無料',
            benefits: _freePlanBenefits,
            isCurrent: currentPlan == 'FREE',
          ),
          const SizedBox(height: 12),
          _PlanCard(
            title: 'PRO',
            price: productFor(GooglePlayProductIds.pro)?.price ?? '—',
            benefits: _paidPlanBenefits,
            isCurrent: currentPlan == 'PRO',
            disabledNotice: onPaidPlan && currentPlan != 'PRO'
                ? 'プラン変更は現在準備中です。Playストアで現在のプランを解約後にお申し込みください。'
                : null,
            onSubscribe: currentPlan == 'PRO' || onPaidPlan || busy
                ? null
                : () {
                    final product = productFor(GooglePlayProductIds.pro);
                    if (product != null) billing.buy(product);
                  },
          ),
          const SizedBox(height: 12),
          _PlanCard(
            title: 'ULTRA',
            price: productFor(GooglePlayProductIds.ultra)?.price ?? '—',
            benefits: _paidPlanBenefits,
            isCurrent: currentPlan == 'ULTRA',
            disabledNotice: onPaidPlan && currentPlan != 'ULTRA'
                ? 'プラン変更は現在準備中です。Playストアで現在のプランを解約後にお申し込みください。'
                : null,
            onSubscribe: currentPlan == 'ULTRA' || onPaidPlan || busy
                ? null
                : () {
                    final product = productFor(GooglePlayProductIds.ultra);
                    if (product != null) billing.buy(product);
                  },
          ),
          const SizedBox(height: 24),
          Center(
            child: TextButton(
              onPressed: busy ? null : () => billing.restore(),
              child: const Text('購入を復元'),
            ),
          ),
          if (busy) const Padding(
            padding: EdgeInsets.only(top: 16),
            child: Center(child: CircularProgressIndicator()),
          ),
        ],
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.title,
    required this.price,
    required this.benefits,
    required this.isCurrent,
    this.onSubscribe,
    this.disabledNotice,
  });

  final String title;
  final String price;
  final List<String> benefits;
  final bool isCurrent;
  final VoidCallback? onSubscribe;
  final String? disabledNotice;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(title, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(width: 8),
                if (isCurrent)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: colorScheme.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '現在のプラン',
                      style: TextStyle(color: colorScheme.primary, fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                  ),
                const Spacer(),
                Text(price, style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 12),
            for (final benefit in benefits)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.check, size: 18, color: colorScheme.primary),
                    const SizedBox(width: 6),
                    Expanded(child: Text(benefit)),
                  ],
                ),
              ),
            if (onSubscribe != null) ...[
              const SizedBox(height: 8),
              FilledButton(onPressed: onSubscribe, child: const Text('このプランへ変更')),
            ] else if (disabledNotice != null) ...[
              const SizedBox(height: 8),
              Text(
                disabledNotice!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colorScheme.outline),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
