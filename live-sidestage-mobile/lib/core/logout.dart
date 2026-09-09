import 'package:flutter/widgets.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:provider/provider.dart';

import 'session_controller.dart';
import 'session_storage.dart';

/// ログアウトの唯一の入口。
///
/// **画面ごとに手順を書かない。** 以前は設定タブだけが `onBeforeLogout`
/// (HomeScreen の `_stopService`) を経由し、オンボーディング画面とギフト音編集画面は
/// `SessionController.logout()` を直接呼んでいた。そのため、Foreground Service が
/// 稼働中にギフト音編集画面からログアウトすると、**サーバー側の失効とローカル
/// セッション消去のあとも、サービスが保持する token / refreshToken と socket 接続が
/// 残り続ける**（残った access token でコメントを受信し続け、失効後は残った
/// refresh token で勝手に再発行しに行く）。
///
/// 順序には意味がある:
///
///   1. Foreground Service を止める（socket 切断はサービス停止に伴って起きる）
///   2. サービス側の永続化データ(token / refreshToken)を消す
///   3. サーバーへ family revoke → ローカル [SessionStorage] 消去
///      （2番までを終えてから revoke する。逆順だと、失効させた直後の隙に
///        サービスがまだ生きていて再発行を試み、reuse 検知のノイズになる）
///
/// 画面遷移は不要 — `AuthGate` が `session == null` を検知して WelcomeScreen へ戻す。
Future<void> performLogout(BuildContext context) async {
  final controller = context.read<SessionController>();

  if (await FlutterForegroundTask.isRunningService) {
    await FlutterForegroundTask.stopService();
  }

  // サービスが起動していなくても消す（前回セッションの残骸を残さない）。
  await FlutterForegroundTask.removeData(key: foregroundTokenStorageKey);
  await FlutterForegroundTask.removeData(key: foregroundRefreshTokenStorageKey);

  await controller.logout();
}
