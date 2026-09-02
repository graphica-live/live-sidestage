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
import 'core/apple_billing_service.dart';
import 'core/background_task_handler.dart';
import 'core/battle_activity.dart';
import 'core/battle_filter_store.dart';
import 'core/billing_service.dart';
import 'core/gift_activity.dart';
import 'core/gift_name_ja.dart';
import 'core/session_controller.dart';
import 'core/theme_mode_store.dart';
import 'core/version_compare.dart';
import 'screens/home_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/update_required_screen.dart';
import 'screens/welcome_screen.dart';
import 'screens/widgets/gradient_kit.dart';

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

/// 光彩(Kosai)ブランドテーマ(2026-09、Mixer Consoleから刷新)。
/// 「上品さ+高揚感」の世界観で、承認済みcomp(`.impeccable/approved/home-screen-kosai/`)の
/// 実測トークンをそのまま使う: bg #FAF7F5 / card #FFFFFF / ink #2A2130 / sub #7C7286 /
/// line #EFE6E9、暗所は bg #17151A / card #1F1B24 / ink #F1EDF5 / sub #A79FB0 /
/// line #332C3B。装飾グラデーション3色(コーラル #FF7A59 / バイオレット #9B6BFF /
/// ミント #2FC6A0)はライト/ダーク共通(`widgets/gradient_kit.dart`の`KosaiPalette`)。
/// primaryはグラデーションの中心色バイオレットを直接指定する。
/// **`ColorScheme.fromSeed`任せにしない**(Material3のトーンパレット生成がseed色を
/// 意図せずシフトする問題は2026-09-01の実機確認で既知のため、数値を直接指定する)。
/// フォントは見出し/ボタンにZen Maru Gothic、本文・ラベル/データ表示にZen Kaku Gothic Newを使う。
ThemeData buildAppTheme(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  const accent = Color(0xFF9B6BFF); // KosaiPalette.c2
  const amber = Color(0xFFFF7A59); // KosaiPalette.c1
  const errLight = Color(0xFFE24B4B);
  const errDark = Color(0xFFFF5C5C);
  final err = isDark ? errDark : errLight;
  final bg = isDark ? const Color(0xFF17151A) : const Color(0xFFFAF7F5);
  final card = isDark ? const Color(0xFF1F1B24) : const Color(0xFFFFFFFF);
  final ink = isDark ? const Color(0xFFF1EDF5) : const Color(0xFF2A2130);
  final sub = isDark ? const Color(0xFFA79FB0) : const Color(0xFF7C7286);
  final line = isDark ? const Color(0xFF332C3B) : const Color(0xFFEFE6E9);
  // スイッチOFF・スライダー非活性のトラック(comp `#E5DFE8`)。罫線より一段濃い。
  final track = isDark ? const Color(0xFF3D3547) : KosaiPalette.track;
  const onAccent = Colors.white;
  final primaryContainer = accent.withValues(alpha: isDark ? 0.22 : 0.12);

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
  final displayFont = GoogleFonts.zenMaruGothicTextTheme(base.textTheme);
  final bodyFont = GoogleFonts.zenKakuGothicNewTextTheme(base.textTheme);

  final textTheme = bodyFont
      .copyWith(
        displayLarge: displayFont.displayLarge?.copyWith(fontWeight: FontWeight.w700),
        displayMedium: displayFont.displayMedium?.copyWith(fontWeight: FontWeight.w700),
        displaySmall: displayFont.displaySmall?.copyWith(fontWeight: FontWeight.w700),
        headlineLarge: displayFont.headlineLarge?.copyWith(fontWeight: FontWeight.w700),
        headlineMedium: displayFont.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
        headlineSmall: displayFont.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
        titleLarge: displayFont.titleLarge?.copyWith(fontWeight: FontWeight.w700),
        titleMedium: displayFont.titleMedium?.copyWith(fontWeight: FontWeight.w700),
        titleSmall: displayFont.titleSmall?.copyWith(fontWeight: FontWeight.w700),
      )
      .apply(bodyColor: ink, displayColor: ink);

  // 白磁カード・chip/badge/medalの円形など、光彩は要素ごとに角丸を変える
  // (Mixer Console時代の8px単一スケールから移行)。カード類は18px、
  // chip/バッジ/メダル等の円形要素は999(StadiumBorder/BoxShape.circleで実質円)。
  const radius = 18.0;

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
          labelStyle: bodyFont.labelMedium?.copyWith(color: sub, fontWeight: FontWeight.w600),
        ),
    dividerTheme: DividerThemeData(color: line),
    switchTheme: SwitchThemeData(
      thumbColor: const WidgetStatePropertyAll(Colors.white),
      // OFFトラックは罫線(line)ではなく専用のtrack色(#E5DFE8)。罫線色だと
      // 白カードの上でスイッチが消える(comp `.switch` は明確に一段濃い)。
      trackColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected) ? accent : track,
      ),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
      trackOutlineWidth: const WidgetStatePropertyAll(0),
    ),
    sliderTheme: SliderThemeData(
      trackHeight: 5,
      activeTrackColor: accent,
      inactiveTrackColor: track,
      thumbColor: Colors.white,
      overlayColor: accent.withValues(alpha: 0.12),
      overlayShape: const RoundSliderOverlayShape(overlayRadius: 20),
      // comp `.mini-slider .thumb`: 白丸16dp + 2dpのc2枠。標準の
      // `RoundSliderThumbShape` は枠線を描けないので専用shapeを使う。
      thumbShape: const KosaiSliderThumbShape(),
      activeTickMarkColor: Colors.transparent,
      inactiveTickMarkColor: Colors.transparent,
      valueIndicatorColor: accent,
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
        ChangeNotifierProvider(create: (_) => BillingService()),
        ChangeNotifierProvider(create: (_) => AppleBillingService()),
        ChangeNotifierProvider(create: (_) => ThemeModeStore()..load()),
        // バトル履歴の表示フィルタ(小さいバトルを隠す)。背景Isolateへは同期しない。
        ChangeNotifierProvider(create: (_) => BattleFilterStore()..load()),
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
            theme: buildAppTheme(Brightness.light),
            darkTheme: buildAppTheme(Brightness.dark),
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

  // plan+mobileBetaActiveが変わった(初回取得含む)ときにだけFREE降格フォールバックを走らせる
  // ための直近適用済みキーの記録("$plan:$mobileBetaActive")。buildは何度も呼ばれるので、
  // これが無いと呼ぶたびに走ってしまう。mobileβのON/OFF切り替えでも再評価が必要なため、
  // plan文字列単体ではなくβ状態も含めたキーで比較する。
  String? _enforcedForPlan;

  // BillingServiceへ反映済みのtoken。userId不変のままJWTだけ更新された(無言リフレッシュ等)
  // 場合、init()自体は_requestedForUserId判定で再実行されないため、ここで別途追跡して
  // updateToken()へ渡す(実装後レビュー指摘、MEDIUM — 反映漏れのまま失効tokenで
  // 購入・復元を試みると401になる)。
  String? _syncedBillingToken;

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
          context.read<BillingService>().resetSession();
          context.read<AppleBillingService>().resetSession();
        });
      }
      return const WelcomeScreen();
    }

    if (_requestedForUserId != session.userId) {
      _requestedForUserId = session.userId;
      _syncedBillingToken = session.token;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        context.read<AccountStatusStore>().refresh(userId: session.userId, token: session.token);
        context.read<BillingService>().init(
              token: session.token,
              userId: session.userId,
              accountStatusStore: context.read<AccountStatusStore>(),
            );
        context.read<AppleBillingService>().init(
              token: session.token,
              userId: session.userId,
              accountStatusStore: context.read<AccountStatusStore>(),
            );
      });
    } else if (_syncedBillingToken != session.token) {
      _syncedBillingToken = session.token;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        context.read<BillingService>().updateToken(session.token);
        context.read<AppleBillingService>().updateToken(session.token);
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

    // isFallbackは通信断・タイムアウト・5xxでも立つ既定値で、サーバーが実際に
    // FREEと応答したわけではない。ここで強制リセットすると一時的な電波不良だけで
    // PRO/ULTRAユーザーの保存済みボイス設定が消える事故になる。
    //
    // fallback中は_enforcedForPlanを更新しない(実装後レビュー指摘、HIGH)。
    // fallback FREEのときに'FREE'を記録してしまうと、その後サーバーから正式な
    // FREE応答が届いても文字列としては同じ'FREE'なので判定に入らず、実際に
    // 降格すべきユーザーのボイス設定が野放しのまま残ってしまう。
    final enforceKey = '${accountStatus.status.plan}:${accountStatus.status.mobileBetaActive}';
    if (!accountStatus.status.isFallback && _enforcedForPlan != enforceKey) {
      _enforcedForPlan = enforceKey;
      // mobileβが有効な間は実プランがFREEでも降格しない(プラン自体は書き換えず、
      // βで機能制限だけを一時的にバイパスする設計)。
      if (accountStatus.status.plan == 'FREE' && !accountStatus.status.mobileBetaActive) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          context.read<AppConfigStore>().enforceFreePlanLimits();
        });
      }
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
