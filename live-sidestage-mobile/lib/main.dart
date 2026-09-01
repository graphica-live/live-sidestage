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
import 'core/theme_mode_store.dart';
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

/// Mixer Console方向のブランドテーマ(2026-09、Card Deckから刷新)。
/// 配信を操る機材の筐体という世界観で、承認済みモック(`.impeccable/mocks/directions.html`)の
/// 実測トークンをそのまま使う: bg #E4E1DA / card #F4F2ED / ink #1A1D21 / sub #5B5F66 /
/// line #CFCBC0 / accent(LEDグリーン) #1F8F4E、暗所は bg #15171B / card #1D2024 /
/// ink #E8EAED / sub #9AA0A6 / line #2B2F35 / accent #35D07F。
/// **`ColorScheme.fromSeed`任せにしない**(Material3のトーンパレット生成がseed色を
/// 意図せずシフトする問題は2026-09-01の実機確認で既知のため、数値を直接指定する)。
/// フォントは見出し/ボタンにSpace Grotesk、本文にIBM Plex Sans、
/// ラベル/データ表示(コイン数・時刻等)にSpace Monoを使い分ける。
ThemeData _buildTheme(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  const accentLight = Color(0xFF1F8F4E);
  const accentDark = Color(0xFF35D07F);
  const amberLight = Color(0xFFFFB13C);
  const amberDark = Color(0xFFFFC15C);
  const errLight = Color(0xFFE24B4B);
  const errDark = Color(0xFFFF5C5C);
  final accent = isDark ? accentDark : accentLight;
  final amber = isDark ? amberDark : amberLight;
  final err = isDark ? errDark : errLight;
  final bg = isDark ? const Color(0xFF15171B) : const Color(0xFFE4E1DA);
  final card = isDark ? const Color(0xFF1D2024) : const Color(0xFFF4F2ED);
  final ink = isDark ? const Color(0xFFE8EAED) : const Color(0xFF1A1D21);
  final sub = isDark ? const Color(0xFF9AA0A6) : const Color(0xFF5B5F66);
  final line = isDark ? const Color(0xFF2B2F35) : const Color(0xFFCFCBC0);
  final onAccent = isDark ? const Color(0xFF0C0F10) : Colors.white;
  // モックアップの「配信中」ピル(薄いLEDグリーン背景+アクセント文字)。
  final primaryContainer = accent.withValues(alpha: isDark ? 0.22 : 0.14);

  final colorScheme = ColorScheme.fromSeed(seedColor: accent, brightness: brightness).copyWith(
    primary: accent,
    onPrimary: onAccent,
    primaryContainer: primaryContainer,
    onPrimaryContainer: accent,
    secondary: amber,
    onSecondary: const Color(0xFF241804),
    surface: bg,
    onSurface: ink,
    onSurfaceVariant: sub,
    outline: line,
    outlineVariant: line,
    error: err,
    onError: Colors.white,
    surfaceTint: Colors.transparent,
  );

  final base = ThemeData(brightness: brightness);
  final displayFont = GoogleFonts.spaceGroteskTextTheme(base.textTheme);
  final bodyFont = GoogleFonts.ibmPlexSansTextTheme(base.textTheme);
  final monoFont = GoogleFonts.spaceMonoTextTheme(base.textTheme);

  final textTheme = bodyFont
      .copyWith(
        displayLarge: displayFont.displayLarge,
        displayMedium: displayFont.displayMedium,
        displaySmall: displayFont.displaySmall,
        headlineLarge: displayFont.headlineLarge,
        headlineMedium: displayFont.headlineMedium,
        headlineSmall: displayFont.headlineSmall,
        titleLarge: displayFont.titleLarge?.copyWith(fontWeight: FontWeight.w700),
        titleMedium: displayFont.titleMedium?.copyWith(fontWeight: FontWeight.w700),
        titleSmall: displayFont.titleSmall?.copyWith(fontWeight: FontWeight.w700),
        labelLarge: monoFont.labelLarge,
        labelMedium: monoFont.labelMedium,
        labelSmall: monoFont.labelSmall,
      )
      .apply(bodyColor: ink, displayColor: ink);

  // 機材筐体らしい直線的な印象を出すため、Card Deck時代の14/16pxから縮小。
  const radius = 8.0;

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
      titleTextStyle: displayFont.titleLarge?.copyWith(color: ink, fontWeight: FontWeight.w800),
    ),
    cardTheme: CardThemeData(
      color: card,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radius),
        side: BorderSide(color: line),
      ),
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
    ),
    listTileTheme: ListTileThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
      textColor: ink,
      iconColor: sub,
    ),
    chipTheme: ThemeData(brightness: brightness).chipTheme.copyWith(
          shape: const StadiumBorder(),
          backgroundColor: card,
          side: BorderSide(color: line),
          labelStyle: monoFont.labelMedium?.copyWith(color: sub, fontWeight: FontWeight.w700),
        ),
    dividerTheme: DividerThemeData(color: line),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected) ? onAccent : Colors.white,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected) ? accent : line,
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
        foregroundColor: onAccent,
        textStyle: displayFont.titleMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: 0.2),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
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
        ChangeNotifierProvider(create: (_) => ThemeModeStore()..load()),
        // ギフト受信を貢献・ギフト履歴タブへ伝えるだけの通知。数値は持たない。
        ChangeNotifierProvider(create: (_) => GiftActivityNotifier()),
        // バトル終了(またはEND後のスコア確定)をバトル履歴タブへ伝えるだけの通知。
        ChangeNotifierProvider(create: (_) => BattleActivityNotifier()),
      ],
      child: Builder(
        builder: (context) {
          final themeMode = context.watch<ThemeModeStore>().themeMode;
          return MaterialApp(
            title: 'LIVE Sidestage',
            theme: _buildTheme(Brightness.light),
            darkTheme: _buildTheme(Brightness.dark),
            themeMode: themeMode,
            // 詳細フィルタの日付・時刻ピッカー(showDatePicker/showTimePicker)を日本語表示にする。
            // アプリ本体は元々全画面日本語だが、ピッカーはこの設定が無いと英語表示になる。
            localizationsDelegates: GlobalMaterialLocalizations.delegates,
            supportedLocales: const [Locale('ja')],
            home: const AuthGate(),
          );
        },
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
