import Flutter
import UIKit
import flutter_foreground_task

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // flutter_foreground_task は startCallback を headless の FlutterEngine
    // (allowHeadlessExecution: true) で動かす。そのエンジンにはプラグインが自動登録
    // されないので、登録手段をプラグインへ渡しておく必要がある。
    // これが無いと ForegroundTask.swift が
    // "Please register the registerPlugins function ..." を出して起動しない。
    //
    // 下の didInitializeImplicitFlutterEngine は UI 側(暗黙エンジン)の登録で、
    // こちらはバックグラウンドエンジン用。役割が別なので両方必要。
    SwiftFlutterForegroundTaskPlugin.setPluginRegistrantCallback { registry in
      GeneratedPluginRegistrant.register(with: registry)
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }
}
