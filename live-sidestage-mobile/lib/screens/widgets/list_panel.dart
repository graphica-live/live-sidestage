import 'package:flutter/material.dart';

import 'gradient_kit.dart';

/// 光彩(Kosai)の一覧パネル(comp `.panel.soft`)。
/// 1枚の白カードに行を並べ、行間は1dpの区切り線のみで余白を持たせない。
/// 各行を個別Cardにすると外側マージンが積み上がって間延びするため、
/// 一覧画面(貢献・ギフト履歴・バトル履歴・設定)は必ずこれを使う。
///
/// 背景は **`cardTheme.color`(#FFFFFF / dark #1F1B24)**。`colorScheme.surface` は
/// 画面背景(#FAF7F5)なので使ってはいけない(`_kosai-tokens.md` §2)。
class ListPanel extends StatelessWidget {
  const ListPanel({
    super.key,
    required this.children,
    this.margin = const EdgeInsets.fromLTRB(16, 4, 16, 4),
    this.horizontalPadding = 14,
  });

  final List<Widget> children;
  final EdgeInsetsGeometry margin;

  /// 行の左右padding。区切り線もこの内側へ入れる(comp `.row-item` の 12px 相当)。
  final double horizontalPadding;

  @override
  Widget build(BuildContext context) {
    final divider = kosaiRowDividerColor(context);
    return Container(
      margin: margin,
      padding: EdgeInsets.symmetric(horizontal: horizontalPadding),
      decoration: BoxDecoration(
        color: kosaiCardColor(context),
        borderRadius: BorderRadius.circular(18),
        boxShadow: kosaiPanelShadow,
      ),
      child: Column(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) Divider(height: 1, thickness: 1, color: divider),
            children[i],
          ],
        ],
      ),
    );
  }
}
