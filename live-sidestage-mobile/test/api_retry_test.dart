import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';
import 'package:live_sidestage_mobile/core/api_retry.dart';

/// `withTokenRefresh` は貢献/ギフト履歴/バトル履歴の4呼び出し箇所が共有する
/// 汎用401リトライヘルパー。既存の `fetchGiftCandidatesWithRefresh`
/// (`session_refresh_test.dart` 参照)と同じ契約を、専用実装を持たない
/// ジェネリック版として固定する。
void main() {
  test('成功すればそのまま返す(リフレッシュを呼ばない)', () async {
    var refreshCalls = 0;
    final result = await withTokenRefresh<String>(
      call: (token) async => 'ok:$token',
      token: 'valid',
      refreshToken: () async {
        refreshCalls++;
        return 'new';
      },
    );

    expect(result, 'ok:valid');
    expect(refreshCalls, 0);
  });

  test('401ならトークンを取り直して1回だけ再試行する', () async {
    var calls = 0;
    final result = await withTokenRefresh<String>(
      call: (token) async {
        calls++;
        if (token != 'new') throw ApiException('認証が必要です', statusCode: 401);
        return 'ok:$token';
      },
      token: 'expired',
      refreshToken: () async => 'new',
    );

    expect(result, 'ok:new');
    expect(calls, 2);
  });

  test('403も401と同様にリフレッシュ対象にする', () async {
    var refreshCalls = 0;
    final result = await withTokenRefresh<String>(
      call: (token) async {
        if (token != 'new') throw ApiException('認証が必要です', statusCode: 403);
        return 'ok:$token';
      },
      token: 'expired',
      refreshToken: () async {
        refreshCalls++;
        return 'new';
      },
    );

    expect(result, 'ok:new');
    expect(refreshCalls, 1);
  });

  test('リフレッシュできなければ401をそのまま投げる', () async {
    await expectLater(
      withTokenRefresh<String>(
        call: (token) async => throw ApiException('認証が必要です', statusCode: 401),
        token: 'expired',
        refreshToken: () async => null,
      ),
      throwsA(isA<ApiException>().having((e) => e.isUnauthorized, 'isUnauthorized', isTrue)),
    );
  });

  test('リフレッシュ後の再試行も失敗すればそのまま投げる', () async {
    var calls = 0;
    await expectLater(
      withTokenRefresh<String>(
        call: (token) async {
          calls++;
          throw ApiException('認証が必要です', statusCode: 401);
        },
        token: 'expired',
        refreshToken: () async => 'new',
      ),
      throwsA(isA<ApiException>()),
    );
    expect(calls, 2); // 初回 + リフレッシュ後の1回だけ(無限リトライしない)
  });

  test('401/403以外はリフレッシュせずそのまま投げる', () async {
    var refreshCalls = 0;
    await expectLater(
      withTokenRefresh<String>(
        call: (token) async => throw ApiException('サーバーエラー', statusCode: 500),
        token: 'valid',
        refreshToken: () async {
          refreshCalls++;
          return 'new';
        },
      ),
      throwsA(isA<ApiException>()),
    );
    expect(refreshCalls, 0);
  });

  test('通信自体の失敗(statusCode無し)はリフレッシュせずそのまま投げる', () async {
    var refreshCalls = 0;
    await expectLater(
      withTokenRefresh<String>(
        call: (token) async => throw ApiException('サーバーに接続できませんでした'),
        token: 'valid',
        refreshToken: () async {
          refreshCalls++;
          return 'new';
        },
      ),
      throwsA(isA<ApiException>()),
    );
    expect(refreshCalls, 0);
  });
}
