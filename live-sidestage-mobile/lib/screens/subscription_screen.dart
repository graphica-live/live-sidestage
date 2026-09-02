import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:provider/provider.dart';

import '../core/account_status_store.dart';
import '../core/billing_service.dart';
import 'widgets/gradient_kit.dart';

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
        appBar: AppBar(),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: GradientText(
                    'プランを選択',
                    style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontSize: 22, fontWeight: FontWeight.w700) ??
                        const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
                  ),
                ),
                Text(
                  'プランのご購入は現在Android版のみでご利用いただけます。',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

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

    // 商品を1件も取得できていない=Google Playへの接続・商品照会に失敗している状態。
    // ボタンは productFor が null を返し押しても無反応になるだけなので、原因を案内する。
    final billingUnavailable =
        billing.products.isEmpty && billing.state == BillingPurchaseState.error;

    return Scaffold(
      // 見出しは本文側のグラデ文字で出すので、AppBarにタイトル文字は置かない
      // (`subscription-screen-kosai/spec.md`)。
      appBar: AppBar(),
      body: ListView(
        // 最後の「購入を復元」がジェスチャーバーに重なるので、端末の下部インセットを足す。
        padding: EdgeInsets.fromLTRB(16, 8, 16, 24 + MediaQuery.viewPaddingOf(context).bottom),
        children: [
          // ListView側で横16dpを持っているので、見出しは横paddingを持たない
          // `GradientText` を直に置く(`KosaiSectionHeading`だと32dpになる)。
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: GradientText(
              'プランを選択',
              style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontSize: 22, fontWeight: FontWeight.w700) ??
                  const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
            ),
          ),
          if (billingUnavailable)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                billing.errorMessage ?? 'Google Playに接続できませんでした。',
                style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.error),
              ),
            ),
          _PlanCard(
            title: 'FREE',
            variant: _PlanCardVariant.plain,
            price: '無料',
            benefits: _freePlanBenefits,
            isCurrent: currentPlan == 'FREE',
          ),
          const SizedBox(height: 12),
          _PlanCard(
            title: 'PRO',
            variant: _PlanCardVariant.outlined,
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
            variant: _PlanCardVariant.gradientBorder,
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
              child: Text(
                '購入を復元',
                style: TextStyle(
                  fontSize: 12,
                  decoration: TextDecoration.underline,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                  decorationColor: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ),
          if (busy)
            const Padding(
              padding: EdgeInsets.only(top: 16),
              child: Center(child: CircularProgressIndicator(color: KosaiPalette.c2)),
            ),
        ],
      ),
    );
  }
}

/// カードの見え方(comp `.card.flat` / `.card.grad-border`)。
/// **視覚的な優先度だけを表すもので、販促バッジは一切置かない**(採用時のユーザー指示)。
enum _PlanCardVariant {
  /// FREE。白カード+1dp line枠。
  plain,

  /// PRO。白カード+1.5dp c2枠。
  outlined,

  /// ULTRA。二重枠グラデーションカード。
  gradientBorder,
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.title,
    required this.variant,
    required this.price,
    required this.benefits,
    required this.isCurrent,
    this.onSubscribe,
    this.disabledNotice,
  });

  final String title;
  final _PlanCardVariant variant;
  final String price;
  final List<String> benefits;
  final bool isCurrent;
  final VoidCallback? onSubscribe;
  final String? disabledNotice;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final sub = colorScheme.onSurfaceVariant;
    const titleStyle = TextStyle(fontSize: 15, fontWeight: FontWeight.w800);

    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            switch (variant) {
              _PlanCardVariant.plain => Text(title, style: titleStyle),
              _PlanCardVariant.outlined =>
                Text(title, style: titleStyle.copyWith(color: KosaiPalette.c2)),
              _PlanCardVariant.gradientBorder =>
                GradientText(title, style: titleStyle, gradient: KosaiPalette.score),
            },
            if (isCurrent) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                decoration: BoxDecoration(
                  color: KosaiPalette.c2.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                // 現在の状態表示。「おすすめ」等の販促バッジはここにも置かない。
                child: const Text(
                  '現在のプラン',
                  style: TextStyle(color: KosaiPalette.c2, fontSize: 11, fontWeight: FontWeight.w800),
                ),
              ),
            ],
            const Spacer(),
            Text(
              price,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: variant == _PlanCardVariant.plain ? sub : colorScheme.onSurface,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        for (final benefit in benefits)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.check, size: 15, color: KosaiPalette.c2),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    benefit,
                    style: TextStyle(fontSize: 11.5, height: 1.7, color: sub),
                  ),
                ),
              ],
            ),
          ),
        if (onSubscribe != null) ...[
          const SizedBox(height: 10),
          if (variant == _PlanCardVariant.gradientBorder)
            KosaiPrimaryButton(
              label: 'このプランへ変更',
              verticalPadding: 12,
              fontSize: 13.5,
              onPressed: onSubscribe,
            )
          else
            KosaiOutlineButton(
              label: 'このプランへ変更',
              verticalPadding: 11,
              fontSize: 13,
              onPressed: onSubscribe,
            ),
        ] else if (disabledNotice != null) ...[
          const SizedBox(height: 10),
          Text(disabledNotice!, style: TextStyle(fontSize: 11.5, color: sub)),
        ],
      ],
    );

    if (variant == _PlanCardVariant.gradientBorder) {
      return GradientBorderCard(child: content);
    }
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: kosaiCardColor(context),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: variant == _PlanCardVariant.outlined
              ? KosaiPalette.c2
              : colorScheme.outlineVariant,
          width: variant == _PlanCardVariant.outlined ? 1.5 : 1,
        ),
      ),
      child: content,
    );
  }
}
