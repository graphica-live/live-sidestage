import 'package:flutter/material.dart';

import '../../core/tiktok_profile.dart';
import '../../models/gift_breakdown.dart';
import '../../models/gift_ranking_entry.dart';
import 'diamond_format.dart';
import 'gradient_kit.dart';
import 'user_avatar.dart';

/// 貢献タブとバトル履歴タブの貢献者展開が共有する1行。
/// サーバー側で同じ形状(`GiftAnalyticsUser`)のデータを返すため両方から使う。
/// 1〜3位は順位数字をグラデーションメダル(光彩)にするだけで、行そのものの見た目
/// (枠・サイズ)は4位以下と統一する。
///
/// [fetchBreakdown] を渡した呼び出し元(貢献タブ)だけ、web版(AnalyticsView.tsx)と
/// 同じ挙動になる: アバターアイコンのタップのみでTikTokプロフィールへ遷移し、行の
/// それ以外の部分のタップはアコーディオン展開してギフト内訳(ギフト名別)を表示する。
/// 渡さない呼び出し元(バトル履歴タブ。内訳の取得元APIが無い)は、行全体タップで
/// プロフィールへ遷移する従来動作のまま。
class RankingListTile extends StatefulWidget {
  const RankingListTile({super.key, required this.rank, required this.entry, this.fetchBreakdown});

  final int rank;
  final GiftRankingEntry entry;
  final Future<GiftBreakdownResult> Function(String uniqueId)? fetchBreakdown;

  @override
  State<RankingListTile> createState() => _RankingListTileState();
}

class _RankingListTileState extends State<RankingListTile> {
  bool _expanded = false;
  Future<GiftBreakdownResult>? _future;

  void _toggle() {
    final fetchBreakdown = widget.fetchBreakdown;
    if (fetchBreakdown == null) return;
    final needsFetch = !_expanded && _future == null;
    final newFuture = needsFetch ? _startFetch(fetchBreakdown) : null;
    setState(() {
      _expanded = !_expanded;
      if (newFuture != null) _future = newFuture;
    });
  }

  void _retry() {
    final fetchBreakdown = widget.fetchBreakdown;
    if (fetchBreakdown == null) return;
    final newFuture = _startFetch(fetchBreakdown);
    setState(() {
      _future = newFuture;
    });
  }

  /// Futureはbuild(FutureBuilderのinitState)より前に作られるため、生成〜購読の間に
  /// エラーで即完了するとDartがunhandled errorとして検出することがある(テスト環境で再現)。
  /// ここでダミーのcatchErrorを登録してunhandled判定を防ぐ(実際のハンドリングはFutureBuilder側)。
  Future<GiftBreakdownResult> _startFetch(Future<GiftBreakdownResult> Function(String) fetchBreakdown) {
    final future = fetchBreakdown(widget.entry.uniqueId);
    future.then((_) {}, onError: (_) {});
    return future;
  }

  @override
  Widget build(BuildContext context) {
    final entry = widget.entry;
    final fetchBreakdown = widget.fetchBreakdown;
    final sub = Theme.of(context).colorScheme.onSurfaceVariant;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(
            children: [
              // web版(tr全体がトグル領域)に合わせ、アバター以外は全部トグル対象にする。
              // 順位メダル単体はここでカバーし、名前側は下のExpanded(InkWell)がカバーする。
              // fetchBreakdown未指定(バトル履歴タブ)は従来通り行全体タップでプロフィール遷移するため、
              // メダル部分もopenTiktokProfileに合わせる(退行防止)。
              InkWell(
                onTap: fetchBreakdown != null ? _toggle : () => openTiktokProfile(context, entry.uniqueId),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minWidth: 26),
                  child: GradientMedal(rank: widget.rank),
                ),
              ),
              const SizedBox(width: 8),
              GestureDetector(
                onTap: () => openTiktokProfile(context, entry.uniqueId),
                child: GradientRing(child: UserAvatar(entry.profileImageUrl)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: InkWell(
                  onTap: fetchBreakdown != null ? _toggle : () => openTiktokProfile(context, entry.uniqueId),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(entry.nickname, maxLines: 1, softWrap: false, overflow: TextOverflow.ellipsis),
                      ),
                      Text(
                        formatDiamonds(entry.totalDiamonds),
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: KosaiPalette.c2),
                      ),
                      if (fetchBreakdown != null) ...[
                        const SizedBox(width: 2),
                        AnimatedRotation(
                          turns: _expanded ? 0.5 : 0,
                          duration: const Duration(milliseconds: 150),
                          child: Icon(Icons.keyboard_arrow_down, size: 18, color: sub),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        if (fetchBreakdown != null && _expanded)
          Padding(
            padding: const EdgeInsets.fromLTRB(46, 0, 4, 10),
            child: _GiftBreakdownPanel(future: _future!, onRetry: _retry),
          ),
      ],
    );
  }
}

class _GiftBreakdownPanel extends StatelessWidget {
  const _GiftBreakdownPanel({required this.future, required this.onRetry});

  final Future<GiftBreakdownResult> future;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final sub = Theme.of(context).colorScheme.onSurfaceVariant;
    return FutureBuilder<GiftBreakdownResult>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: SizedBox(height: 14, width: 14, child: CircularProgressIndicator(strokeWidth: 2)),
          );
        }
        if (snapshot.hasError) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '内訳を取得できませんでした',
                    style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.error),
                  ),
                ),
                TextButton(onPressed: onRetry, child: const Text('再試行', style: TextStyle(fontSize: 12))),
              ],
            ),
          );
        }

        final result = snapshot.data!;
        if (!result.coverage.detailAvailable) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Text(
              'この期間の内訳は残っていません(ギフト明細は90日で削除されます)',
              style: TextStyle(fontSize: 11, color: sub),
            ),
          );
        }
        if (result.gifts.isEmpty) {
          return Padding(
            padding: EdgeInsets.symmetric(vertical: 4),
            child: Text('この期間の内訳はありません', style: TextStyle(fontSize: 11, color: sub)),
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final g in result.gifts)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        g.giftName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                    Text('×${g.repeatCount}', style: TextStyle(fontSize: 11, color: sub)),
                    const SizedBox(width: 8),
                    Text(
                      formatDiamonds(g.totalDiamonds),
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ),
          ],
        );
      },
    );
  }
}
