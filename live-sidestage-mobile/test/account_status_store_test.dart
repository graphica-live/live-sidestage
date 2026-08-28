import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/account_status_store.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';
import 'package:live_sidestage_mobile/models/account_status.dart';

class _FakeApi extends LiveAnalyticsApi {
  final Map<String, AccountStatus> byToken = {};
  final Map<String, Object> errorByToken = {};
  final Map<String, Completer<void>> gateByToken = {};
  int calls = 0;

  @override
  Future<AccountStatus> fetchAccountStatus({required String token}) async {
    calls++;
    final gate = gateByToken[token];
    if (gate != null) await gate.future;

    final error = errorByToken[token];
    if (error != null) throw error;

    final status = byToken[token];
    if (status == null) {
      throw ApiException('認証が必要です', statusCode: 401);
    }
    return status;
  }
}

AccountStatus _status({String userId = 'u1', String plan = 'PRO'}) => AccountStatus(
      userId: userId,
      effectivePlan: plan,
      betaAccess: false,
      features: const [],
      minimumSupportedVersion: '0.0.0',
      maintenanceMode: false,
    );

void main() {
  test('成功時はstatusを反映しloaded=trueになる', () async {
    final api = _FakeApi()..byToken['tok-1'] = _status();
    final store = AccountStatusStore(api: api);

    await store.refresh(userId: 'u1', token: 'tok-1');

    expect(store.loaded, isTrue);
    expect(store.status.effectivePlan, 'PRO');
    expect(api.calls, 1);
  });

  test('通信失敗はfallbackへ倒しつつloaded=trueにする(アプリを止めない)', () async {
    final api = _FakeApi()
      ..errorByToken['tok-1'] = ApiException('サーバーに接続できませんでした');
    final store = AccountStatusStore(api: api);

    await store.refresh(userId: 'u1', token: 'tok-1');

    expect(store.loaded, isTrue);
    expect(store.status.effectivePlan, AccountStatus.fallback.effectivePlan);
  });

  test('401もfallbackへ倒す(再ログイン導線は他のAPI呼び出し側が持つ)', () async {
    final api = _FakeApi(); // byTokenに登録が無いので401が飛ぶ
    final store = AccountStatusStore(api: api);

    await store.refresh(userId: 'u1', token: 'unknown-token');

    expect(store.loaded, isTrue);
    expect(store.status.effectivePlan, AccountStatus.fallback.effectivePlan);
  });

  test('取得中に別ユーザーへ切り替わったら古い結果を捨てる', () async {
    final gate = Completer<void>();
    final api = _FakeApi()
      ..byToken['tok-old'] = _status(userId: 'old', plan: 'ULTRA')
      ..byToken['tok-new'] = _status(userId: 'new', plan: 'FREE')
      ..gateByToken['tok-old'] = gate;
    final store = AccountStatusStore(api: api);

    final oldRefresh = store.refresh(userId: 'old', token: 'tok-old');
    // oldの結果がまだ返っていないうちに、newへ切り替わる。
    await store.refresh(userId: 'new', token: 'tok-new');
    expect(store.status.effectivePlan, 'FREE');

    // oldの結果が遅れて返っても上書きしない。
    gate.complete();
    await oldRefresh;
    expect(store.status.effectivePlan, 'FREE');
    expect(store.status.userId, 'new');
  });

  test('reset()はfallbackへ戻しloaded=falseにする', () async {
    final api = _FakeApi()..byToken['tok-1'] = _status();
    final store = AccountStatusStore(api: api);
    await store.refresh(userId: 'u1', token: 'tok-1');
    expect(store.loaded, isTrue);

    store.reset();

    expect(store.loaded, isFalse);
    expect(store.status.effectivePlan, AccountStatus.fallback.effectivePlan);
  });
}
