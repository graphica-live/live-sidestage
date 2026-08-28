import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:provider/provider.dart';

import 'core/account_status_store.dart';
import 'core/app_config_store.dart';
import 'core/app_version.dart';
import 'core/background_task_handler.dart';
import 'core/gift_activity.dart';
import 'core/gift_name_ja.dart';
import 'core/session_controller.dart';
import 'core/version_compare.dart';
import 'screens/home_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/update_required_screen.dart';
import 'screens/welcome_screen.dart';

@pragma('vm:entry-point')
void startCallback() {
  // audioplayers等プラットフォームチャンネルを使うプラグインはBinding初期化が必須。
  // このcallbackは専用のバックグラウンドIsolateで実行されるため、main()側のbindingとは別に必要。
  WidgetsFlutterBinding.ensureInitialized();
  FlutterForegroundTask.setTaskHandler(CommentSpeechTaskHandler());
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // ギフトの日本語名キャッシュは FlutterForegroundTask のストレージに置いてある。
  FlutterForegroundTask.initCommunicationPort();
  // 端末に貯めた日本語名を1度だけ読む。以降はどの画面からも同期で引ける。
  // 読めなくても英語名のまま動くので、失敗しても起動は止めない
  // （サーバーから取り直すのはサウンドタブとギフトピッカー）。
  await GiftNameJa.ensureLoaded();
  // /api/mobile/me へのX-App-Versionヘッダー付与と、強制アップデート判定の
  // 両方がこれに依存する。取得に失敗しても起動は止めない(AppVersion.load()内で吸収)。
  await AppVersion.load();
  runApp(const LiveSidestageApp());
}

class LiveSidestageApp extends StatelessWidget {
  const LiveSidestageApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => SessionController()..loadPersisted()),
        ChangeNotifierProvider(create: (_) => AppConfigStore()..load()),
        ChangeNotifierProvider(create: (_) => AccountStatusStore()),
        // ギフト受信を貢献・ギフト履歴タブへ伝えるだけの通知。数値は持たない。
        ChangeNotifierProvider(create: (_) => GiftActivityNotifier()),
      ],
      child: MaterialApp(
        title: 'LIVE Sidestage',
        theme: ThemeData(colorSchemeSeed: Colors.deepPurple, useMaterial3: true),
        home: const AuthGate(),
      ),
    );
  }
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  // /api/mobile/me の取得を「セッションのuserIdが変わったとき」だけトリガーするための
  // 直近リクエスト先の記録。buildは何度も呼ばれるので、これが無いと呼ぶたびに
  // リクエストが飛んでしまう。
  String? _requestedForUserId;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<SessionController>();
    final configStore = context.watch<AppConfigStore>();
    final accountStatus = context.watch<AccountStatusStore>();

    if (!controller.initialized) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final session = controller.session;
    if (session == null) {
      if (_requestedForUserId != null) {
        _requestedForUserId = null;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          context.read<AccountStatusStore>().reset();
        });
      }
      return const WelcomeScreen();
    }

    if (_requestedForUserId != session.userId) {
      _requestedForUserId = session.userId;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        context.read<AccountStatusStore>().refresh(userId: session.userId, token: session.token);
      });
    }

    if (session.onboardingRequired) return const OnboardingScreen();

    // HomeScreen 配下だけが AppConfig を編集する。ロード完了前に操作させると、
    // 既定値からの編集がロード結果を上書きしてユーザーの設定を消す。
    // ログイン前の画面は AppConfig を触らないのでここまでは待たせない。
    if (!configStore.loaded) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    // 強制アップデート判定より前にHome・背景サービスへ進ませないよう、
    // 取得の試行が終わるまで待つ(成功・失敗は問わない。失敗時はfallback値で通過する)。
    if (!accountStatus.loaded) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    // 自分のバージョンが取得できない場合は判定不能として通す(fail open) —
    // クライアント側の取得失敗でアプリが永久に起動できなくなる事故を避けるため。
    final currentVersion = AppVersion.current;
    if (currentVersion != null &&
        !isVersionAtLeast(currentVersion, accountStatus.status.minimumSupportedVersion)) {
      return UpdateRequiredScreen(currentVersion: currentVersion);
    }

    return const HomeScreen();
  }
}
