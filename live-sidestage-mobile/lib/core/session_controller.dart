import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'dart:math';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../models/auth_session.dart';
import '../models/tiktok_account_preview.dart';
import 'api_client.dart';
import 'api_retry.dart';
import 'session_storage.dart';
import 'token_refresh_result.dart';

/// android/app/build.gradle.kts の applicationId と一致させること。
/// Google Cloud ConsoleのAndroid OAuthクライアント登録に使う値。
const String androidPackageName = 'com.liveanalytics.live_sidestage_mobile';

/// Apple へ渡す nonce / state。
typedef AppleCredentialFetcher = Future<AuthorizationCredentialAppleID> Function({
  required String nonce,
  required String state,
});

/// アプリが前面へ戻ってきたことを知らせる。戻り値は購読の解除。
typedef AppResumeWatcher = VoidCallback Function(VoidCallback onResumed);

/// Custom Tab から戻ったあと、callback 経由で結果が届くのを待つ猶予。
/// これを過ぎても未解決なら「ユーザーがタブを閉じた」とみなす。
const Duration _appleReturnGrace = Duration(seconds: 3);

class _AppResumeObserver with WidgetsBindingObserver {
  _AppResumeObserver(this.onResumed);

  final VoidCallback onResumed;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) onResumed();
  }
}

VoidCallback _watchAppResumeWithBinding(VoidCallback onResumed) {
  try {
    final binding = WidgetsBinding.instance;
    final observer = _AppResumeObserver(onResumed);
    binding.addObserver(observer);
    return () => binding.removeObserver(observer);
  } catch (_) {
    // バインディングが無い環境（純粋な dart テストなど）では監視しない。
    return () {};
  }
}

class SessionController extends ChangeNotifier {
  /// 依存はテストのためだけに差し替え可能にしてある。既定は本番実装。
  SessionController({
    LiveAnalyticsApi? api,
    SessionStorage? storage,
    GoogleSignIn? googleSignIn,
    AppleCredentialFetcher? appleCredential,
    AppResumeWatcher? watchAppResume,
    bool? appleSignInEnabled,
    bool? watchAppResumeOnApple,
  })  : _watchAppResume = watchAppResume ?? _watchAppResumeWithBinding,
        _appleSignInEnabled = appleSignInEnabled ?? isAppleSignInConfigured,
        _watchAppResumeOnApple = watchAppResumeOnApple ?? Platform.isAndroid,
        _api = api ?? LiveAnalyticsApi(),
        _storage = storage ?? SessionStorage(),
        _googleSignIn = googleSignIn ??
            GoogleSignIn(
              serverClientId: googleServerClientId,
              scopes: ['email'],
            ) {
    _appleCredential = appleCredential ?? _appleCredentialFromApple;
  }

  final LiveAnalyticsApi _api;
  final SessionStorage _storage;
  final GoogleSignIn _googleSignIn;

  late final AppleCredentialFetcher _appleCredential;

  final AppResumeWatcher _watchAppResume;

  /// ビルドに Apple の設定が渡っているか。既定は [isAppleSignInConfigured]。
  final bool _appleSignInEnabled;

  /// [_awaitAppleCredential] でアプリの前面復帰を監視して強制キャンセルするか。
  ///
  /// **Android専用の対処**。Custom Tabで戻ったのに結果が来ない場合の救済で、
  /// iOS/macOSではプラグインのFutureが必ず解決する(ネイティブシートが閉じた時点で
  /// キャンセル例外つきで返る)ため不要かつ有害になりうる — ネイティブシート表示中の
  /// inactive→resumed遷移とグレース期間の兼ね合いで、正常系なのに偽キャンセルする
  /// 理論的余地がある。既定は [Platform.isAndroid] だが、テストでは
  /// ホストOSに関わらずAndroidの挙動を検証できるよう注入可能にしてある。
  final bool _watchAppResumeOnApple;

  /// 進行中のトークン再発行。複数のAPI呼び出しが同時に401になっても
  /// refresh token の交換を多重に走らせないよう、同じ Future を共有する。
  ///
  /// **これは必須の直列化。** refresh token は1回使い切り(rotation)なので、
  /// 同じ値で2本同時に交換を試みるとサーバー側の reuse 検知に触れうる。
  Future<TokenRefreshResult>? _refreshInFlight;

  /// アカウント削除の実行中〜完了後を示す。**[deleteAccount] の最初の await より前に
  /// 同期的に立てる。** 削除リクエスト送信中に token refresh が割り込むと、サーバー側の
  /// Google/Apple認証ルートは Account/User が既に無いものとして新規Userを作ってしまう
  /// ([_doRefresh] 側の早期returnで防ぐ)。削除に失敗した場合はアカウントが消えていないので
  /// 通常のログイン状態へ戻す（[deleteAccount] 内でリセット）。新しいセッションが確立したら
  /// （[_run] の成功パス）自動的に解除する。
  bool _deleting = false;

  AuthSession? session;
  bool initialized = false;
  bool isLoading = false;
  String? errorMessage;

  Future<void> loadPersisted() async {
    try {
      session = await _storage.load();
    } catch (_) {
      session = null;
    }
    initialized = true;
    notifyListeners();
  }

  Future<bool> signInWithGoogle() {
    return _run(() async {
      final GoogleSignInAccount? account;
      try {
        account = await _googleSignIn.signIn();
      } on PlatformException catch (e) {
        throw ApiException(_googleSignInMessage(e));
      }
      if (account == null) {
        throw ApiException('サインインがキャンセルされました');
      }
      final auth = await account.authentication;
      final idToken = auth.idToken;
      if (idToken == null) {
        throw ApiException('Google認証トークンの取得に失敗しました');
      }
      return _api.authenticateWithGoogle(idToken: idToken);
    });
  }

  /// Google Play services側の失敗を、原因が特定できる日本語メッセージに変換する。
  /// 特にcode 10(DEVELOPER_ERROR)は、Google Cloud Consoleに
  /// 「パッケージ名 + ビルド署名のSHA-1」でAndroid OAuthクライアントが
  /// 登録されていない場合に必ず発生する。applicationIdを変更した直後は要再登録。
  String _googleSignInMessage(PlatformException e) {
    final detail = e.message ?? '';
    if (detail.contains('10:') || detail.contains('DEVELOPER_ERROR')) {
      return 'Googleサインインの設定が未完了です(DEVELOPER_ERROR)。'
          'Google Cloud Consoleに、パッケージ名 $androidPackageName と'
          'このビルドの署名SHA-1でAndroid OAuthクライアントが登録されているか確認してください。';
    }
    if (e.code == 'network_error') {
      return 'ネットワークに接続できませんでした。通信状態を確認してください。';
    }
    return 'Googleサインインに失敗しました(${e.code})。';
  }

  /// メールアドレス+パスワードでの新規登録。成功したらそのままログイン済み状態になる。
  Future<bool> registerWithEmail({required String email, required String password}) {
    return _run(() => _api.registerWithEmail(email: email, password: password));
  }

  /// メールアドレス+パスワードでのログイン。
  Future<bool> signInWithEmail({required String email, required String password}) {
    return _run(() => _api.loginWithEmail(email: email, password: password));
  }

  /// Apple サインイン。
  ///
  /// Android にはネイティブの Apple 認証が無いので Custom Tab で web フローを回す。
  /// Apple → 自前サーバーの中継エンドポイント → `signinwithapple://callback` と戻り、
  /// **その受け口の Activity は exported なので他アプリからも叩ける**。そのため
  ///
  ///   - `state`: この端末が始めた認証かを端末側で照合する（下）
  ///   - `nonce`: サーバーが id_token のクレームと完全一致を確認する
  ///   - `authorizationCode`: サーバーが Apple と交換する。単回・短命
  ///
  /// の3つで、他人の認証結果を流し込まれてログインさせられる経路を塞ぐ。
  Future<bool> signInWithApple() {
    return _run(() async {
      if (!_appleSignInEnabled) {
        throw ApiException('Appleサインインはこのビルドでは利用できません。');
      }

      final nonce = _randomToken();
      final state = _randomToken();

      final AuthorizationCredentialAppleID credential;
      try {
        credential = await _awaitAppleCredential(nonce: nonce, state: state);
      } on SignInWithAppleAuthorizationException catch (e) {
        throw ApiException(_appleSignInMessage(e));
      } on SignInWithAppleException catch (e) {
        throw ApiException('Appleサインインに失敗しました($e)。');
      }

      // パッケージは state を返すだけで照合しない。ここで突き合わせないと
      // 攻撃者が自分の Apple 応答を投げ込んで、被害者を攻撃者のアカウントへ
      // ログインさせられる（その後 TikTok ID を登録させて覗く）。
      if (credential.state != state) {
        throw ApiException('Apple認証の照合に失敗しました。もう一度お試しください。');
      }

      return _api.authenticateWithApple(
        authorizationCode: credential.authorizationCode,
        nonce: nonce,
        // 氏名は初回認可のときしか返らない。
        givenName: credential.givenName,
        familyName: credential.familyName,
      );
    });
  }

  /// Apple の認証結果を待つ。**ユーザーが Custom Tab を閉じた場合に備える。**
  ///
  /// `sign_in_with_apple` 8.1.0 の Android 実装は、認証を完了せずにタブを閉じられると
  /// **Future を永久に resolve しない**（戻ってきたことを知る手段がプラグイン側に無い）。
  /// そのまま待つと `isLoading` が立ちっぱなしになり、アプリを再起動するまで
  /// ログインボタンを押せなくなる。
  ///
  /// アプリが前面へ戻ったのを検知し、そこから少し待っても結果が来なければ
  /// キャンセル扱いにする（正常系では戻った直後に callback で解決する）。
  Future<AuthorizationCredentialAppleID> _awaitAppleCredential({
    required String nonce,
    required String state,
  }) {
    final credential = _appleCredential(nonce: nonce, state: state);
    if (!_watchAppResumeOnApple) return credential;

    final cancelled = Completer<AuthorizationCredentialAppleID>();

    // 敗者側の結果が未処理例外として報告されないように受け口を用意しておく。
    credential.then((_) {}, onError: (_) {});

    Timer? grace;
    final stopWatching = _watchAppResume(() {
      grace?.cancel();
      grace = Timer(_appleReturnGrace, () {
        if (!cancelled.isCompleted) {
          cancelled.completeError(ApiException('サインインがキャンセルされました'));
        }
      });
    });

    return Future.any([credential, cancelled.future]).whenComplete(() {
      grace?.cancel();
      stopWatching();
    });
  }

  Future<AuthorizationCredentialAppleID> _appleCredentialFromApple({
    required String nonce,
    required String state,
  }) {
    return SignInWithApple.getAppleIDCredential(
      scopes: const [
        AppleIDAuthorizationScopes.email,
        AppleIDAuthorizationScopes.fullName,
      ],
      nonce: nonce,
      state: state,
      // Android では必須。clientId は Bundle ID ではなく Services ID。
      webAuthenticationOptions: WebAuthenticationOptions(
        clientId: appleServicesId,
        redirectUri: Uri.parse(appleRedirectUri),
      ),
    );
  }

  String _appleSignInMessage(SignInWithAppleAuthorizationException e) {
    switch (e.code) {
      case AuthorizationErrorCode.canceled:
        return 'サインインがキャンセルされました';
      case AuthorizationErrorCode.notHandled:
      case AuthorizationErrorCode.notInteractive:
        return 'Appleサインインを開始できませんでした。もう一度お試しください。';
      case AuthorizationErrorCode.invalidResponse:
        return 'Appleからの応答が不正でした。もう一度お試しください。';
      default:
        return 'Appleサインインに失敗しました(${e.code.name})。';
    }
  }

  /// nonce / state 用の 256bit 乱数。推測されると上の照合が意味を失うので
  /// 必ず [Random.secure] を使う。
  static String _randomToken() {
    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    return base64UrlEncode(bytes).replaceAll('=', '');
  }

  /// 登録前確認。セッションは書き換えない。失敗時は [errorMessage]。
  Future<TiktokAccountPreview?> previewTiktokAccount({required String tiktokHandle}) async {
    final current = session;
    if (current == null) return null;

    isLoading = true;
    errorMessage = null;
    notifyListeners();
    try {
      return await withTokenRefresh(
        call: (t) => _api.previewStreamer(token: t, tiktokHandle: tiktokHandle),
        token: current.token,
        refreshToken: refreshToken,
      );
    } on ApiException catch (e) {
      errorMessage = e.message;
      return null;
    } catch (e) {
      errorMessage = '予期しないエラーが発生しました: $e';
      return null;
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> completeOnboarding({required String tiktokHandle}) {
    final current = session;
    if (current == null) return Future.value(false);

    return _run(() async {
      final (token, streamer) = await _api.registerStreamer(
        token: current.token,
        tiktokHandle: tiktokHandle,
      );
      return current.withStreamer(token: token, streamer: streamer);
    });
  }

  Future<bool> changeTiktokHandle(String tiktokHandle) {
    final current = session;
    if (current == null) return Future.value(false);

    return _run(() async {
      final streamer = await withTokenRefresh(
        call: (t) => _api.updateTiktokHandle(token: t, tiktokHandle: tiktokHandle),
        token: current.token,
        refreshToken: refreshToken,
      );
      // リフレッシュが起きた場合、[session] が差し替わっている。キャプチャ済みの
      // [current] を戻り値の基底にすると、成功したのに失効トークンを
      // 保存し直してしまうため、必ず最新の [session] を使う。
      final refreshed = session ?? current;
      return refreshed.withStreamer(token: refreshed.token, streamer: streamer);
    });
  }

  /// 失効した access token を refresh token で取り直す。
  ///
  /// 成功したら新しい access token を返し、保存済みセッションも
  /// （**access token と refresh token の両方を**）差し替える。取り直せなければ
  /// null を返す（手動の再ログインが要る）。**セッションは壊さない** ――
  /// オフラインやサーバー側の一時的な失敗でログアウト扱いにしないため。
  ///
  /// **プロバイダによる分岐は無い。** Google/Apple/メールのどの経路でログインしても、
  /// サーバーは同じ形の refresh token を発行しており、同じエンドポイント
  /// (`/api/mobile/auth/refresh`) で再発行できる。以前は Google の
  /// `signInSilently` に頼っていたため Apple/メールのユーザーだけ無言再発行が
  /// できなかったが、その非対称は解消済み。
  Future<String?> refreshToken() async {
    final result = await refreshTokenDetailed();
    return result.token;
  }

  /// [refreshToken] の詳細版。refresh token 自体が失効した（再ログインが要る）のか、
  /// 通信断・5xx等の一時的な失敗（再試行すれば直りうる）のかを呼び出し側が
  /// 区別できるようにする（[TokenRefreshResult] 参照）。
  Future<TokenRefreshResult> refreshTokenDetailed() {
    return _refreshInFlight ??= _doRefresh().whenComplete(() => _refreshInFlight = null);
  }

  Future<TokenRefreshResult> _doRefresh() async {
    // これから走る/進行中のアカウント削除が優先。ここで打ち切らないと、
    // 削除済みUserのために無駄なトークンを発行しに行くことになる。
    // **一時的な失敗ではない**(削除中は今後も再発行を試みる意味が無い)ので Rejected。
    if (_deleting) {
      return TokenRefreshRejected(StateError('アカウント削除処理中'));
    }
    final current = session;
    if (current == null) {
      return TokenRefreshRejected(StateError('セッションがありません'));
    }

    final (String token, String refreshToken) pair;
    try {
      pair = await _api.refreshAccessToken(refreshToken: current.refreshToken);
    } catch (e) {
      // isRefreshTokenRejected なら再発行は二度と成功しない（再ログインが要る）。
      // それ以外（通信断・5xx）は一時的な失敗。**どちらの場合もセッションは壊さない** ――
      // 破棄の判断は呼び出し側の導線に委ねる。
      debugPrint('[session] access token の再発行に失敗しました: $e');
      return tokenRefreshResultFromError(e);
    }

    // 待っている間にログアウト・アカウント削除・別アカウントでのログインが
    // 起きていたら、そちらを尊重して古いセッションを復活させない。
    // **取得した新しいtoken自体は有効**なので一時的失敗ではなく Rejected
    // （このFutureの呼び出し元には無意味。再試行しても同じ結果になる）。
    final latest = session;
    if (_deleting || latest == null || latest.userId != current.userId) {
      return TokenRefreshRejected(StateError('再発行中にセッションが切り替わりました'));
    }

    final refreshed = latest.withTokens(token: pair.$1, refreshToken: pair.$2);
    await _storage.save(refreshed);
    session = refreshed;
    // isLoading / errorMessage は動かさない（[_run] を通さない）。背景での更新であり、
    // ログイン画面のスピナーやエラー表示を動かす種類の処理ではない。
    notifyListeners();
    return TokenRefreshed(refreshed.token);
  }

  /// 背景 Isolate が rotation した token ペアを取り込む。
  ///
  /// **メイン/背景のどちらで再発行が起きても、もう片方へ必ず伝播させる。**
  /// 伝播を怠ると、次に相手側が無効化済みの refresh token を提示し、サーバーの
  /// reuse 検知で family ごと失効（＝不要な強制ログアウト）になる。
  Future<void> adoptTokens({required String token, required String refreshToken}) async {
    final current = session;
    if (current == null) return;
    if (current.token == token && current.refreshToken == refreshToken) return;

    final updated = current.withTokens(token: token, refreshToken: refreshToken);
    await _storage.save(updated);
    // 保存中に別アカウントへ切り替わっていたら取り込まない。
    if (session?.userId != current.userId) return;
    session = updated;
    notifyListeners();
  }

  Future<bool> _run(Future<AuthSession> Function() action) async {
    isLoading = true;
    errorMessage = null;
    notifyListeners();

    try {
      final result = await action();
      await _storage.save(result);
      session = result;
      // 新しいセッションが確立した以上、直前のアカウント削除は完了していないか
      // 無関係（別アカウントでのログイン）。フラグを持ち越すと、以後このセッションの
      // token refresh が永久に早期returnし続けてしまう。
      _deleting = false;
      return true;
    } on ApiException catch (e) {
      errorMessage = e.message;
      return false;
    } catch (e) {
      // 想定外の例外もUIに出す。握り潰すと「押しても何も起きない」状態になる。
      errorMessage = '予期しないエラーが発生しました: $e';
      return false;
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  /// **画面から直接呼ばないこと。** Foreground Service の停止と、そこに保存された
  /// token/refreshToken の削除まで含めた正しい手順は `performLogout()`
  /// (`lib/core/logout.dart`) が持っている。ここはその最終段。
  Future<void> logout() async {
    final current = session;
    // サーバー側で refresh token の family 全体を失効させる。**ベストエフォート** ――
    // 失敗してもローカルのログアウトは必ず続行する(通信できない場所で
    // ログアウトできなくなるのを避ける)。
    if (current != null) {
      await _api.logoutSession(refreshToken: current.refreshToken);
    }
    await _clearLocalSession(current?.provider);
  }

  /// アカウント削除。サーバー側のUser削除に成功したら[logout]と同じく
  /// ローカルセッションを未ログイン状態へ落とす。
  ///
  /// 端末に残る他のローカルデータ（設定・取り込み済み効果音ファイル・
  /// 背景サービスが保持する token / refreshToken 等）はここでは触らない — それらは
  /// [SessionController] の責務外（呼び出し側で
  /// `confirmAndDeleteAccount`（`account_deletion.dart`）を通して後始末する）。
  ///
  /// 失敗時（Stripe解約失敗などでサーバー側がfail-closedで中断した場合）は
  /// アカウントが消えていないので、通常どおり使える状態のまま `false` を返す。
  Future<bool> deleteAccount() async {
    final current = session;
    if (current == null) return false;

    // 最初のawaitより前に同期的に立てる。詳細は _deleting のdocを参照。
    _deleting = true;
    isLoading = true;
    errorMessage = null;
    notifyListeners();

    try {
      await withTokenRefresh(
        call: (t) => _api.deleteAccount(token: t),
        token: current.token,
        refreshToken: refreshToken,
      );
    } on ApiException catch (e) {
      _deleting = false;
      errorMessage = e.message;
      return false;
    } catch (e) {
      _deleting = false;
      errorMessage = '予期しないエラーが発生しました: $e';
      return false;
    } finally {
      isLoading = false;
      notifyListeners();
    }

    await _clearLocalSession(current.provider);
    return true;
  }

  Future<void> _clearLocalSession(AuthProvider? provider) async {
    await _storage.clear();
    // Google でログインしていた場合だけ Google 側のサインアウトを呼ぶ。
    // Apple には端末側のサインアウト API が無い（ブラウザのセッションは
    // Apple 側の管理）ので、ローカルの破棄だけで完結する。email も同様に
    // Google 側には何も残っていないので呼ぶ意味が無い。
    if (provider == AuthProvider.google) {
      try {
        await _googleSignIn.signOut();
      } catch (_) {
        // ignore — ローカルセッションは既にクリア済み
      }
    }
    session = null;
    notifyListeners();
  }
}
