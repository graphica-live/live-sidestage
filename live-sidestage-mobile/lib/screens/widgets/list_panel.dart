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

/// 光彩(Kosai)の一覧パネルの sliver 版。[ListPanel] と同一の視覚(白カード+角丸18+
/// シャドウ+行間1dp区切り線)を保ちながら、`CustomScrollView` の `slivers` 直下に置くことで
/// 画面外の行を実際に build しない(真の仮想化)。件数が多い一覧(貢献ランキング等)専用。
/// 件数が少ない一覧は従来通り [ListPanel] を使う。
class ListPanelSliver extends StatelessWidget {
  const ListPanelSliver({
    super.key,
    required this.itemCount,
    required this.itemBuilder,
    this.margin = const EdgeInsets.fromLTRB(16, 4, 16, 4),
    this.horizontalPadding = 14,
  });

  final int itemCount;
  final Widget Function(BuildContext context, int index) itemBuilder;
  final EdgeInsetsGeometry margin;
  final double horizontalPadding;

  @override
  Widget build(BuildContext context) {
    final divider = kosaiRowDividerColor(context);
    return SliverPadding(
      padding: margin,
      sliver: DecoratedSliver(
        decoration: BoxDecoration(
          color: kosaiCardColor(context),
          borderRadius: BorderRadius.circular(18),
          boxShadow: kosaiPanelShadow,
        ),
        sliver: SliverPadding(
          padding: EdgeInsets.symmetric(horizontal: horizontalPadding),
          sliver: SliverList(
            delegate: SliverChildBuilderDelegate(
              (context, i) => Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (i > 0) Divider(height: 1, thickness: 1, color: divider),
                  itemBuilder(context, i),
                ],
              ),
              childCount: itemCount,
            ),
          ),
        ),
      ),
    );
  }
}
