import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:provider/provider.dart';

import '../core/account_status_store.dart';
import '../core/apple_billing_service.dart';
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
/// Android(Google Play Billing)とiOS(Apple IAP)で購入バックエンドが異なるため、
/// `BillingService`/`AppleBillingService`のどちらを見るかをPlatformで切り替える。
/// 表示内容(プラン名・特典・価格・現在プランバッジ)は共通。
class SubscriptionScreen extends StatefulWidget {
  const SubscriptionScreen({super.key});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen> {
  Listenable? _billing;

  @override
  void initState() {
    super.initState();
    if (Platform.isAndroid) {
      _billing = context.read<BillingService>();
    } else if (Platform.isIOS) {
      _billing = context.read<AppleBillingService>();
    }
    _billing?.addListener(_onBillingChanged);
  }

  @override
  void dispose() {
    _billing?.removeListener(_onBillingChanged);
    super.dispose();
  }

  void _onBillingChanged() {
    if (!mounted) return;
    final BillingPurchaseState state;
    final String? errorMessage;
    if (Platform.isAndroid) {
      final billing = context.read<BillingService>();
      state = billing.state;
      errorMessage = billing.errorMessage;
    } else {
      final billing = context.read<AppleBillingService>();
      state = billing.state;
      errorMessage = billing.errorMessage;
    }
    if (state == BillingPurchaseState.error && errorMessage != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage)));
    } else if (state == BillingPurchaseState.success) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('プランを更新しました')));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (Platform.isAndroid) return _buildAndroid(context);
    if (Platform.isIOS) return _buildIos(context);
    // Android/iOS以外(将来の対応外プラットフォーム)。
    return Scaffold(
      appBar: AppBar(title: const Text('プランを選択')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('このプラットフォームではプランのご購入に対応していません。', textAlign: TextAlign.center),
        ),
      ),
    );
  }

  Widget _buildAndroid(BuildContext context) {
    final accountStatus = context.watch<AccountStatusStore>();
    final billing = context.watch<BillingService>();
    final currentPlan = accountStatus.status.effectivePlan;
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

    return _buildPlansScaffold(
      context: context,
      currentPlan: currentPlan,
      products: billing.products,
      productFor: productFor,
      busy: billing.state == BillingPurchaseState.processing,
      billingUnavailable: billing.products.isEmpty && billing.state == BillingPurchaseState.error,
      unavailableMessage: billing.errorMessage ?? 'Google Playに接続できませんでした。',
      proProductId: GooglePlayProductIds.pro,
      ultraProductId: GooglePlayProductIds.ultra,
      onSubscribe: billing.buy,
      onRestore: billing.restore,
    );
  }

  Widget _buildIos(BuildContext context) {
    final accountStatus = context.watch<AccountStatusStore>();
    final billing = context.watch<AppleBillingService>();
    final currentPlan = accountStatus.status.effectivePlan;

    ProductDetails? productFor(String productId) {
      // App Store Connectで同一productIdに複数のofferを設定すると、in_app_purchase_storekitが
      // 複数のProductDetailsを返しうる。Android版と同じ理由でfail-closedにする。
      ProductDetails? found;
      for (final p in billing.products) {
        if (p.id == productId) {
          if (found != null) return null;
          found = p;
        }
      }
      return found;
    }

    return _buildPlansScaffold(
      context: context,
      currentPlan: currentPlan,
      products: billing.products,
      productFor: productFor,
      busy: billing.state == BillingPurchaseState.processing,
      billingUnavailable: billing.products.isEmpty && billing.state == BillingPurchaseState.error,
      unavailableMessage: billing.errorMessage ?? 'App Storeに接続できませんでした。',
      proProductId: AppleProductIds.pro,
      ultraProductId: AppleProductIds.ultra,
      onSubscribe: billing.buy,
      onRestore: billing.restore,
    );
  }

  Widget _buildPlansScaffold({
    required BuildContext context,
    required String currentPlan,
    required List<ProductDetails> products,
    required ProductDetails? Function(String productId) productFor,
    required bool busy,
    required bool billingUnavailable,
    required String unavailableMessage,
    required String proProductId,
    required String ultraProductId,
    required void Function(ProductDetails) onSubscribe,
    required VoidCallback onRestore,
  }) {
    // サーバーのinitは有効な有料プラン保持中、provider問わず常に409で拒否する
    // (cross-provider二重課金防止)。プラン間の変更(upgrade/downgrade)は未実装なので、
    // 既に有料プランの間は他プランの購入ボタンも出さない(押しても常に失敗する導線にしない)。
    final onPaidPlan = currentPlan == 'PRO' || currentPlan == 'ULTRA';

    return Scaffold(
      appBar: AppBar(title: const Text('プランを選択')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (billingUnavailable)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                unavailableMessage,
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
            price: productFor(proProductId)?.price ?? '—',
            benefits: _paidPlanBenefits,
            isCurrent: currentPlan == 'PRO',
            disabledNotice: onPaidPlan && currentPlan != 'PRO'
                ? 'プラン変更は現在準備中です。ストアで現在のプランを解約後にお申し込みください。'
                : null,
            onSubscribe: currentPlan == 'PRO' || onPaidPlan || busy
                ? null
                : () {
                    final product = productFor(proProductId);
                    if (product != null) onSubscribe(product);
                  },
          ),
          const SizedBox(height: 12),
          _PlanCard(
            title: 'ULTRA',
            price: productFor(ultraProductId)?.price ?? '—',
            benefits: _paidPlanBenefits,
            isCurrent: currentPlan == 'ULTRA',
            disabledNotice: onPaidPlan && currentPlan != 'ULTRA'
                ? 'プラン変更は現在準備中です。ストアで現在のプランを解約後にお申し込みください。'
                : null,
            onSubscribe: currentPlan == 'ULTRA' || onPaidPlan || busy
                ? null
                : () {
                    final product = productFor(ultraProductId);
                    if (product != null) onSubscribe(product);
                  },
          ),
          const SizedBox(height: 24),
          Center(
            child: TextButton(
              onPressed: busy ? null : onRestore,
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
