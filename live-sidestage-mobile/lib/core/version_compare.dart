/// "1.2.3" 形式のバージョン文字列を比較する。
///
/// pubspec.yaml の `version:`（例: `1.0.0+1`）と、サーバーの
/// `mobileMinSupportedVersion`（AppSetting、ビルド番号を持たない）を
/// 同じ形式で比較するため、`+build` の部分は無視する。
///
/// セクション数が揃っていなくても比較できる（"1.2" と "1.2.0" は等しい）。
/// 数値でないセクションは 0 として扱う（サーバー側の設定ミスで比較不能に
/// してアプリを止めないため）。
List<int> _parse(String version) {
  final core = version.split('+').first;
  return core.split('.').map((part) => int.tryParse(part) ?? 0).toList();
}

/// a < b なら負、a == b なら 0、a > b なら正。
int compareVersions(String a, String b) {
  final partsA = _parse(a);
  final partsB = _parse(b);
  final length = partsA.length > partsB.length ? partsA.length : partsB.length;
  for (var i = 0; i < length; i++) {
    final valueA = i < partsA.length ? partsA[i] : 0;
    final valueB = i < partsB.length ? partsB[i] : 0;
    if (valueA != valueB) return valueA - valueB;
  }
  return 0;
}

/// [current] が [minimum] 以上かどうか。
bool isVersionAtLeast(String current, String minimum) {
  return compareVersions(current, minimum) >= 0;
}
