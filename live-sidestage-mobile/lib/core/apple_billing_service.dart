import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:in_app_purchase_storekit/store_kit_2_wrappers.dart';

import 'account_status_store.dart';
import 'api_client.dart';
import 'billing_service.dart' show BillingPurchaseState;

/// Apple IAP(StoreKit2)の商品ID。App Store Connectに同じ値でサブスクリプション商品を
/// 登録すること。PRO/ULTRAは同一Subscription Groupに登録し、ULTRAを上位level・PROを
/// 下位levelにする(別groupだと同時購読が成立し二重請求になる)。サーバー環境変数
/// `APPLE_PRODUCT_ID_PRO` / `APPLE_PRODUCT_ID_ULTRA` と同じ値にする。
class AppleProductIds {
  const AppleProductIds._();

  static const String pro = 'live_sidestage_pro_monthly_ios';
  static const String ultra = 'live_sidestage_ultra_monthly_ios';

  static const Set<String> all = {pro, ultra};
}

/// `in_app_purchase`ラッパー。Apple IAPの購入・復元フローと、サーバーの
/// init/verify-purchase APIとの橋渡しを1箇所に集約する。`billing_service.dart`
/// (Google Play専用)のミラー実装。
///
/// **iOS専用。** Androidは`BillingService`が担う。
class AppleBillingService extends ChangeNotifier {
  AppleBillingService({LiveAnalyticsApi? api, InAppPurchase? inAppPurchase})
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

    // iOS専用。Android版(BillingService)と対称のガード。
    if (!Platform.isIOS) return;

    if (_subscription != null) return; // 既に購読中なら二重購読しない。

    final available = await _iap.isAvailable();
    if (!available) {
      // 呼び出し元(AuthGate)はuserId不変の間再試行しないため、ここで黙って終えると
      // 購入ボタンが押しても無反応のまま残る(Android版と同じ理由)。
      state = BillingPurchaseState.error;
      errorMessage = 'App Storeに接続できませんでした。時間をおいてアプリを再起動してください。';
      notifyListeners();
      return;
    }

    _subscription = _iap.purchaseStream.listen(_onPurchaseUpdated, onError: (_) {
      state = BillingPurchaseState.error;
      errorMessage = 'App Storeとの通信でエラーが発生しました。';
      notifyListeners();
    });

    final response = await _iap.queryProductDetails(AppleProductIds.all);
    products = response.productDetails;
    if (response.error != null || products.isEmpty) {
      state = BillingPurchaseState.error;
      errorMessage = '商品情報を取得できませんでした。時間をおいて再度お試しください。';
    }
    notifyListeners();

    // クラッシュ・通信断で検証・finishされないまま残ったtransactionを回収する。
    // 放置すると次回同商品の購入がduplicate transaction扱いで拒否されうる
    // (Design Modeレビュー指摘)。UIの購入状態(state/errorMessage)には影響させない
    // (ユーザーが操作していないのに購入成功/失敗表示が出るのを避けるため)。
    unawaited(_recoverUnfinishedTransactions());
  }

  Future<void> _recoverUnfinishedTransactions() async {
    // _verifyAndCompleteと同じ理由でawait前に固定する。ここで固定しないと、回収ループの
    // await中にログアウト→別ユーザーログインが起きた場合、userId(117行相当)がawait後の
    // _userId(=新ユーザー)から読まれるため「切替検知」が常に真になり、旧ユーザーのtokenで
    // 取得したaccountStatusStore.refresh結果が新ユーザーのuserIdとして書き込まれてしまう
    // (Design Modeレビュー後の実装後レビュー指摘、HIGH)。
    final verifyingUserId = _userId;
    final token = _token;
    if (token == null) return;
    List<SK2Transaction> unfinished;
    try {
      unfinished = await SK2Transaction.unfinishedTransactions();
    } catch (_) {
      return; // 回収失敗はbest-effort。次回起動時にも再試行される。
    }
    for (final tx in unfinished) {
      try {
        await _api.verifyApplePurchase(token: token, transactionId: tx.id);
        final id = int.tryParse(tx.id);
        if (id != null) await SK2Transaction.finish(id);
      } catch (_) {
        // 検証に失敗したtransactionはfinishしない。次回起動時のunfinishedTransactions()に
        // 再び現れるので、そこで再試行される。
      }
    }
    // 未反映の権利が回収された可能性があるため、反映済みならUIへ届かせる。
    // ただし検証開始時点のユーザーのままセッションが継続している場合のみ反映する。
    final accountStatusStore = _accountStatusStore;
    final sessionUnchanged = verifyingUserId != null && verifyingUserId == _userId;
    if (accountStatusStore != null && sessionUnchanged) {
      await accountStatusStore.refresh(userId: verifyingUserId, token: token);
    }
  }

  /// トークンが更新された(再ログイン等)場合に呼ぶ。
  void updateToken(String token) => _token = token;

  /// ログアウト時に呼ぶ。次のユーザーのinit()が古いトークン・userIdを見ないようにする。
  void resetSession() {
    _token = null;
    _userId = null;
    _accountStatusStore = null;
    // state/errorMessageを残したままだと、次のユーザーがログインした直後の
    // SubscriptionScreenが前のユーザーのエラー表示を一瞬引き継ぐ(Android版と同じ理由)。
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
    if (!Platform.isIOS) return; // iOS専用。
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
    // (Android版と同じ理由。cross-provider/cross-deviceの二重課金は既知の残存リスクとして
    // Android版と同水準で許容する — Design Modeレビュー指摘、対応はスコープ外)。
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
      final appAccountToken = await _api.initAppleBilling(token: token);
      final purchaseParam = PurchaseParam(
        productDetails: productDetails,
        applicationUserName: appAccountToken,
      );
      final launched = await _iap.buyNonConsumable(purchaseParam: purchaseParam);
      if (!launched) {
        state = BillingPurchaseState.error;
        errorMessage = '購入画面を開始できませんでした。時間をおいて再度お試しください。';
        notifyListeners();
        return;
      }
      // ここから先は purchaseStream の PurchaseStatus.purchased/error/canceled で処理する。
    } on ApiException catch (e) {
      // 既に有効なプランを持っている場合(409)を含め、init自体が失敗した場合はここで完結させる
      // (App Storeの購入ダイアログをまだ開いていないので、completePurchaseは不要)。
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
  // Android版と同じ理由(Futureの完了より先にstreamイベントが来ることがある)で必要。
  bool _restoreObservedEvent = false;

  /// アプリ再インストール後などに、既存の有効な購入を検出して反映させる。
  Future<void> restore() async {
    if (!Platform.isIOS) return; // iOS専用。
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
          // 防ぐ(Android版と同じ理由)。
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
  /// **initを呼び直さない。** サーバーのverify-purchaseは、このtransactionId自体の
  /// originalTransactionIdに対応するSubscription行が既に本人名義で存在すれば
  /// (=restoredで再送されたケースや更新後のtransaction)intent照合なしで通す設計に
  /// なっている(Android版のGoogle Play検証と対称)。
  Future<void> _verifyAndComplete(PurchaseDetails purchase) async {
    final token = _token;
    // 検証開始時点のuserIdを固定する。AccountStatusStore・AppleBillingServiceは
    // どちらもアプリ全体で1インスタンスをログイン中のユーザーが使い回すため、
    // ここで固定しておかないと、以降のawait中にログアウト→別ユーザーでログイン
    // された場合、そのユーザーの共有store(_accountStatusStore)へ検証開始時の
    // ユーザーの購入結果を書き込んでしまう(Android版と同じ理由)。
    final verifyingUserId = _userId;
    if (token == null) {
      state = BillingPurchaseState.error;
      errorMessage = 'ログイン情報を確認できませんでした。';
      notifyListeners();
      return;
    }

    final transactionId = purchase.purchaseID;
    if (transactionId == null || transactionId.isEmpty) {
      state = BillingPurchaseState.error;
      errorMessage = '購入情報を確認できませんでした。時間をおいて再度お試しください。';
      notifyListeners();
      return;
    }

    try {
      await _api.verifyApplePurchase(token: token, transactionId: transactionId);

      if (purchase.pendingCompletePurchase) {
        await _iap.completePurchase(purchase);
      }

      // 検証中にセッションが切り替わっていたら、この結果を今ログイン中の
      // (別)ユーザーの状態へ反映しない。購入自体(verify/finish)は
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

      // サーバーはverifyApplePurchaseを通してもentitlementActive=false(=FREE)の
      // Subscription行を作ることがある(未知productId、App Store Connect設定とサーバー
      // 環境変数APPLE_PRODUCT_ID_PRO/ULTRAの不一致等)。決済自体は成立しているためここでは
      // エラー扱いにできないが、反映されていないのに「更新しました」と伝えるのは誤りなので
      // 区別する(Android版と同じ理由)。ただしrefresh自体が通信断でfallbackへ倒れた場合は
      // サーバーが実際にFREEと答えたわけではないので、fallback中はこの判定をスキップする。
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
