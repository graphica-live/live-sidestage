import 'package:flutter/material.dart';

import '../../core/tiktok_profile.dart';
import '../../models/gift_ranking_entry.dart';
import 'diamond_format.dart';
import 'gradient_kit.dart';
import 'user_avatar.dart';

/// 貢献タブとバトル履歴タブの貢献者展開が共有する1行。
/// サーバー側で同じ形状(`GiftAnalyticsUser`)のデータを返すため両方から使う。
/// 1〜3位は順位数字をグラデーションメダル(光彩)にするだけで、行そのものの見た目
/// (枠・サイズ)は4位以下と統一する。
class RankingListTile extends StatelessWidget {
  const RankingListTile({super.key, required this.rank, required this.entry});

  final int rank;
  final GiftRankingEntry entry;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => openTiktokProfile(context, entry.uniqueId),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 26),
              child: GradientMedal(rank: rank),
            ),
            const SizedBox(width: 8),
            GradientRing(child: UserAvatar(entry.profileImageUrl)),
            const SizedBox(width: 12),
            Expanded(
              child: Text(entry.nickname, maxLines: 1, softWrap: false, overflow: TextOverflow.ellipsis),
            ),
            Text(
              formatDiamonds(entry.totalDiamonds),
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: KosaiPalette.c2),
            ),
          ],
        ),
      ),
    );
  }
}
