import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:in_app_purchase_android/in_app_purchase_android.dart';

import 'account_status_store.dart';
import 'api_client.dart';

/// Google Play課金の商品ID。Play Consoleに同じ値でサブスクリプション商品を
/// 登録すること(README/CLAUDE.md参照)。サーバー環境変数
/// `GOOGLE_PLAY_PRODUCT_ID_PRO` / `GOOGLE_PLAY_PRODUCT_ID_ULTRA` と同じ値にする。
class GooglePlayProductIds {
  const GooglePlayProductIds._();

  static const String pro = 'live_sidestage_pro_monthly';
  static const String ultra = 'live_sidestage_ultra_monthly';

  static const Set<String> all = {pro, ultra};
}

enum BillingPurchaseState { idle, processing, success, error, canceled }

/// `in_app_purchase`ラッパー。Google Playの購入・復元フローと、サーバーの
/// init/verify-purchase APIとの橋渡しを1箇所に集約する。
///
/// **Android(Google Play)専用。** iOSは今回対象外。
class BillingService extends ChangeNotifier {
  BillingService({LiveAnalyticsApi? api, InAppPurchase? inAppPurchase})
      : _api = api ?? LiveAnalyticsApi(),
        _iap = inAppPurchase ?? InAppPurchase.instance;

  final LiveAnalyticsApi _api;
  final InAppPurchase _iap;
  StreamSubscription<List<PurchaseDetails>>? _subscription;

  String? _token;
  String? _userId;
  AccountStatusStore? _accountStatusStore;

  BillingPurchaseState state = BillingPurchaseState.idle;
  String? errorMessage;
  List<ProductDetails> products = const [];

  /// アプリ起動時、ログイン済みセッションが判明した時点で1回呼ぶ。
  /// [token]はverify-purchase呼び出しに使うJWT、[accountStatusStore]は
  /// 購入確定後にeffectivePlanを取り直すために使う。
  Future<void> init({
    required String token,
    required String userId,
    required AccountStatusStore accountStatusStore,
  }) async {
    _token = token;
    _userId = userId;
    _accountStatusStore = accountStatusStore;

    // Android専用。iOS上で動かすと、GooglePlayPurchaseParam(applicationUserName等、
    // Android専用フィールド)を使ったbuyや、restorePurchases()がApple側のreceiptを
    // PurchaseStatus.restoredとして返した際にそれをGoogle Play専用のverify APIへ
    // 送ってしまう(実装後レビュー指摘、MEDIUM)。iOS課金は今回スコープ外。
    if (!Platform.isAndroid) return;

    if (_subscription != null) return; // 既に購読中なら二重購読しない。

    final available = await _iap.isAvailable();
    if (!available) {
      // 呼び出し元(AuthGate)はuserId不変の間再試行しないため、ここで黙って終えると
      // 購入ボタンが押しても無反応のまま残る(実装後レビュー指摘、MEDIUM)。
      state = BillingPurchaseState.error;
      errorMessage = 'Google Playに接続できませんでした。時間をおいてアプリを再起動してください。';
      notifyListeners();
      return;
    }

    _subscription = _iap.purchaseStream.listen(_onPurchaseUpdated, onError: (_) {
      state = BillingPurchaseState.error;
      errorMessage = 'Google Playとの通信でエラーが発生しました。';
      notifyListeners();
    });

    final response = await _iap.queryProductDetails(GooglePlayProductIds.all);
    products = response.productDetails;
    if (response.error != null || products.isEmpty) {
      state = BillingPurchaseState.error;
      errorMessage = '商品情報を取得できませんでした。時間をおいて再度お試しください。';
    }
    notifyListeners();
  }

  /// トークンが更新された(再ログイン等)場合に呼ぶ。
  void updateToken(String token) => _token = token;

  /// ログアウト時に呼ぶ。次のユーザーのinit()が古いトークン・userIdを見ないようにする。
  void resetSession() {
    _token = null;
    _userId = null;
    _accountStatusStore = null;
    // state/errorMessageを残したままだと、次のユーザーがログインした直後の
    // SubscriptionScreenが前のユーザーのエラー表示を一瞬引き継ぐ(実装後レビュー指摘、LOW)。
    state = BillingPurchaseState.idle;
    errorMessage = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  /// 商品を購入する。結果は[purchaseStream]経由で非同期に届くため、
  /// このメソッド自体は「購入ダイアログの表示に成功したか」だけを表す。
  Future<void> buy(ProductDetails productDetails) async {
    if (!Platform.isAndroid) return; // Android専用。iOS課金は今回スコープ外。
    if (state == BillingPurchaseState.processing) return; // 多重タップ防止。
    final token = _token;
    if (token == null) {
      state = BillingPurchaseState.error;
      errorMessage = 'ログイン情報を確認できませんでした。';
      notifyListeners();
      return;
    }

    // SubscriptionScreen側のUIロックと同じ判定をここでも掛ける。プラン変更(upgrade/
    // downgrade)は未実装なので、既に有料プラン中の新規購入は開始させない
    // (実装後レビュー指摘、CRITICAL — サーバー側entitlementがGoogle Play実態と食い違う
    // 場合の二重課金リスク。根本対応にはGoogle Play側の所有購読の事前照会が要るが、
    // 現行in_app_purchaseにその手段が無く本タスクの範囲を超えるため、既知の残存リスクとして
    // 報告に残す)。
    final currentPlan = _accountStatusStore?.status.effectivePlan;
    if (currentPlan == 'PRO' || currentPlan == 'ULTRA') {
      state = BillingPurchaseState.error;
      errorMessage = '既に有料プランをご利用中です。';
      notifyListeners();
      return;
    }

    state = BillingPurchaseState.processing;
    errorMessage = null;
    notifyListeners();

    try {
      final obfuscatedAccountId = await _api.initGoogleBilling(token: token);
      final purchaseParam = GooglePlayPurchaseParam(
        productDetails: productDetails,
        applicationUserName: obfuscatedAccountId,
      );
      final launched = await _iap.buyNonConsumable(purchaseParam: purchaseParam);
      if (!launched) {
        // Android実装はlaunchBillingFlowが非OKの場合、例外ではなくfalseを返す
        // (実装後レビュー指摘、MEDIUM)。ここで抜けないとpurchaseStreamに
        // イベントが来ないままprocessingへ固定され、以降の購入・復元が
        // アプリ再起動まで一切できなくなる。
        state = BillingPurchaseState.error;
        errorMessage = '購入画面を開始できませんでした。時間をおいて再度お試しください。';
        notifyListeners();
        return;
      }
      // ここから先は purchaseStream の PurchaseStatus.purchased/error/canceled で処理する。
    } on ApiException catch (e) {
      // 既に有効なプランを持っている場合(409)を含め、init自体が失敗した場合はここで完結させる
      // (Google Playの購入ダイアログをまだ開いていないので、completePurchaseは不要)。
      state = BillingPurchaseState.error;
      errorMessage = e.message;
      notifyListeners();
    } catch (_) {
      state = BillingPurchaseState.error;
      errorMessage = '購入処理を開始できませんでした。通信環境を確認してください。';
      notifyListeners();
    }
  }

  // restore()呼び出し以降にpurchaseStreamでpurchased/restoredイベントを観測したか。
  // Androidの実装は`restorePurchases()`のFutureが解決するより先にstreamへイベントを
  // addすることがあり(プラットフォームチャネルの非同期順序はFutureの完了を待たない)、
  // 「復元対象なしはstreamに何も流れない」という前提だけでは検証中のidle誤復帰を
  // 防げない(実装後レビュー指摘、CRITICAL — 検証完了前に別の購入・復元を開始できる)。
  bool _restoreObservedEvent = false;

  /// アプリ再インストール後などに、既存の有効な購入を検出して反映させる。
  Future<void> restore() async {
    if (!Platform.isAndroid) return; // Android専用。iOS課金は今回スコープ外。
    if (state == BillingPurchaseState.processing) return;
    _restoreObservedEvent = false;
    state = BillingPurchaseState.processing;
    errorMessage = null;
    notifyListeners();
    try {
      await _iap.restorePurchases();
      // 復元対象が無ければストリームには何も流れないので、ここで一旦idleへ戻す。
      // ただしFuture完了より先にstreamイベントを観測済み(=検証が既に走っている)なら
      // 上書きしない。
      if (state == BillingPurchaseState.processing && !_restoreObservedEvent) {
        state = BillingPurchaseState.idle;
        notifyListeners();
      }
    } catch (_) {
      state = BillingPurchaseState.error;
      errorMessage = '復元処理に失敗しました。通信環境を確認してください。';
      notifyListeners();
    }
  }

  Future<void> _onPurchaseUpdated(List<PurchaseDetails> purchaseDetailsList) async {
    for (final purchase in purchaseDetailsList) {
      switch (purchase.status) {
        case PurchaseStatus.pending:
          state = BillingPurchaseState.processing;
          notifyListeners();
          break;
        case PurchaseStatus.error:
          state = BillingPurchaseState.error;
          errorMessage = purchase.error?.message ?? '購入処理でエラーが発生しました。';
          notifyListeners();
          // pendingCompletePurchaseがfalseの場合は何もしない(未完了トランザクションを残さない)。
          break;
        case PurchaseStatus.canceled:
          state = BillingPurchaseState.canceled;
          notifyListeners();
          break;
        case PurchaseStatus.purchased:
        case PurchaseStatus.restored:
          // restore()は`restorePurchases()`呼び出し直後、イベントが届く前にidleへ
          // 戻ることがある(復元対象なしとの区別がストリーム側に無いため)。ここで
          // 改めてprocessingへ戻すことで、検証が終わるまでbuy()/restore()の多重実行を
          // 防ぐ(実装後レビュー指摘、HIGH — 検証中に別の購入・復元を開始できる余地があった)。
          state = BillingPurchaseState.processing;
          _restoreObservedEvent = true;
          notifyListeners();
          await _verifyAndComplete(purchase);
          break;
      }
    }
  }

  /// purchased/restored共通の検証・確定処理。
  ///
  /// **initを呼び直さない。** サーバーのverify-purchaseは、このpurchaseToken自体の
  /// Subscription行が既に本人名義で存在すれば(=restoredで再送されたケース)intent照合
  /// なしで通す設計になっている(実装後レビュー指摘、CRITICAL)。以前はここでinitを
  /// 呼び直し、その409(「userIdに何らかの有効entitlementがある」というアカウント単位の
  /// 判定でしかない)を「このpurchaseTokenの検証成功」と誤って読み替えていたため、
  /// 未検証のtokenを acknowledge してしまう欠陥があった。
  Future<void> _verifyAndComplete(PurchaseDetails purchase) async {
    final token = _token;
    // 検証開始時点のuserIdを固定する。AccountStatusStore・BillingServiceは
    // どちらもアプリ全体で1インスタンスをログイン中のユーザーが使い回すため、
    // ここで固定しておかないと、以降のawait中にログアウト→別ユーザーでログイン
    // された場合、そのユーザーの共有store(_accountStatusStore)へ検証開始時の
    // ユーザーの購入結果を書き込んでしまう(実装後レビュー指摘、CRITICAL —
    // クロスユーザーのプラン情報漏洩)。
    final verifyingUserId = _userId;
    if (token == null) {
      state = BillingPurchaseState.error;
      errorMessage = 'ログイン情報を確認できませんでした。';
      notifyListeners();
      return;
    }

    try {
      await _api.verifyGooglePurchase(
        token: token,
        purchaseToken: purchase.verificationData.serverVerificationData,
      );

      if (purchase.pendingCompletePurchase) {
        await _iap.completePurchase(purchase);
      }

      // 検証中にセッションが切り替わっていたら、この結果を今ログイン中の
      // (別)ユーザーの状態へ反映しない。購入自体(verify/acknowledge)は
      // 検証開始時のユーザー本人のtokenで完結しているので、反映だけを止める。
      final sessionUnchanged = verifyingUserId != null && verifyingUserId == _userId;
      final accountStatusStore = _accountStatusStore;
      if (sessionUnchanged && accountStatusStore != null) {
        await accountStatusStore.refresh(userId: verifyingUserId, token: token);
      }

      if (!sessionUnchanged) {
        state = BillingPurchaseState.success;
        errorMessage = null;
        notifyListeners();
        return;
      }

      // サーバーはverifyGooglePurchaseを通してもentitlementActive=false(=FREE)の
      // Subscription行を作ることがある(未知productId、Play Console設定とサーバー環境変数
      // GOOGLE_PLAY_PRODUCT_ID_PRO/ULTRAの不一致等)。決済自体は成立しているためここでは
      // エラー扱いにできないが、反映されていないのに「更新しました」と伝えるのは誤りなので
      // 区別する(実装後レビュー指摘、CRITICAL — 支払い済みなのに権利が付かない事故の早期検知)。
      // ただしrefresh自体が通信断でfallbackへ倒れた場合はサーバーが実際にFREEと
      // 答えたわけではないので、fallback中はこの判定をスキップする(実装後レビュー指摘、
      // MEDIUM — 通信断だけで正常購入が誤ってエラー扱いになる)。
      final reflectedStatus = accountStatusStore?.status;
      if (reflectedStatus != null &&
          !reflectedStatus.isFallback &&
          reflectedStatus.effectivePlan == 'FREE') {
        state = BillingPurchaseState.error;
        errorMessage = '購入処理は完了しましたが、プランへの反映を確認できませんでした。時間をおいて画面を開き直すか、サポートへお問い合わせください。';
        notifyListeners();
        return;
      }

      state = BillingPurchaseState.success;
      errorMessage = null;
      notifyListeners();
    } catch (e) {
      // サーバー未確認のままではcompletePurchaseを呼ばない
      // (ローカル側だけで購入成立扱いにしない)。
      state = BillingPurchaseState.error;
      errorMessage = e is ApiException ? e.message : '購入の検証に失敗しました。時間をおいて再度お試しください。';
      notifyListeners();
    }
  }
}
