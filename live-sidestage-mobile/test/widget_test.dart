import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:live_sidestage_mobile/core/comment_feed.dart';
import 'package:live_sidestage_mobile/core/realtime_sync.dart';
import 'package:live_sidestage_mobile/main.dart';

void main() {
  setUp(() {
    const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'readAll') return <String, String>{};
      return null;
    });
  });

  testWidgets('起動直後はウェルカム画面が表示される', (WidgetTester tester) async {
    await tester.pumpWidget(const LiveSidestageApp());
    await tester.pump();
    await tester.pump();

    // ウェルカム画面はAppConfigを触らないので、設定のロード完了を待たずに出る。
    expect(find.text('LIVE Sidestage'), findsOneWidget);
    expect(find.text('Googleでログイン'), findsOneWidget);
  });

  testWidgets('Provider登録: CommentFeed/RankingSyncStore/GiftHistorySyncStore/BattleHistorySyncStore',
      (WidgetTester tester) async {
    // Batch01で追加した4つのProvider(CommentFeed, RankingSyncStore,
    // GiftHistorySyncStore, BattleHistorySyncStore)が main.dart 本体の
    // LiveSidestageApp が組み立てる MultiProvider に実際に登録されているかを検証する。
    // (登録漏れがあると、各タブの initState() の context.read<XXX>() が
    // ProviderNotFoundException を投げてタブが真っ白になる。)
    //
    // ここで別建てのMultiProviderを組んでしまうと、main.dart側の登録漏れを
    // 再現しても検知できない偽陽性テストになるため、必ず本物の LiveSidestageApp を
    // pumpしたツリーからProviderを解決する。ログイン前でもMultiProviderは
    // AuthGateの外側にあるため、WelcomeScreen配下のcontextで解決できる。
    await tester.pumpWidget(const LiveSidestageApp());
    await tester.pump();
    await tester.pump();

    final context = tester.element(find.text('LIVE Sidestage'));

    expect(() => Provider.of<CommentFeed>(context, listen: false), returnsNormally);
    expect(() => Provider.of<RankingSyncStore>(context, listen: false), returnsNormally);
    expect(() => Provider.of<GiftHistorySyncStore>(context, listen: false), returnsNormally);
    expect(() => Provider.of<BattleHistorySyncStore>(context, listen: false), returnsNormally);
  });
}
