/// 画像URLとして受け入れてよい値か。
///
/// サーバー側で既にTikTokの画像CDNへ限定して返しているはずだが、
/// `Image.network` へそのまま渡る値なので https だけは端末側でも確かめる(多層防御)。
/// 欠落・不正な値は null として扱う。
String? parseImageUrl(Object? value) {
  if (value is! String || value.isEmpty) return null;
  final uri = Uri.tryParse(value);
  if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) return null;
  return value;
}
