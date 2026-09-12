// RankingListTileは貢献タブ・バトル履歴タブの1行。
// 行そのものの見た目(枠線・サイズ)はrankによらず統一し、
// 1〜3位だけ順位数字をグラデーションメダル(光彩)にする。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';
import 'package:live_sidestage_mobile/models/gift_breakdown.dart';
import 'package:live_sidestage_mobile/models/gift_ranking_entry.dart';
import 'package:live_sidestage_mobile/screens/widgets/gradient_kit.dart';
import 'package:live_sidestage_mobile/screens/widgets/ranking_list_tile.dart';
import 'package:live_sidestage_mobile/screens/widgets/user_avatar.dart';

const _rank1 = KosaiPalette.rank1;
const _rank2 = KosaiPalette.rank2;
const _rank3 = KosaiPalette.rank3;

Widget wrap(Widget child) {
  return MaterialApp(home: Scaffold(body: child));
}

const _entry = GiftRankingEntry(
  tiktokUid: '7000000000000000001',
  tiktokHandle: 'u1',
  nickname: 'テストユーザー',
  giftCount: 3,
  totalDiamonds: 1000,
);

/// TikTokUser 行が無い送信者。サーバーは tiktokHandle を null で返す。
/// uid だけでは `https://www.tiktok.com/@...` を組み立てられないので、
/// プロフィール導線(タップ)は出さない。
const _entryWithoutHandle = GiftRankingEntry(
  tiktokUid: '7000000000000000002',
  nickname: 'ハンドル不明ユーザー',
  giftCount: 1,
  totalDiamonds: 500,
);

void main() {
  testWidgets('rankによらず行のパディングは変わらない', (tester) async {
    for (final rank in [1, 2, 3, 4]) {
      await tester.pumpWidget(wrap(RankingListTile(rank: rank, entry: _entry)));
      final padding = tester.widget<Padding>(find.byType(Padding).first);
      expect(padding.padding, const EdgeInsets.symmetric(vertical: 10), reason: 'rank $rank');
    }
  });

  testWidgets('rankによらずコイン数は🪙表記・太字のまま', (tester) async {
    for (final rank in [1, 4]) {
      await tester.pumpWidget(wrap(RankingListTile(rank: rank, entry: _entry)));
      final text = tester.widget<Text>(find.text('🪙1,000'));
      expect(text.style?.fontWeight, FontWeight.w700, reason: 'rank $rank');
    }
  });

  testWidgets('1〜3位はグラデーションメダルになる', (tester) async {
    final expected = {1: _rank1, 2: _rank2, 3: _rank3};
    for (final entry in expected.entries) {
      await tester.pumpWidget(wrap(RankingListTile(rank: entry.key, entry: _entry)));
      // GradientRing(アバター枠、30x30)も同じgradient値を取りうるため、GradientMedal固有のサイズ(26x26)で絞り込む。
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Container &&
              w.constraints == const BoxConstraints.tightFor(width: 26, height: 26) &&
              w.decoration is BoxDecoration &&
              (w.decoration! as BoxDecoration).shape == BoxShape.circle &&
              (w.decoration! as BoxDecoration).gradient == entry.value,
        ),
        findsOneWidget,
        reason: 'rank ${entry.key}',
      );
    }
  });

  testWidgets('4位以下はグラデーションメダルにならずデフォルト色の数字のまま', (tester) async {
    for (final rank in [4, 5]) {
      await tester.pumpWidget(wrap(RankingListTile(rank: rank, entry: _entry)));
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Container &&
              w.constraints == const BoxConstraints.tightFor(width: 26, height: 26) &&
              w.decoration is BoxDecoration &&
              (w.decoration! as BoxDecoration).shape == BoxShape.circle,
        ),
        findsNothing,
        reason: 'rank $rank',
      );
      final text = tester.widget<Text>(find.text('$rank'));
      expect(text.style?.color, isNull, reason: 'rank $rank');
    }
  });

  testWidgets('fetchBreakdown未指定なら展開シェブロンを出さない(バトル履歴タブの従来動作)', (tester) async {
    await tester.pumpWidget(wrap(const RankingListTile(rank: 1, entry: _entry)));
    expect(find.byIcon(Icons.keyboard_arrow_down), findsNothing);
  });

  testWidgets('fetchBreakdown未指定時、順位メダル部分にもタップ領域(InkWell)が残る(プロフィール遷移の退行防止)', (tester) async {
    // openTiktokProfile自体(url_launcher)はテスト環境でモックする既存パターンが無いため呼び出し結果は検証しない。
    // 従来「行全体タップでプロフィール遷移」だった箇所が、アコーディオン対応の実装変更でメダル部分だけ
    // タップ領域から漏れる退行(DeepSeek指摘)が実際に起きたため、InkWellの存在だけは回帰確認する。
    await tester.pumpWidget(wrap(const RankingListTile(rank: 1, entry: _entry)));
    final medalInkWell = find.ancestor(
      of: find.byWidgetPredicate(
        (w) => w is Container && w.constraints == const BoxConstraints.tightFor(width: 26, height: 26),
      ),
      matching: find.byType(InkWell),
    );
    expect(medalInkWell, findsOneWidget);
  });

  testWidgets('tiktokHandleがnullの行は、fetchBreakdown未指定時にプロフィール遷移のタップを受け付けない', (tester) async {
    await tester.pumpWidget(wrap(const RankingListTile(rank: 1, entry: _entryWithoutHandle)));
    final inkWells = tester.widgetList<InkWell>(find.byType(InkWell));
    expect(inkWells, isNotEmpty);
    expect(inkWells.every((w) => w.onTap == null), isTrue);
    final avatarTap = tester.widget<GestureDetector>(
      find.ancestor(of: find.byType(UserAvatar), matching: find.byType(GestureDetector)).first,
    );
    expect(avatarTap.onTap, isNull);
  });

  testWidgets('tiktokHandleがnullでも、fetchBreakdown指定時は名前タップでギフト内訳が展開する', (tester) async {
    var calls = 0;
    await tester.pumpWidget(
      wrap(
        RankingListTile(
          rank: 1,
          entry: _entryWithoutHandle,
          fetchBreakdown: (tiktokUid) async {
            calls++;
            expect(tiktokUid, '7000000000000000002');
            return const GiftBreakdownResult(
              gifts: [GiftBreakdownEntry(giftId: 1, giftName: 'Rose', repeatCount: 2, totalDiamonds: 500)],
              coverage: GiftBreakdownCoverage(detailAvailable: true, partial: false),
            );
          },
        ),
      ),
    );
    await tester.tap(find.text('ハンドル不明ユーザー'));
    await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.text('Rose'), findsOneWidget);
  });

  testWidgets('fetchBreakdown指定時、名前部分のタップでギフト内訳が展開する(アバターは展開しない)', (tester) async {
    var calls = 0;
    await tester.pumpWidget(
      wrap(
        RankingListTile(
          rank: 1,
          entry: _entry,
          fetchBreakdown: (tiktokUid) async {
            calls++;
            return const GiftBreakdownResult(
              gifts: [
                GiftBreakdownEntry(giftId: 1, giftName: 'ローズ', repeatCount: 3, totalDiamonds: 300),
              ],
              coverage: GiftBreakdownCoverage(detailAvailable: true, partial: false),
            );
          },
        ),
      ),
    );

    expect(find.byIcon(Icons.keyboard_arrow_down), findsOneWidget);

    // アバターアイコンのタップでは展開しない(プロフィール遷移用の別タップ領域)。
    await tester.tap(find.byType(UserAvatar));
    await tester.pump();
    expect(calls, 0);
    expect(find.text('ローズ'), findsNothing);

    // 行のそれ以外(名前)のタップで展開し、ギフト内訳を取得・表示する。
    await tester.tap(find.text('テストユーザー'));
    await tester.pump();
    await tester.pump();
    expect(calls, 1);
    expect(find.text('ローズ'), findsOneWidget);
    expect(find.text('×3'), findsOneWidget);

    // 再度タップすると閉じる(再取得はしない = キャッシュ)。
    await tester.tap(find.text('テストユーザー'));
    await tester.pump();
    expect(find.text('ローズ'), findsNothing);
    await tester.tap(find.text('テストユーザー'));
    await tester.pump();
    await tester.pump();
    expect(calls, 1);
    expect(find.text('ローズ'), findsOneWidget);
  });

  testWidgets('fetchBreakdown指定時、順位メダル部分のタップでも展開する(web版のtr全体トグルに合わせる)', (tester) async {
    var calls = 0;
    await tester.pumpWidget(
      wrap(
        RankingListTile(
          rank: 4, // メダル無し(数字表示)のrankで、GradientMedalに依存しないタップ領域を確認する。
          entry: _entry,
          fetchBreakdown: (tiktokUid) async {
            calls++;
            return const GiftBreakdownResult(gifts: [], coverage: GiftBreakdownCoverage(detailAvailable: true, partial: false));
          },
        ),
      ),
    );

    await tester.tap(find.text('4'));
    await tester.pump();
    await tester.pump();
    expect(calls, 1);
    expect(find.text('この期間の内訳はありません'), findsOneWidget);
  });

  testWidgets('fetchBreakdown指定時、1〜3位(グラデーションメダル)でも順位部分のタップで展開する', (tester) async {
    var calls = 0;
    await tester.pumpWidget(
      wrap(
        RankingListTile(
          rank: 1,
          entry: _entry,
          fetchBreakdown: (tiktokUid) async {
            calls++;
            return const GiftBreakdownResult(gifts: [], coverage: GiftBreakdownCoverage(detailAvailable: true, partial: false));
          },
        ),
      ),
    );

    await tester.tap(find.byWidgetPredicate((w) => w is Container && w.constraints == const BoxConstraints.tightFor(width: 26, height: 26)));
    await tester.pump();
    await tester.pump();
    expect(calls, 1);
    expect(find.text('この期間の内訳はありません'), findsOneWidget);
  });

  testWidgets('fetchBreakdown指定時、複数のギフト種別をtotalDiamonds降順で表示する', (tester) async {
    await tester.pumpWidget(
      wrap(
        RankingListTile(
          rank: 1,
          entry: _entry,
          fetchBreakdown: (tiktokUid) async => const GiftBreakdownResult(
            gifts: [
              GiftBreakdownEntry(giftId: 2, giftName: 'モナリザ', repeatCount: 1, totalDiamonds: 500),
              GiftBreakdownEntry(giftId: 1, giftName: 'ローズ', repeatCount: 3, totalDiamonds: 300),
            ],
            coverage: GiftBreakdownCoverage(detailAvailable: true, partial: false),
          ),
        ),
      ),
    );

    await tester.tap(find.text('テストユーザー'));
    await tester.pump();
    await tester.pump();
    expect(find.text('モナリザ'), findsOneWidget);
    expect(find.text('ローズ'), findsOneWidget);
    expect(find.text('×1'), findsOneWidget);
    expect(find.text('×3'), findsOneWidget);
    // モナリザ(500)がローズ(300)より先に描画される(サーバー側のtotalDiamonds降順を尊重して表示するだけで並び替えない)。
    final monaY = tester.getTopLeft(find.text('モナリザ')).dy;
    final roseY = tester.getTopLeft(find.text('ローズ')).dy;
    expect(monaY, lessThan(roseY));
  });

  testWidgets('fetchBreakdown指定時、取得失敗でエラー表示、再試行タップで再取得する', (tester) async {
    var calls = 0;
    await tester.pumpWidget(
      wrap(
        RankingListTile(
          rank: 1,
          entry: _entry,
          fetchBreakdown: (tiktokUid) async {
            calls++;
            // 通常のHTTPリクエストと同様、非同期境界を挟んでから例外を投げる
            // (即時throwだとFutureBuilder購読前にunhandledとして検出されテストが不安定になる)。
            await Future<void>.delayed(Duration.zero);
            if (calls == 1) throw Exception('network error');
            return const GiftBreakdownResult(
              gifts: [GiftBreakdownEntry(giftId: 1, giftName: 'ローズ', repeatCount: 1, totalDiamonds: 100)],
              coverage: GiftBreakdownCoverage(detailAvailable: true, partial: false),
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('テストユーザー'));
    await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.text('内訳を取得できませんでした'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '再試行'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, '再試行'));
    await tester.pumpAndSettle();
    expect(calls, 2);
    expect(find.text('内訳を取得できませんでした'), findsNothing);
    expect(find.text('ローズ'), findsOneWidget);
  });

  testWidgets('fetchBreakdown指定時、明細が残っていない期間はその旨を表示する', (tester) async {
    await tester.pumpWidget(
      wrap(
        RankingListTile(
          rank: 1,
          entry: _entry,
          fetchBreakdown: (tiktokUid) async => const GiftBreakdownResult(
            gifts: [],
            coverage: GiftBreakdownCoverage(detailAvailable: false, partial: false),
          ),
        ),
      ),
    );

    await tester.tap(find.text('テストユーザー'));
    await tester.pump();
    await tester.pump();
    expect(find.textContaining('内訳は残っていません'), findsOneWidget);
  });

  testWidgets('fetchBreakdown指定時、refresh token 失効(TOKEN_REUSE_DETECTED)で「再ログインしてください」と「ログアウト」ボタンを表示する',
      (tester) async {
    await tester.pumpWidget(
      wrap(
        RankingListTile(
          rank: 1,
          entry: _entry,
          fetchBreakdown: (tiktokUid) async {
            // refresh token 失効を示す ApiException（statusCode=401, code=TOKEN_REUSE_DETECTED）
            await Future<void>.delayed(Duration.zero);
            throw ApiException(
              'refresh token が無効です',
              statusCode: 401,
              code: 'TOKEN_REUSE_DETECTED',
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('テストユーザー'));
    await tester.pumpAndSettle();

    // refresh token 失効用のメッセージが表示される
    expect(find.text('ログインの有効期限が切れました。再ログインしてください'), findsOneWidget);

    // 「ログアウト」ボタンが表示される
    expect(find.widgetWithText(TextButton, 'ログアウト'), findsOneWidget);

    // 従来の「再試行」ボタンは表示されない
    expect(find.widgetWithText(TextButton, '再試行'), findsNothing);

    // 従来のエラー文言「内訳を取得できませんでした」は表示されない
    expect(find.text('内訳を取得できませんでした'), findsNothing);
  });

  testWidgets('fetchBreakdown指定時、refresh token 失効(INVALID_REFRESH_TOKEN)でも「再ログインしてください」と「ログアウト」ボタンを表示する',
      (tester) async {
    await tester.pumpWidget(
      wrap(
        RankingListTile(
          rank: 1,
          entry: _entry,
          fetchBreakdown: (tiktokUid) async {
            // refresh token 失効を示す ApiException（statusCode=401, code=INVALID_REFRESH_TOKEN）
            await Future<void>.delayed(Duration.zero);
            throw ApiException(
              'refresh token が無効です',
              statusCode: 401,
              code: 'INVALID_REFRESH_TOKEN',
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('テストユーザー'));
    await tester.pumpAndSettle();

    // refresh token 失効用のメッセージが表示される
    expect(find.text('ログインの有効期限が切れました。再ログインしてください'), findsOneWidget);

    // 「ログアウト」ボタンが表示される
    expect(find.widgetWithText(TextButton, 'ログアウト'), findsOneWidget);

    // 従来の「再試行」ボタンは表示されない
    expect(find.widgetWithText(TextButton, '再試行'), findsNothing);
  });
}
