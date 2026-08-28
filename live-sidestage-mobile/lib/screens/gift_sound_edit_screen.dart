import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api_client.dart';
import '../core/app_config_store.dart';
import '../core/gift_name_ja.dart';
import '../core/session_controller.dart';
import '../core/sound_file_cleanup.dart';
import '../core/sound_library.dart';
import '../core/sound_preview.dart';
import '../models/app_config.dart';

/// 「ギフトを選んで、音を選ぶ」だけの編集画面。
///
/// [giftSoundId] を渡すと編集、渡さないと新規作成。
///
/// [setId] は**画面を開いたときのセット**を指す。「現在選択中のセット」を都度読み直しては
/// いけない — 編集中に選択が変わると、別のセットへ保存してしまう。
///
/// ## 音源ファイルのライフサイクル
///
/// 取り込みは「実ファイルを先に書く → 保存ボタンで設定へ入る」の順になるので、
/// 保存されないまま画面を抜けたファイルは誰からも参照されない。
/// この画面が自分で作ったファイルを [_ownedFileNames] で覚えておき、
///
/// - キャンセル / 戻る: 作ったファイルを全部消す
/// - 音を選び直した: 前に作ったファイルを消す
/// - 保存成功: 採用した1件を残し、それ以外（差し替え前の旧ファイル含む）を消す
/// - 保存失敗: 作ったファイルを全部消す（設定は変わっていない）
///
/// **設定に入ったファイルの削除は [deleteUnreferencedSoundFiles] に任せる。**
/// セット複製で1つの実ファイルを複数の [GiftSound] が参照しうるので、この行から
/// 外れただけでは消してよいと判断できない。まだ設定へ入っていない取り込みファイル
/// （[_ownedFileNames]）だけは他から参照されようがないので直接消してよい。
class GiftSoundEditScreen extends StatefulWidget {
  const GiftSoundEditScreen({super.key, required this.setId, this.giftSoundId});

  /// 編集対象のセット。画面を開いた時点で固定する。
  final String setId;

  final String? giftSoundId;

  @override
  State<GiftSoundEditScreen> createState() => _GiftSoundEditScreenState();
}

class _GiftSoundEditScreenState extends State<GiftSoundEditScreen> {
  final SoundLibrary _library = SoundLibrary();

  /// テスト再生はサービス（「開始」）に依存せず、この画面の中で鳴らす。
  late final SoundPreview _preview = SoundPreview(library: _library);

  late GiftSound _draft;

  /// 編集開始時点で参照していたファイル名。差し替えたら保存後に消す。
  String? _originalFileName;

  /// この画面が取り込んで、まだ保存されていないファイル。
  final List<String> _ownedFileNames = [];

  bool _exists = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final config = context.read<AppConfigStore>().sound;
    // 対象セット内だけを探す。セットごと消えていれば「削除されています」を出す。
    final set = config.sets.where((s) => s.id == widget.setId).firstOrNull;
    final existing = widget.giftSoundId == null
        ? null
        : set?.gifts.where((g) => g.id == widget.giftSoundId).firstOrNull;

    _exists = set != null && (existing != null || widget.giftSoundId == null);
    _draft = existing ?? GiftSound(id: GiftSound.newId(), giftName: '', fileName: '');
    _originalFileName = existing?.fileName;
  }

  @override
  void dispose() {
    // 先に止める。下で消すファイルを鳴らしている可能性がある。
    unawaited(_preview.dispose());
    // 保存されなかった取り込みファイルを片付ける。dispose 後に await できないので
    // 完了は待たない（失敗しても次回起動時の掃除で回収される）。
    for (final fileName in _ownedFileNames) {
      _library.deleteFile(fileName).catchError((_) {});
    }
    _library.dispose();
    super.dispose();
  }

  bool get _canSave => _draft.fileName.isNotEmpty && !_saving;

  // ── ギフトを選ぶ ────────────────────────────────────────────────────────────

  Future<void> _pickGift() async {
    final selected = await showModalBottomSheet<GiftCandidate>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _GiftPickerSheet(),
    );
    if (selected == null || !mounted) return;
    setState(() {
      _draft = _draft.copyWith(
        giftName: selected.name,
        giftLabel: selected.label,
        // 日本語名も一緒に控える。表示の本線は GiftNameJa のキャッシュだが、
        // それが空のとき（アプリのデータを消した直後など）の保険になる。
        // 日本語名の無いギフトを選び直したら前の日本語名は消す。
        giftLabelJa: selected.labelJa ?? '',
        // 画像の無いギフトを選び直したら前の絵は消す。
        giftImageUrl: selected.imageUrl,
      );
    });
  }

  // ── 音を選ぶ ────────────────────────────────────────────────────────────────

  Future<void> _pickSound() async {
    final choice = await showModalBottomSheet<_SoundSourceChoice>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.folder_open),
              title: const Text('端末内の音声ファイル'),
              onTap: () => Navigator.of(sheetContext).pop(_SoundSourceChoice.localFile),
            ),
            ListTile(
              leading: const Icon(Icons.search),
              title: const Text('効果音ラボから探す'),
              onTap: () => Navigator.of(sheetContext).pop(_SoundSourceChoice.soundEffectLab),
            ),
            ListTile(
              leading: const Icon(Icons.search),
              title: const Text('MyInstants から探す'),
              onTap: () => Navigator.of(sheetContext).pop(_SoundSourceChoice.myInstants),
            ),
          ],
        ),
      ),
    );
    if (choice == null || !mounted) return;

    switch (choice) {
      case _SoundSourceChoice.localFile:
        await _importLocalFile();
      case _SoundSourceChoice.soundEffectLab:
        await _importRemote(SoundSourceKind.soundEffectLab);
      case _SoundSourceChoice.myInstants:
        await _importRemote(SoundSourceKind.myInstants);
    }
  }

  Future<void> _importLocalFile() async {
    final result = await FilePicker.platform.pickFiles(type: FileType.audio);
    final path = result?.files.single.path;
    if (path == null || !mounted) return;

    await _runImport(() => _library.importLocalFile(
          sourcePath: path,
          displayName: result!.files.single.name,
        ));
  }

  Future<void> _importRemote(SoundSourceKind source) async {
    // 検索画面でも試聴するので、この画面で鳴っている音は先に止める。
    // 画面を重ねただけでは止まらない。
    await _preview.stop();
    if (!mounted) return;

    final picked = await Navigator.of(context).push<RemoteSound>(
      MaterialPageRoute(builder: (_) => _RemoteSearchScreen(library: _library, source: source)),
    );
    if (picked == null || !mounted) return;

    await _runImport(() => _library.downloadRemote(sound: picked, source: source));
  }

  Future<void> _runImport(Future<ImportedSound> Function() import) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final imported = await import();
      if (!mounted) {
        await _library.deleteFile(imported.fileName).catchError((_) {});
        return;
      }
      // 選び直した場合、直前に取り込んだファイルはもう誰も参照しないので消す。
      // 編集開始時から存在する _originalFileName はここでは消さない（保存後）。
      // テスト再生を止める。鳴っているのはこれから消すファイルかもしれない。
      // 完了は待たない（待つと setState までの間に画面が消えうる）。停止要求は同期的に
      // 効くので、この後に前の音源が鳴り始めることはない。
      unawaited(_preview.stop());
      final stale = List<String>.from(_ownedFileNames);
      _ownedFileNames
        ..clear()
        ..add(imported.fileName);
      for (final fileName in stale) {
        unawaited(_library.deleteFile(fileName));
      }

      setState(() {
        _draft = _draft.copyWith(
          fileName: imported.fileName,
          soundName: imported.soundName,
          source: imported.source,
          sourceUrl: imported.sourceUrl,
        );
        _saving = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _saving = false;
      });
    }
  }

  // ── テスト再生 ──────────────────────────────────────────────────────────────

  Future<void> _testPlay() async {
    final messenger = ScaffoldMessenger.of(context);
    if (_draft.fileName.isEmpty) {
      messenger.showSnackBar(const SnackBar(content: Text('音が選ばれていません')));
      return;
    }
    // 「開始」していなくても鳴らせるよう、サービスへ送らずこの画面で鳴らす。
    // 未保存の音源も鳴らせるよう、設定を経由せずファイル名を直接渡す。
    final error = await _preview.play(
      fileName: _draft.fileName,
      volume: _draft.volume,
      masterVolume: context.read<AppConfigStore>().sound.masterVolume,
    );
    if (error == null || !mounted) return;
    messenger.showSnackBar(SnackBar(content: Text(error)));
  }

  // ── 保存・削除 ──────────────────────────────────────────────────────────────

  Future<void> _save() async {
    final store = context.read<AppConfigStore>();
    final navigator = Navigator.of(context);
    setState(() {
      _saving = true;
      _error = null;
    });

    final next = _draft;
    try {
      // 画面を開いたときのセットへ書く。updateSet はセットが消えていれば投げるので、
      // 別のセットへ紛れ込むことはない。
      await store.updateSound((c) => c.updateSet(widget.setId, (gifts) {
            final exists = gifts.any((g) => g.id == next.id);
            return exists
                ? [for (final g in gifts) g.id == next.id ? next : g]
                : [...gifts, next];
          }));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '保存に失敗しました: $e';
        _saving = false;
      });
      return;
    }

    // 保存できたので、採用したファイルはもうこの画面の所有物ではない。
    _ownedFileNames.remove(next.fileName);

    // 差し替えた旧ファイルは、**他のセットから参照されていなければ**消す。
    // セット複製で同じファイルを共有していることがあるので、単純に消してはいけない。
    final replaced = _originalFileName;
    if (replaced != null && replaced != next.fileName) {
      unawaited(deleteUnreferencedSoundFiles(store, _library, [replaced]));
    }
    _originalFileName = next.fileName;

    if (!mounted) return;
    navigator.pop();
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('削除'),
        content: Text(
          '「${GiftNameJa.display(_draft.giftName, fallback: _draft.displayGiftName)}」の設定を削除します。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('削除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    final store = context.read<AppConfigStore>();
    final navigator = Navigator.of(context);
    final removedFileName = _draft.fileName;

    try {
      await store.updateSound(
        (c) => c.updateSet(widget.setId, (gifts) => gifts.where((g) => g.id != _draft.id).toList()),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '削除に失敗しました: $e');
      return;
    }

    // まず設定から参照を外し、背景 Isolate が反映し終えてから実ファイルを消す。
    // 逆順にすると、再生中のファイルを消してしまう可能性がある。
    await deleteUnreferencedSoundFiles(store, _library, [removedFileName]);
    _originalFileName = null;

    if (!mounted) return;
    navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    if (!_exists) {
      return Scaffold(
        appBar: AppBar(title: const Text('ギフトと音')),
        body: const Center(child: Text('この設定は削除されています')),
      );
    }

    return Scaffold(
      appBar: AppBar(
        // 入口のボタン（サウンドタブの「音を追加」）と同じ名前にする。
        title: Text(widget.giftSoundId == null ? '音を追加' : '編集'),
        actions: [
          if (widget.giftSoundId != null)
            IconButton(
              icon: const Icon(Icons.delete_outline),
              tooltip: '削除',
              onPressed: _saving ? null : _delete,
            ),
          TextButton(onPressed: _canSave ? _save : null, child: const Text('保存')),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          const _SectionHeader('ギフト'),
          ListTile(
            leading: GiftThumbnail(_draft.giftImageUrl),
            title: Text(GiftNameJa.display(_draft.giftName, fallback: _draft.displayGiftName)),
            subtitle: _draft.giftName.isEmpty
                ? const Text('どのギフトでも鳴ります')
                : null,
            trailing: const Icon(Icons.chevron_right),
            onTap: _saving ? null : _pickGift,
          ),
          const _SectionHeader('音'),
          ListTile(
            leading: const Icon(Icons.music_note),
            title: Text(_draft.fileName.isEmpty
                ? '音を選ぶ'
                : (_draft.soundName.isEmpty ? _draft.fileName : _draft.soundName)),
            subtitle: _draft.fileName.isEmpty ? null : Text(_sourceLabel(_draft.source)),
            trailing: const Icon(Icons.chevron_right),
            onTap: _saving ? null : _pickSound,
          ),
          if (_draft.fileName.isNotEmpty) ...[
            ListTile(
              title: const Text('音量'),
              subtitle: Slider(
                value: _draft.volume.toDouble(),
                max: 100,
                divisions: 20,
                label: '${_draft.volume}',
                onChanged: (value) =>
                    setState(() => _draft = _draft.copyWith(volume: value.round())),
              ),
              trailing: Text('${_draft.volume}'),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: OutlinedButton.icon(
                onPressed: _saving ? null : _testPlay,
                icon: const Icon(Icons.play_arrow),
                label: const Text('テスト再生'),
              ),
            ),
          ],
          if (_saving)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: LinearProgressIndicator(),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 13)),
            ),
        ],
      ),
    );
  }
}

String _sourceLabel(SoundSourceKind source) => switch (source) {
      SoundSourceKind.local => '端末内のファイル',
      SoundSourceKind.soundEffectLab => '効果音ラボ',
      SoundSourceKind.myInstants => 'MyInstants',
    };

enum _SoundSourceChoice { localFile, soundEffectLab, myInstants }

/// コイン数での絞り込み。
///
/// TikTokのギフトは価格帯でだいたい層が分かれる（1コインの連打ギフトと
/// 1000コイン超の大物では鳴らしたい音が違う）ので、数値入力ではなくレンジの
/// チップにする。キーボードを出さずに片手で切り替えられる。
///
/// 安い帯ほどギフトの種類が多く、ざっくりした区切りだと1つのチップに大半が
/// 残ってしまうので、下ほど刻みを細かくする。チップは横スクロールで並べる。
enum _CoinRange {
  all('すべて', 0, null),
  tier1('1〜9', 1, 9),
  tier2('10〜49', 10, 49),
  tier3('50〜99', 50, 99),
  tier4('100〜199', 100, 199),
  tier5('200〜499', 200, 499),
  tier6('500〜999', 500, 999),
  tier7('1000〜4999', 1000, 4999),
  tier8('5000〜9999', 5000, 9999),
  tier9('10000以上', 10000, null);

  const _CoinRange(this.label, this.min, this.max);

  final String label;
  final int min;

  /// null は上限なし。
  final int? max;

  /// 候補のコイン数範囲と重なれば通す。同名で価格の違うギフト
  /// （`freestyle` の 1c と 1800c）はどちらの帯でも見つかってほしい。
  bool matches(GiftCandidate gift) => gift.overlapsCoins(min, max);
}

/// ギフト候補が検索文字列に一致するか。
///
/// 一覧は日本語で表示しているので、日本語で引けないと探せない。一方、一致キーである
/// 英語名（`name`）とサーバーが返す元表記（`label`）でも従来どおり引けるようにしておく。
/// 大文字小文字は区別しない。[query] が空なら全件一致。
///
/// ピッカー本体から切り離してあるのは、Widget を組み立てずにテストできるようにするため。
bool matchesGiftQuery(GiftCandidate gift, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return true;
  if (gift.name.toLowerCase().contains(q)) return true;
  if (gift.label.toLowerCase().contains(q)) return true;
  return giftDisplayName(gift).toLowerCase().contains(q);
}

/// 表示させたくないギフトの名前ブロックリスト。
///
/// TikTok の gift API には「このギフトを隠すべきか」を示すフィールドが無い
/// （`giftType` はコンボ可否判定にのみ使われている）ため、名前ベースの部分一致で弾く。
const Set<String> _blockedGiftNameKeywords = {
  'セックス',
  'ちたんたん',
  'ちんこ',
  'ちんぽ',
  'ポコチン',
  'まんこ',
  'アナル',
};

/// カタカナをひらがなへ寄せる。ブロック判定をひらがな・カタカナ問わず効かせるために使う
/// （全角カタカナ ァ〜ヶ とひらがなは同じ並びで 0x60 ずれているだけなので引き算で変換できる）。
String _toHiragana(String s) {
  final buffer = StringBuffer();
  for (final rune in s.runes) {
    buffer.writeCharCode(rune >= 0x30A1 && rune <= 0x30F6 ? rune - 0x60 : rune);
  }
  return buffer.toString();
}

/// [gift] がブロックワードに一致するか。一覧にも検索結果にも出さない。
bool isBlockedGift(GiftCandidate gift, {Set<String> blockedKeywords = _blockedGiftNameKeywords}) {
  if (blockedKeywords.isEmpty) return false;
  final haystacks = <String>[
    gift.name,
    gift.label,
    if (gift.labelJa != null) gift.labelJa!,
  ].map((s) => _toHiragana(s.toLowerCase()));
  final needles = blockedKeywords.map((w) => _toHiragana(w.toLowerCase()));
  return needles.any((word) => haystacks.any((h) => h.contains(word)));
}

/// 候補をピッカーに出すときの表示名。
///
/// 端末に貯めた日本語名 → サーバーが今回返した `labelJa` → 元表記（英語）の順。
/// 貯めたぶんを先に見るのは、[GiftNameJa] のキーが正規化済みで表記ゆれに強いため。
/// `labelJa` を fallback に置くことで、キャッシュがまだ空の初回表示でも日本語で出る。
String giftDisplayName(GiftCandidate gift) {
  return GiftNameJa.display(gift.name, fallback: gift.labelJa ?? gift.label);
}

/// かな・カタカナ・漢字を含むか。**自由入力の注意表示にだけ使う。**
///
/// 一覧が日本語表示になったぶん、ユーザーは日本語で登録しようとしやすい。一致キーは
/// TikTok が送ってくる名前なので、普通のギフトを日本語で登録すると無言で鳴らなくなる。
/// ただし配信者ごとのサブスクギフトは TikTok 自身が日本語名で送ってくるため、
/// 日本語の一致キーが正しいケースが実在する。だから**判定するのは文言だけで、登録は止めない**。
bool looksJapanese(String text) => _japaneseChars.hasMatch(text);

final RegExp _japaneseChars = RegExp(r'[぀-ヿ一-鿿ｦ-ﾝ]');

/// ギフト候補のピッカー。
///
/// 一覧はサーバーが返す「TikTokの全ギフトカタログ ∪ 自分の部屋が最近受け取ったギフト」。
/// カタログも網羅ではない（部屋限定ギフト、まだ取得できていない新ギフト）ので、
/// **入力した文字列をそのまま使う導線を常に残す**（0件のときだけ、エラーのときだけ、
/// という出し分けでは足りない）。
///
/// 検索は入力のたびにローカルで絞り込む。候補は最大1000件で `ListView.builder` は
/// 遅延生成なので、キーストロークごとにサーバーへ問い合わせ直す理由が無い。
/// ギフト候補を取りに行く。401 のときだけトークンを取り直して**1回だけ**やり直す。
///
/// JWT は90日で失効するのに、常用のコメント受信は socket.io の apiKey なので
/// 失効しても画面上はログイン済みのまま見える。JWT を使う数少ない導線である
/// この一覧だけが 401 になるため、ここで無言の再発行を挟む。
/// 再発行できない（＝ Google の無言サインインが通らない）ときだけ、
/// 従来どおり「ログインし直す」導線を出す。
///
/// Widget を組み立てずにテストできるよう、ピッカー本体から切り離してある。
Future<List<GiftCandidate>> fetchGiftCandidatesWithRefresh({
  required LiveAnalyticsApi api,
  required String token,
  required Future<String?> Function() refreshToken,
}) async {
  try {
    return await api.fetchGiftCandidates(token: token);
  } on ApiException catch (e) {
    if (!e.isUnauthorized) rethrow;
    final refreshed = await refreshToken();
    if (refreshed == null) rethrow;
    return api.fetchGiftCandidates(token: refreshed);
  }
}

class _GiftPickerSheet extends StatefulWidget {
  const _GiftPickerSheet();

  @override
  State<_GiftPickerSheet> createState() => _GiftPickerSheetState();
}

class _GiftPickerSheetState extends State<_GiftPickerSheet> {
  final TextEditingController _searchController = TextEditingController();
  final LiveAnalyticsApi _api = LiveAnalyticsApi();

  List<GiftCandidate>? _candidates;
  String? _error;
  bool _needsRelogin = false;
  _CoinRange _coinRange = _CoinRange.all;
  bool _coinRangeAscending = true;

  @override
  void initState() {
    super.initState();
    // 入力のたびに絞り込みを描き直す。autofocus はしない――未入力で全件を
    // 見たいときにキーボードが一覧を半分隠してしまうため。
    _searchController.addListener(() => setState(() {}));
    _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String get _query => _searchController.text.trim();

  List<GiftCandidate> get _filtered {
    final all = _candidates ?? const <GiftCandidate>[];
    final query = _query;
    final list = all
        .where(_coinRange.matches)
        .where((g) => !isBlockedGift(g))
        .where((g) => matchesGiftQuery(g, query))
        .toList();
    list.sort((a, b) => _coinRangeAscending
        ? a.minDiamondCount.compareTo(b.minDiamondCount)
        : b.minDiamondCount.compareTo(a.minDiamondCount));
    return list;
  }

  void _pick(GiftCandidate gift) => Navigator.of(context).pop(gift);

  /// 一覧に無いギフト名として、入力文字列をそのまま採用する。
  ///
  /// 一致キーは TikTok が送ってくる英語名でないと鳴らない。日本語から英語名を
  /// 逆引きすることはしない――辞書のキーは正規化済み（アポストロフィ統一・空白畳み込み）だが、
  /// 鳴らす側の照合は `trim` + `toLowerCase` だけなので、逆引き結果を保存すると
  /// 表記の違うギフトで鳴らなくなる。日本語は候補の検索にだけ使う。
  void _useQueryAsIs() {
    final raw = _query;
    if (raw.isEmpty) return;
    _pick(GiftCandidate.single(name: raw.toLowerCase(), label: raw, diamondCount: 0));
  }

  Future<void> _load() async {
    // 毎回 SessionController から取り直す。トークンを widget に固定すると、
    // 再発行しても古い値のままになる。
    final sessions = context.read<SessionController>();
    final token = sessions.session?.token;
    if (token == null) {
      setState(() {
        _error = 'ログイン情報がありません。';
        _needsRelogin = true;
      });
      return;
    }
    setState(() {
      _error = null;
      _needsRelogin = false;
      _candidates = null;
    });
    try {
      final gifts = await fetchGiftCandidatesWithRefresh(
        api: _api,
        token: token,
        refreshToken: sessions.refreshToken,
      );
      if (!mounted) return;
      setState(() => _candidates = gifts);
      // 取れた日本語名を端末へ貯める。**保存済みの効果音設定の表示にも効く**ので、
      // ピッカーを開くこと自体が「一覧の日本語化」の更新手段になっている。
      // 1件も日本語名が無ければ updateFromServer 側が何もしない（既存を空で潰さない）。
      await GiftNameJa.updateFromServer(giftLabelJaMap(gifts));
      if (!mounted) return;
      setState(() {}); // 貯めた日本語名で行タイトルを描き直す
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        // 401/403 を黙って手入力へフォールバックさせない。セッションが切れている
        // ことをそのまま伝えないと、ユーザーは原因の分からないまま使い続ける。
        // ここへ来るのはトークンの再発行にも失敗したときだけ。
        _needsRelogin = e.isUnauthorized;
        _error = e.isUnauthorized ? 'ログインの有効期限が切れています。ログインし直してください。' : e.message;
        _candidates = const [];
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final filtered = _filtered;
    final query = _query;

    // 完全一致が一覧に出ていないときだけ「そのまま使う」を出す。出ているなら
    // その行をタップすればよく、同じ意味の導線を2つ並べても迷わせるだけ。
    final showRawEntry = query.isNotEmpty && !filtered.any((g) => g.name == query.toLowerCase());

    return Padding(
      padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
      child: ConstrainedBox(
        // キーボードの高さを引いてから割合を取る。固定高にすると入力中に
        // 画面からはみ出す。
        constraints: BoxConstraints(
          maxHeight: (media.size.height - media.viewInsets.bottom) * 0.85,
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Text('ギフトを選ぶ', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: TextField(
                  controller: _searchController,
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    labelText: 'ギフト名で検索',
                    helperText: '日本語名・英語名どちらでも。未入力なら全件',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: query.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.clear),
                            tooltip: 'クリア',
                            onPressed: _searchController.clear,
                          ),
                  ),
                  onSubmitted: (_) {
                    // 1件に絞れているならそれを採用。絞れないなら入力そのまま。
                    if (filtered.length == 1) {
                      _pick(filtered.single);
                    } else if (showRawEntry) {
                      _useQueryAsIs();
                    }
                  },
                ),
              ),
              const SizedBox(height: 12),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    for (final range in _CoinRange.values) ...[
                      ChoiceChip(
                        label: Text(range.label),
                        selected: _coinRange == range,
                        // 同じ帯をもう一度選んだら昇順/降順を反転。違う帯を選んだら昇順に戻す。
                        onSelected: (_) => setState(() {
                          if (_coinRange == range) {
                            _coinRangeAscending = !_coinRangeAscending;
                          } else {
                            _coinRange = range;
                            _coinRangeAscending = true;
                          }
                        }),
                      ),
                      const SizedBox(width: 8),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 8),
              // 絞り込んでいる最中に出すと選択肢として紛らわしいので、
              // 素の状態のときだけ見せる。
              if (query.isEmpty && _coinRange == _CoinRange.all)
                ListTile(
                  leading: const Icon(Icons.all_inclusive),
                  title: const Text('すべてのギフト'),
                  subtitle: const Text('どのギフトが来ても鳴らす'),
                  onTap: () => _pick(const GiftCandidate.single(name: '', label: '', diamondCount: 0)),
                ),
              if (showRawEntry)
                ListTile(
                  leading: Icon(
                    Icons.edit_outlined,
                    color: looksJapanese(query) ? Theme.of(context).colorScheme.error : null,
                  ),
                  title: Text('「$query」を使う'),
                  // 鳴らすときの照合は TikTok が送ってくる英語名で行う。日本語で
                  // 登録しても普通は一致しないので、その場合だけ強めに注意する。
                  //
                  // **禁止はしない。** 配信者ごとのサブスクギフトは日本語名そのものが
                  // TikTok から届くので（例:「わやハグ」）、日本語の一致キーが正しい
                  // ケースが実在する。一覧に無いそれを登録できる導線はここだけ。
                  subtitle: Text(
                    looksJapanese(query)
                        ? '一覧から選ぶのがおすすめです。日本語で登録して鳴るのは、'
                            'この配信者だけのギフトのように TikTok が日本語名で送ってくるものだけです'
                        : '一覧にないギフト名として登録（TikTokの英語名で入力してください）',
                    style: looksJapanese(query)
                        ? TextStyle(color: Theme.of(context).colorScheme.error)
                        : null,
                  ),
                  onTap: _useQueryAsIs,
                ),
              const Divider(height: 1),
              Flexible(child: _buildList(filtered)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildList(List<GiftCandidate> filtered) {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              if (_needsRelogin)
                // ログイン切れは再試行しても直らない。ログアウトすると AuthGate が
                // WelcomeScreen へ差し替えるので、このシートは開いたままでよい。
                ElevatedButton.icon(
                  onPressed: () => context.read<SessionController>().logout(),
                  icon: const Icon(Icons.logout),
                  label: const Text('ログインし直す'),
                )
              else
                OutlinedButton.icon(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh),
                  label: const Text('再試行'),
                ),
            ],
          ),
        ),
      );
    }

    final candidates = _candidates;
    if (candidates == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (candidates.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'ギフトの一覧をまだ取得できていません。\n上の入力欄にギフト名を直接入力できます。',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey),
          ),
        ),
      );
    }
    if (filtered.isEmpty) {
      // 候補はあるが絞り込みに掛からなかった。「履歴が無い」と混同させない。
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                '条件に合うギフトがありません',
                style: TextStyle(color: Colors.grey),
              ),
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: () => setState(() {
                  _searchController.clear();
                  _coinRange = _CoinRange.all;
                  _coinRangeAscending = true;
                }),
                icon: const Icon(Icons.filter_alt_off_outlined),
                label: const Text('絞り込みを解除'),
              ),
            ],
          ),
        ),
      );
    }

    final primary = Theme.of(context).colorScheme.primary;

    return ListView.builder(
      itemCount: filtered.length,
      itemBuilder: (_, index) {
        final gift = filtered[index];
        final displayName = giftDisplayName(gift);
        // 日本語名を出したときだけ英語名を添える（同じなら二度書かない）。
        // 配信画面や他ツールでは英語名で出ることがあるので、対応を隠さない。
        final coinLabel = _coinLabel(gift);
        final details = [
          if (displayName != gift.label) gift.label,
          ?coinLabel,
        ];
        return ListTile(
          dense: true,
          // 名前の左はギフトの絵。画像が無くても行がずれないよう幅は固定する。
          leading: GiftThumbnail(gift.imageUrl),
          title: Text(displayName),
          subtitle: details.isEmpty ? null : Text(details.join(' · ')),
          // 受信済みの印。leading を画像に譲ったのでこちら側へ出す。
          trailing: gift.seen
              ? Icon(Icons.check_circle, size: 18, color: primary, semanticLabel: '受信したことがある')
              : null,
          onTap: () => _pick(gift),
        );
      },
    );
  }

  /// 同名で価格の違うギフトがある場合は範囲で見せる。上限だけを出すと
  /// 「大物ギフト用」に仕込んだ音が安い方でも鳴ることが伝わらない。
  String? _coinLabel(GiftCandidate gift) {
    if (gift.maxDiamondCount <= 0) return null;
    if (!gift.hasCoinRange) return '${gift.maxDiamondCount}コイン';
    return '${gift.minDiamondCount}〜${gift.maxDiamondCount}コイン';
  }
}

/// ギフトのアイコン。
///
/// 一覧は最大1000件あるが `ListView.builder` は可視行しか組み立てないので、同時に走る
/// 取得は画面に見えている数行分だけで済む。`cacheWidth` を実表示幅に合わせてデコードを
/// 縮め、Flutter 既定の `ImageCache` に収まるようにしている（追加パッケージは要らない）。
///
/// URL が無い・読み込み中・失敗のいずれも同じプレースホルダに落とす。ここで空白を返すと
/// スクロール中に行の見た目が点滅する。
class GiftThumbnail extends StatelessWidget {
  const GiftThumbnail(this.imageUrl, {super.key});

  final String? imageUrl;

  static const double _size = 36;

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    final placeholder = Icon(
      Icons.card_giftcard,
      size: 20,
      color: Theme.of(context).disabledColor,
    );

    return SizedBox(
      width: _size,
      height: _size,
      child: url == null
          ? placeholder
          : Image.network(
              url,
              // ギフトの絵は正方形とは限らない。引き伸ばさず収める。
              fit: BoxFit.contain,
              cacheWidth: (_size * MediaQuery.of(context).devicePixelRatio).round(),
              errorBuilder: (_, _, _) => placeholder,
              frameBuilder: (_, child, frame, wasSynchronouslyLoaded) =>
                  wasSynchronouslyLoaded || frame != null ? child : placeholder,
            ),
    );
  }
}

/// 効果音ラボ / MyInstants の検索画面。
class _RemoteSearchScreen extends StatefulWidget {
  const _RemoteSearchScreen({required this.library, required this.source});

  final SoundLibrary library;
  final SoundSourceKind source;

  @override
  State<_RemoteSearchScreen> createState() => _RemoteSearchScreenState();
}

class _RemoteSearchScreenState extends State<_RemoteSearchScreen> {
  final TextEditingController _controller = TextEditingController();

  /// 試聴はこの画面の中で完結させる。編集画面の [SoundPreview] とは別インスタンスで、
  /// この画面を閉じたら止まる。`library` は編集画面の所有物なのでここでは dispose しない。
  late final SoundPreview _preview = SoundPreview(library: widget.library);

  List<RemoteSound>? _results;
  bool _searching = false;
  String? _error;

  /// 取得中の1件。行の index ではなく実体で持つ（検索し直すと index はずれる）。
  RemoteSound? _preparing;

  /// 試聴要求の世代。[SoundPreview] 側の世代は「古い音を鳴らさない」ためのもので、
  /// この画面の表示は守らない。await から戻ったとき自分がまだ最新か判定する。
  int _previewRequest = 0;

  /// 検索と試聴は同時に走らせない。片方だけ止めても、
  /// 「検索中に古い行の試聴を押す」で結果に無い音が鳴る。
  bool get _busy => _searching || _preparing != null;

  @override
  void dispose() {
    _controller.dispose();
    // 完了は待てない。停止要求は同期的に効くので、この後に鳴り始めることはない。
    unawaited(_preview.dispose());
    super.dispose();
  }

  /// 検索結果を取り込まずに鳴らす。
  ///
  /// 取得している間は**全部の行の**再生ボタンを止める。連打を許すと、鳴らさずに捨てる
  /// だけのダウンロードが端末の回線と配布元サイトへ積み上がる。
  Future<void> _playPreview(RemoteSound sound) async {
    final messenger = ScaffoldMessenger.of(context);
    final masterVolume = context.read<AppConfigStore>().sound.masterVolume;

    final request = ++_previewRequest;
    setState(() => _preparing = sound);

    final error = await _preview.playRemote(
      sound: sound,
      source: widget.source,
      masterVolume: masterVolume,
    );

    // 検索し直した / 別の音を押した後なら、この結果はもう表示先が無い。
    if (!mounted || request != _previewRequest) return;
    setState(() => _preparing = null);
    if (error != null) messenger.showSnackBar(SnackBar(content: Text(error)));
  }

  /// 配布元サイトを外部ブラウザで開く。
  ///
  /// アプリ内の検索は検索結果ページから拾えた分しか出せず、カテゴリ一覧・試聴・
  /// 利用条件はサイト側にしか無い。入力中のキーワードがあればその検索結果へ直接飛ばす。
  Future<void> _openSite() async {
    final uri = SoundLibrary.sitePageUri(widget.source, query: _controller.text);
    var opened = false;
    try {
      // ブラウザへ渡す。アプリ内 WebView にはしない(サイト側のログインや
      // ダウンロードをアプリが抱え込む必要はない)。
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
    if (opened || !mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$uri を開けませんでした。')),
    );
  }

  Future<void> _search() async {
    // 検索ボタンは押せない状態でも、キーボードの確定（onSubmitted）は飛んでくる。
    // 走らせると新旧の結果が入れ替わりうる。
    if (_busy) return;
    final query = _controller.text.trim();
    if (query.isEmpty) return;

    // 結果が入れ替わると、試聴中の行はもう表示に残らない。
    _previewRequest++;
    unawaited(_preview.stop());

    setState(() {
      _searching = true;
      _error = null;
      _preparing = null;
    });
    try {
      final results = widget.source == SoundSourceKind.soundEffectLab
          ? await widget.library.searchSoundEffectLab(query)
          : await widget.library.searchMyInstants(query);
      if (!mounted) return;
      setState(() {
        _results = results;
        _searching = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        // 直前の検索結果を残すと、エラー文と噛み合わない一覧が
        // 新しいキーワードの結果に見えてしまう。
        _results = null;
        _searching = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final results = _results;
    final siteHost = SoundLibrary.sitePageUri(widget.source).host;

    return Scaffold(
      appBar: AppBar(title: Text(_sourceLabel(widget.source))),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    autofocus: true,
                    decoration: InputDecoration(
                      labelText: 'キーワード',
                      // MyInstants は短いキーワードをサイト側が0件で返す。
                      // 押してから怒られるより先に出しておく。
                      helperText: widget.source == SoundSourceKind.myInstants
                          ? '${SoundLibrary.myInstantsMinQueryLength}文字以上'
                          : null,
                    ),
                    onSubmitted: (_) => _search(),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(onPressed: _busy ? null : _search, child: const Text('検索')),
              ],
            ),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 16, 8),
              child: TextButton.icon(
                onPressed: _openSite,
                icon: const Icon(Icons.open_in_new, size: 18),
                label: Text('$siteHost を開く'),
              ),
            ),
          ),
          if (_searching) const LinearProgressIndicator(),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 13)),
            ),
          if (results != null && results.isEmpty && !_searching)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text('見つかりませんでした', style: TextStyle(color: Colors.grey)),
            ),
          if (results != null)
            Expanded(
              child: ListView.builder(
                itemCount: results.length,
                itemBuilder: (_, index) {
                  final sound = results[index];
                  return ListTile(
                    dense: true,
                    title: Text(sound.name),
                    // 行そのものは従来どおり「取り込む」。試聴はその左のボタンだけで、
                    // 押しても取り込まない。
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox.square(
                          dimension: 40,
                          child: identical(_preparing, sound)
                              ? const Padding(
                                  padding: EdgeInsets.all(10),
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : IconButton(
                                  icon: const Icon(Icons.play_arrow),
                                  tooltip: '試聴',
                                  padding: EdgeInsets.zero,
                                  onPressed: _busy ? null : () => _playPreview(sound),
                                ),
                        ),
                        const SizedBox(width: 4),
                        const Icon(Icons.download),
                      ],
                    ),
                    onTap: () {
                      // 取り込みは編集画面が行う。鳴っている試聴は閉じる前に止める。
                      unawaited(_preview.stop());
                      Navigator.of(context).pop(sound);
                    },
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.bold,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}
