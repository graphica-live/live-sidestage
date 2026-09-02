import 'package:flutter/material.dart';

/// 採用モック(`.impeccable/mocks/directions.html`の`.sc-card`+`.sc-row`)相当。
/// 1枚のパネルに行を並べ、行間は区切り線のみで余白を持たせない。
/// 各行を個別Cardにすると外側マージンが積み上がって間延びするため、
/// 一覧画面(貢献・ギフト履歴・バトル履歴)は必ずこれを使う。
class ListPanel extends StatelessWidget {
  const ListPanel({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final outline = Theme.of(context).colorScheme.outlineVariant;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF9B6BFF).withValues(alpha: 0.12),
            blurRadius: 22,
            offset: const Offset(0, 8),
            spreadRadius: -18,
          ),
        ],
      ),
      child: Column(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) Divider(height: 1, color: outline),
            children[i],
          ],
        ],
      ),
    );
  }
}
