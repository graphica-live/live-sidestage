import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../models/auth_session.dart';
import 'api_client.dart';
import 'session_storage.dart';

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
    Future<String?> Function()? silentIdToken,
    AppleCredentialFetcher? appleCredential,
    AppResumeWatcher? watchAppResume,
    bool? appleSignInEnabled,
  })  : _watchAppResume = watchAppResume ?? _watchAppResumeWithBinding,
        _appleSignInEnabled = appleSignInEnabled ?? isAppleSignInConfigured,
        _api = api ?? LiveAnalyticsApi(),
        _storage = storage ?? SessionStorage(),
        _googleSignIn = googleSignIn ??
            GoogleSignIn(
              serverClientId: googleServerClientId,
              scopes: ['email'],
            ) {
    _silentIdToken = silentIdToken ?? _silentIdTokenFromGoogle;
    _appleCredential = appleCredential ?? _appleCredentialFromApple;
  }

  final LiveAnalyticsApi _api;
  final SessionStorage _storage;
  final GoogleSignIn _googleSignIn;

  /// 無言でGoogleのidTokenを取り直す。取れなければ null（＝手動の再ログインが要る）。
  late final Future<String?> Function() _silentIdToken;

  late final AppleCredentialFetcher _appleCredential;

  final AppResumeWatcher _watchAppResume;

  /// ビルドに Apple の設定が渡っているか。既定は [isAppleSignInConfigured]。
  final bool _appleSignInEnabled;

  /// 進行中のトークン再発行。複数のAPI呼び出しが同時に401になっても
  /// Googleのサインインを多重起動しないよう、同じ Future を共有する。
  Future<String?>? _refreshInFlight;

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

  Future<bool> completeOnboarding({required String tiktokId}) {
    final current = session;
    if (current == null) return Future.value(false);

    return _run(() async {
      final (token, streamer) = await _api.registerStreamer(
        token: current.token,
        tiktokId: tiktokId,
      );
      return current.withStreamer(token: token, streamer: streamer);
    });
  }

  Future<bool> changeTiktokId(String tiktokId) {
    final current = session;
    if (current == null) return Future.value(false);

    return _run(() async {
      try {
        final streamer = await _api.updateTiktokId(token: current.token, tiktokId: tiktokId);
        return current.withStreamer(token: current.token, streamer: streamer);
      } on ApiException catch (e) {
        if (!e.isUnauthorized) rethrow;
        final token = await refreshToken();
        if (token == null) rethrow;
        // リフレッシュ後は [session] が差し替わっている。キャプチャ済みの
        // [current] を戻り値の基底にすると、成功したのに失効トークンを
        // 保存し直してしまう。
        final refreshed = session ?? current;
        final streamer = await _api.updateTiktokId(token: token, tiktokId: tiktokId);
        return refreshed.withStreamer(token: token, streamer: streamer);
      }
    });
  }

  /// 失効した JWT を Google の無言サインインで取り直す。
  ///
  /// 成功したら新しいトークンを返し、保存済みセッションも差し替える。
  /// 取り直せなければ null を返す（手動の再ログインが要る）。**セッションは壊さない** ――
  /// オフラインや Play services 側の一時的な失敗でログアウト扱いにしないため。
  ///
  /// サーバーの JWT は90日で失効するが、常用のコメント受信は socket.io の
  /// apiKey で繋いでいて失効を検知できない。JWT を使う API（ギフト候補・TikTok ID 変更）が
  /// 401 を返したときにだけ、ここを通して1回やり直す。
  /// `MOBILE_JWT_SECRET` のローテーションで失効した場合も同じ経路で復帰する。
  Future<String?> refreshToken() {
    return _refreshInFlight ??= _doRefresh().whenComplete(() => _refreshInFlight = null);
  }

  Future<String?> _doRefresh() async {
    final current = session;
    if (current == null) return null;
    // Apple には signInSilently 相当が無い（無言で取り直すと Custom Tab が
    // 勝手に開く）。失効したら手動の再ログインに委ねる。セッションは壊さない。
    if (current.provider != AuthProvider.google) return null;

    try {
      final idToken = await _silentIdToken();
      if (idToken == null) return null;

      final refreshed = await _api.authenticateWithGoogle(idToken: idToken);
      // 端末に別のGoogleアカウントが残っている場合に、他人のセッションで上書きしない。
      // 待っている間にログアウトされていた場合も、セッションを復活させない。
      if (session == null || refreshed.userId != current.userId) return null;

      await _storage.save(refreshed);
      session = refreshed;
      // isLoading / errorMessage は動かさない（[_run] を通さない）。背景での更新であり、
      // ログイン画面のスピナーやエラー表示を動かす種類の処理ではない。
      notifyListeners();
      return refreshed.token;
    } catch (_) {
      return null;
    }
  }

  Future<String?> _silentIdTokenFromGoogle() async {
    // reAuthenticate: true が要る。付けないと、同じプロセスが動き続けている間は
    // ネイティブ呼び出しをスキップして前回サインイン時の idToken（有効期限は約1時間）を
    // 返してくるため、常駐後のリフレッシュが必ず失敗する。
    final account = await _googleSignIn.signInSilently(reAuthenticate: true);
    if (account == null) return null;
    return (await account.authentication).idToken;
  }

  Future<bool> _run(Future<AuthSession> Function() action) async {
    isLoading = true;
    errorMessage = null;
    notifyListeners();

    try {
      final result = await action();
      await _storage.save(result);
      session = result;
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

  Future<void> logout() async {
    final provider = session?.provider;
    await _storage.clear();
    // Apple でログインしていたなら Google 側には何も残っていない。
    // Apple には端末側のサインアウト API が無い（ブラウザのセッションは
    // Apple 側の管理）ので、ローカルの破棄だけで完結する。
    if (provider != AuthProvider.apple) {
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
