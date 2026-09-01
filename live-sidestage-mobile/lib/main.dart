import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:marionette_flutter/marionette_flutter.dart';
import 'package:provider/provider.dart';

import 'core/account_status_store.dart';
import 'core/app_config_store.dart';
import 'core/app_version.dart';
import 'core/background_task_handler.dart';
import 'core/battle_activity.dart';
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
  // Debugビルドのみ Marionette MCP(AIエージェントによるUI操作・検証)を有効化する。
  // Releaseビルドはこれまでどおり WidgetsFlutterBinding のみ。
  if (kDebugMode) {
    MarionetteBinding.ensureInitialized();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
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

/// Card Deck方向のブランドテーマ。承認済みモックアップの実測トークン
/// (bg #FBF8F5 / card #FFFFFF / ink #211C18 / sub #928B83 / line #ECE5DC /
/// acc #D9591F、暗所は bg #141414 / card #1C1B19 / ink #ECE9E5 / sub #9B958A /
/// line #282623)をそのまま使う。**`ColorScheme.fromSeed`任せにしない** —
/// Material3のトーンパレット生成はseed色を彩度・明度ともにシフトするため、
/// タンジェリンの種のはずが実機ではくすんだ赤茶色の背景になり、以前ユーザーが
/// 明示的に却下した「おじさんくさい」配色に逆戻りしていた
/// (2026-09-01 実機確認で発覚、fromSeedの自動生成をやめて数値を直接指定する形に修正)。
/// IBM Plex Monoは変わらず全テキストへ適用する。
ThemeData _buildTheme(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  const accent = Color(0xFFD9591F);
  const ok = Color(0xFF4F8A6F);
  const err = Color(0xFFC9636B);
  final bg = isDark ? const Color(0xFF141414) : const Color(0xFFFBF8F5);
  final card = isDark ? const Color(0xFF1C1B19) : const Color(0xFFFFFFFF);
  final ink = isDark ? const Color(0xFFECE9E5) : const Color(0xFF211C18);
  final sub = isDark ? const Color(0xFF9B958A) : const Color(0xFF928B83);
  final line = isDark ? const Color(0xFF282623) : const Color(0xFFECE5DC);
  // モックアップの「配信中」ピル(薄橙背景+アクセント文字)。TTSタブの
  // 「読み上げ中」ハイライトもこの組で塗る。
  final primaryContainer = isDark ? accent.withValues(alpha: 0.22) : const Color(0xFFFDE9DF);

  final colorScheme = ColorScheme.fromSeed(seedColor: accent, brightness: brightness).copyWith(
    primary: accent,
    onPrimary: Colors.white,
    primaryContainer: primaryContainer,
    onPrimaryContainer: accent,
    secondary: accent,
    onSecondary: Colors.white,
    surface: bg,
    onSurface: ink,
    onSurfaceVariant: sub,
    outline: line,
    outlineVariant: line,
    error: err,
    onError: Colors.white,
    surfaceTint: Colors.transparent,
  );

  final textTheme =
      GoogleFonts.ibmPlexMonoTextTheme(ThemeData(brightness: brightness).textTheme)
          .apply(bodyColor: ink, displayColor: ink);

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: bg,
    textTheme: textTheme,
    primaryTextTheme: textTheme,
    appBarTheme: AppBarTheme(
      backgroundColor: bg,
      foregroundColor: ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
    ),
    cardTheme: CardThemeData(
      color: card,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(Radius.circular(16)),
        side: BorderSide(color: line),
      ),
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
    ),
    listTileTheme: ListTileThemeData(
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(14))),
      textColor: ink,
      iconColor: sub,
    ),
    chipTheme: ThemeData(brightness: brightness).chipTheme.copyWith(
          shape: const StadiumBorder(),
          backgroundColor: card,
          side: BorderSide(color: line),
          labelStyle: textTheme.labelMedium?.copyWith(color: sub),
        ),
    dividerTheme: DividerThemeData(color: line),
    switchTheme: SwitchThemeData(
      thumbColor: const WidgetStatePropertyAll(Colors.white),
      trackColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected) ? ok : line,
      ),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
    ),
    sliderTheme: SliderThemeData(
      activeTrackColor: accent,
      inactiveTrackColor: line,
      thumbColor: accent,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: accent,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
  );
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
        // バトル終了(またはEND後のスコア確定)をバトル履歴タブへ伝えるだけの通知。
        ChangeNotifierProvider(create: (_) => BattleActivityNotifier()),
      ],
      child: MaterialApp(
        title: 'LIVE Sidestage',
        theme: _buildTheme(Brightness.light),
        darkTheme: _buildTheme(Brightness.dark),
        // 詳細フィルタの日付・時刻ピッカー(showDatePicker/showTimePicker)を日本語表示にする。
        // アプリ本体は元々全画面日本語だが、ピッカーはこの設定が無いと英語表示になる。
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        supportedLocales: const [Locale('ja')],
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
