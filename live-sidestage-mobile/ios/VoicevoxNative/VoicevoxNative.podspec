#
# VOICEVOX のネイティブライブラリを Runner.app へ埋め込むためのローカル pod。
#
# voicevox_core パッケージ(pub) は Flutter プラグインではなく純粋な Dart FFI なので、
# ネイティブバイナリを運んでくる仕組みを持たない。Android は jniLibs へ直接置いているが、
# iOS では framework を Embed & Sign する必要があるため、その工程を CocoaPods に任せる。
#
# xcframework は加工せずそのまま置くこと。スライスの選択(実機/シミュレータ)は Xcode が行うので、
# lipo で削ったりすると将来 Apple Developer 登録して実機へ進むときに手戻りになる。
#
# voicevox_core は @rpath/voicevox_onnxruntime.framework/voicevox_onnxruntime を直接リンク
# しているため、onnxruntime 側も必ず同梱する。片方だけだと dlopen した時点で dyld が解決に失敗する。
#
# 【上流の不備に対する修正】
# VOICEVOX/onnxruntime-builder の voicevox_onnxruntime 1.17.3 は、Info.plist の
# CFBundleIdentifier が `jp.hiroshiba.voicevox.voicevox_onnxruntime` とアンダースコアを
# 含んでおり、Xcode の埋め込み検証で "had an invalid CFBundleIdentifier" として弾かれる
# (使えるのは英数字・ハイフン・ピリオドのみ)。voicevox_core 側は `voicevox-core` と
# 正しくハイフンなので、onnxruntime 側だけの付け忘れと思われる。
# そのため ios-arm64 と ios-arm64_x86_64-simulator の2スライスの Info.plist を
# `jp.hiroshiba.voicevox.voicevox-onnxruntime` へ書き換えてある。
# 変更したのは CFBundleIdentifier の1キーのみで、Mach-O バイナリ・スライス構成・
# Modules・install name には触れていない(framework に _CodeSignature は無く、
# Info.plist は署名対象外なので既存署名も壊れない)。
# xcframework を差し替えると修正が失われるが、Podfile の post_install に置いた
# ガードが pod install の時点で検知する。上流が修正済みの版なら書き換えは不要。
#
Pod::Spec.new do |s|
  s.name     = 'VoicevoxNative'
  s.version  = '0.17.0'
  s.summary  = 'Prebuilt VOICEVOX core and onnxruntime xcframeworks'
  s.homepage = 'https://github.com/VOICEVOX/voicevox_core'
  s.license  = { :type => 'MIT' }
  s.author   = 'VOICEVOX'
  s.source   = { :path => '.' }
  s.platform = :ios, '15.0'
  s.vendored_frameworks = ['voicevox_core.xcframework', 'voicevox_onnxruntime.xcframework']
end
