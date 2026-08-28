import 'package:package_info_plus/package_info_plus.dart';

/// 現在のアプリバージョン("1.2.3"形式、ビルド番号は含まない)。
///
/// main()の起動時に一度だけ設定する。設定前にAPIクライアントから参照された場合は
/// null(=ヘッダーを付けない)のまま進む — バージョン取得の失敗でリクエスト自体を
/// 止めたくないため。
///
/// **背景Isolate(flutter_foreground_task)からは参照できない**（Isolateごとに
/// メモリが独立しているため）。今回はUI Isolateからのリクエストへの付与のみを配管し、
/// 背景Isolateからのリクエスト(listener-status)への付与は対象外にしている。
class AppVersion {
  AppVersion._();

  static String? current;

  static Future<void> load() async {
    try {
      final info = await PackageInfo.fromPlatform();
      current = info.version;
    } catch (_) {
      // 取得できなくても起動は止めない。
      current = null;
    }
  }
}
