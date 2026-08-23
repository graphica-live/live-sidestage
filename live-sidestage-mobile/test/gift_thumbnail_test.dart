// ギフトピッカーの行頭に出すアイコンの表示分岐を検証する。
//
// 一覧は最大1000件あり、画像を持たないギフト・取得に失敗するギフトが混ざる。
// どの分岐でも同じ大きさの枠を占め、行の高さがずれないことがここでの関心事。
//
// `flutter test` の HTTP クライアントは常に失敗を返すので、URL を渡したケースは
// そのまま「読み込みに失敗した」経路の検証にもなる。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/screens/gift_sound_edit_screen.dart';

const _url = 'https://p16-webcast.tiktokcdn.com/img/maliva/rose.png~tplv-obj.webp';

Future<void> pumpThumbnail(WidgetTester tester, String? imageUrl) {
  return tester.pumpWidget(
    MaterialApp(home: Scaffold(body: Center(child: GiftThumbnail(imageUrl)))),
  );
}

void main() {
  testWidgets('URL が無ければプレースホルダを出す', (tester) async {
    await pumpThumbnail(tester, null);

    expect(find.byIcon(Icons.card_giftcard), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('URL があれば画像を出す（引き伸ばさず、表示幅に合わせてデコードする）', (tester) async {
    await pumpThumbnail(tester, _url);

    final image = tester.widget<Image>(find.byType(Image));
    expect(image.fit, BoxFit.contain);
    // 36px を実ピクセルへ換算した値。テスト環境の devicePixelRatio は 3.0。
    expect(image.width, isNull); // 大きさは外側の SizedBox が決める
    expect((image.image as ResizeImage).width, 108);
  });

  testWidgets('読み込みに失敗したらプレースホルダに落ちる', (tester) async {
    await pumpThumbnail(tester, _url);
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.card_giftcard), findsOneWidget);
  });

  testWidgets('どの分岐でも同じ大きさの枠を占める（行の高さがずれない）', (tester) async {
    await pumpThumbnail(tester, null);
    final withoutImage = tester.getSize(find.byType(GiftThumbnail));

    await pumpThumbnail(tester, _url);
    expect(tester.getSize(find.byType(GiftThumbnail)), withoutImage);
    expect(withoutImage, const Size(36, 36));
  });
}
