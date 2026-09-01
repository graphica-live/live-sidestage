import 'package:flutter/material.dart';

import '../../models/gift_ranking_entry.dart';
import 'diamond_format.dart';
import 'user_avatar.dart';

const _rankBadgeColors = {1: Color(0xFFC9971F), 2: Color(0xFFA8ADB5), 3: Color(0xFFC48A5A)};

/// 貢献タブとバトル履歴タブの貢献者展開が共有する1行。
/// サーバー側で同じ形状(`GiftAnalyticsUser`)のデータを返すため両方から使う。
/// 1〜3位は順位数字を金銀銅の丸バッジにするだけで、行そのものの見た目(枠・サイズ)は
/// 4位以下と統一する。
class RankingListTile extends StatelessWidget {
  const RankingListTile({super.key, required this.rank, required this.entry});

  final int rank;
  final GiftRankingEntry entry;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 24),
              child: _RankBadge(rank: rank),
            ),
            const SizedBox(width: 8),
            UserAvatar(entry.profileImageUrl),
          ],
        ),
        title: Text(entry.nickname, maxLines: 1, softWrap: false, overflow: TextOverflow.ellipsis),
        trailing: Text(
          formatDiamonds(entry.totalDiamonds),
          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
        ),
      ),
    );
  }
}

class _RankBadge extends StatelessWidget {
  const _RankBadge({required this.rank});

  final int rank;

  @override
  Widget build(BuildContext context) {
    final color = _rankBadgeColors[rank];
    if (color == null) {
      return Text(
        '$rank',
        textAlign: TextAlign.center,
        style: const TextStyle(fontWeight: FontWeight.w600),
      );
    }
    return Container(
      width: 24,
      height: 24,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: Text(
        '$rank',
        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12),
      ),
    );
  }
}
