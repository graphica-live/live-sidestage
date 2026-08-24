// ステータスバーの表示規則。
//
//  - エラー本文は省略しない（ユーザーがスクリーンショットで問い合わせに使う）
//  - 複数のエラーを1本に合成せず全部並べる
//  - TikTok 側の事情は赤くしない（こちらの不具合ではない）
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/feature_status.dart';
import 'package:live_sidestage_mobile/screens/widgets/feature_status_bar.dart';

Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('状態のラベルを出す', (tester) async {
    await tester.pumpWidget(wrap(const FeatureStatusBar(status: FeatureStatus.waitingForLive)));
    expect(find.text('配信開始待ち'), findsOneWidget);
  });

  testWidgets('エラーはラベル付きで全部並べる', (tester) async {
    await tester.pumpWidget(wrap(const FeatureStatusBar(
      status: FeatureStatus.error,
      errors: [('接続', 'サーバーに接続できません'), ('読み上げ', 'VOICEVOXの初期化に失敗しました')],
    )));

    expect(find.text('接続: サーバーに接続できません'), findsOneWidget);
    expect(find.text('読み上げ: VOICEVOXの初期化に失敗しました'), findsOneWidget);
  });

  // 問い合わせ用のスクリーンショットで読めないと意味がない。
  testWidgets('長いエラーを省略せず折り返し、選択もできる', (tester) async {
    const long =
        'サーバーの応答を解析できませんでした (HTTP 502): Application failed to respond. '
        'This error originates from the upstream service and was not produced by the app itself.';

    await tester.pumpWidget(wrap(const FeatureStatusBar(
      status: FeatureStatus.error,
      errors: [('接続', long)],
    )));

    final text = tester.widget<SelectableText>(find.byType(SelectableText));
    expect(text.data, contains(long));
    // ellipsis で切っていないこと（切ると末尾が読めない）。
    expect(text.maxLines, isNull);
  });

  testWidgets('TikTok側の事情は赤くしない', (tester) async {
    await tester.pumpWidget(wrap(const FeatureStatusBar(
      status: FeatureStatus.waitingForLive,
      notice: '配信認証の混雑により接続を待機中です。約10分後に自動で再接続します',
    )));

    final text = tester.widget<SelectableText>(find.byType(SelectableText));
    expect(text.style?.color, isNot(Colors.red));
  });

  testWidgets('noticeとerrorsは同時に出せる', (tester) async {
    await tester.pumpWidget(wrap(const FeatureStatusBar(
      status: FeatureStatus.error,
      errors: [('接続', 'サーバーに接続できません')],
      notice: '配信が始まるのを待っています',
    )));

    expect(find.text('配信が始まるのを待っています'), findsOneWidget);
    expect(find.text('接続: サーバーに接続できません'), findsOneWidget);
  });

  testWidgets('何も無ければラベルだけ', (tester) async {
    await tester.pumpWidget(wrap(const FeatureStatusBar(status: FeatureStatus.stopped)));

    expect(find.text('停止中'), findsOneWidget);
    expect(find.byType(SelectableText), findsNothing);
  });
}
