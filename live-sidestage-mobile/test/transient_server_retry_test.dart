import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';

void main() {
  group('withTransientServerRetry', () {
    test('初回成功なら1回だけ呼ぶ', () async {
      var calls = 0;
      final result = await withTransientServerRetry(() async {
        calls++;
        return 42;
      });
      expect(result, 42);
      expect(calls, 1);
    });

    test('一時障害は最大3回リトライしてから成功', () async {
      var calls = 0;
      final result = await withTransientServerRetry(
        () async {
          calls++;
          if (calls < 3) {
            throw ApiException('busy', statusCode: 503);
          }
          return 'ok';
        },
        delayBetweenAttempts: Duration.zero,
      );
      expect(result, 'ok');
      expect(calls, 3);
    });

    test('リトライ上限を超えたら最後の ApiException を投げる', () async {
      var calls = 0;
      await expectLater(
        withTransientServerRetry(
          () async {
            calls++;
            throw ApiException('busy', statusCode: 503);
          },
          delayBetweenAttempts: Duration.zero,
        ),
        throwsA(
          isA<ApiException>().having((e) => e.statusCode, 'statusCode', 503),
        ),
      );
      expect(calls, 4);
    });

    test('400 はリトライしない', () async {
      var calls = 0;
      expect(
        () => withTransientServerRetry(() async {
          calls++;
          throw ApiException('not found', statusCode: 400);
        }),
        throwsA(isA<ApiException>()),
      );
      expect(calls, 1);
    });
  });

  group('ApiException.isTransientServerFailure', () {
    test('503 は true、401/400 は false', () {
      expect(ApiException('x', statusCode: 503).isTransientServerFailure, isTrue);
      expect(ApiException('x', statusCode: 401).isTransientServerFailure, isFalse);
      expect(ApiException('x', statusCode: 400).isTransientServerFailure, isFalse);
    });
  });
}

