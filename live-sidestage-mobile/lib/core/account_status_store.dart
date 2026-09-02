import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

import '../models/account_status.dart';
import 'api_client.dart';

/// 背景Isolate(Foreground Service)がFREEプランの読み上げインターバル判定に使う、
/// 直近にサーバーから実際に取得できた実プラン(plan)の永続化キー。
///
/// **サーバーへの問い合わせが失敗した([AccountStatus.isFallback])ときは書き換えない。**
/// [AccountStatus.fallback] はUIの出し分け用に「最も広く許可される側(FREE)」へ倒す設計だが、
/// それをそのままここへ書くと、一時的な通信不良だけでPRO/ULTRAユーザーの読み上げまで
/// 5分間のインターバル制限を受ける事故になる。未保存(null)のときは背景Isolate側で
/// 「制限しない」に倒す(background_task_handler.dart参照)。
const String planStorageKey = 'plan';

/// 同じタイミングで保存する、モバイル領域のβが有効かどうかの永続化キー。
/// [planStorageKey]と同じ「取得成功時のみ書き換え」パターンで保存する。
const String mobileBetaActiveStorageKey = 'mobileBetaActive';

/// サーバーが返す `GET /api/mobile/me` を起動時に取得し、アプリ内の共通状態として持つ。
///
/// **参照情報であって権限の最終防衛線ではない。** ここでの[status]は「更新案内を出す」
/// 「将来PRO限定の入口を隠す」程度のUI出し分けにだけ使い、実際の可否判定は都度
/// サーバー側([status]取得元と同じrequireFeatureの仕組み)に委ねること。
///
/// 取得に失敗しても(オフライン・5xx・401いずれも)アプリを止めない。既定値
/// [AccountStatus.fallback] のまま[loaded]をtrueにして進む — このAPIはentitlementの
/// 「案内」でしかなく、落ちているからといって既存機能(コメント読み上げ等)を
/// 止める理由にはならない。
class AccountStatusStore extends ChangeNotifier {
  AccountStatusStore({LiveAnalyticsApi? api, Duration? timeout})
      : _api = api ?? LiveAnalyticsApi(),
        _timeout = timeout ?? const Duration(seconds: 8);

  final LiveAnalyticsApi _api;
  final Duration _timeout;

  AccountStatus status = AccountStatus.fallback;

  /// 取得の**試行**が完了したか(成功・失敗を問わない)。
  ///
  /// AuthGateはこれがtrueになるまで次の画面へ進めない。falseのまま既定値で
  /// 進めてしまうと、実際には強制アップデートが必要なユーザーが一瞬でも
  /// 通常画面・背景サービスへ到達しうる。
  bool loaded = false;

  /// 直近でリクエストしたuserId。取得中にログアウト→別ユーザーでログインされた場合に、
  /// 古いリクエストの結果で新しいユーザーの状態を上書きしないためのガード。
  String? _requestedUserId;

  Future<void> refresh({required String userId, required String token}) async {
    _requestedUserId = userId;

    AccountStatus next;
    try {
      next = await _api.fetchAccountStatus(token: token).timeout(_timeout);
    } catch (_) {
      // ネットワーク断・5xx・タイムアウト・401いずれもここに来る。
      // 401(トークン失効)は他のAPI呼び出しと同様、実際に機能を使う操作の方で
      // 再ログイン導線に乗る。ここでは黙って既定値へフォールバックするに留める。
      next = AccountStatus.fallback;
    }

    // 待っている間に別ユーザーへ切り替わっていたら、この結果は捨てる。
    if (_requestedUserId != userId) return;

    status = next;
    loaded = true;
    if (!next.isFallback) {
      // ベストエフォート。プラットフォームチャンネル未セットアップのテスト環境や
      // 保存失敗でアプリを止める理由にはならない(次回refresh成功時に上書きされる)。
      unawaited(
        FlutterForegroundTask.saveData(key: planStorageKey, value: next.plan).catchError((Object e) {
          debugPrint('[plan] planの保存に失敗しました: $e');
          return false;
        }),
      );
      unawaited(
        FlutterForegroundTask.saveData(key: mobileBetaActiveStorageKey, value: next.mobileBetaActive)
            .catchError((Object e) {
          debugPrint('[plan] mobileBetaActiveの保存に失敗しました: $e');
          return false;
        }),
      );
    }
    notifyListeners();
  }

  /// ログアウト時に呼ぶ。次のユーザーのAuthGateが古い状態を一瞬でも見ないようにする。
  void reset() {
    _requestedUserId = null;
    status = AccountStatus.fallback;
    loaded = false;
    notifyListeners();
  }
}
