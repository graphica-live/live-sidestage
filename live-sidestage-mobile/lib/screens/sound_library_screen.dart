import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/app_config_store.dart';
import '../core/sound_library.dart';
import '../core/sound_player_pool.dart';
import '../models/app_config.dart';

class SoundLibraryScreen extends StatefulWidget {
  const SoundLibraryScreen({super.key});

  @override
  State<SoundLibraryScreen> createState() => _SoundLibraryScreenState();
}

class _SoundLibraryScreenState extends State<SoundLibraryScreen> {
  final SoundLibrary _library = SoundLibrary();
  final SoundPlayerPool _preview = SoundPlayerPool(size: 1);
  Directory? _soundsDir;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _library.soundsDirectory().then((dir) {
      if (mounted) setState(() => _soundsDir = dir);
    });
  }

  @override
  void dispose() {
    _preview.dispose();
    _library.dispose();
    super.dispose();
  }

  void _showError(Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$error')));
  }

  Future<void> _withBusy(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      _showError(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addLocal() async {
    final result = await FilePicker.platform.pickFiles(type: FileType.audio);
    final path = result?.files.single.path;
    if (path == null) return;
    final name = result!.files.single.name;

    await _withBusy(() async {
      final asset = await _library.importLocalFile(sourcePath: path, displayName: name);
      if (!mounted) return;
      await context.read<AppConfigStore>().updateSound(
            (c) => c.copyWith(assets: [...c.assets, asset]),
          );
    });
  }

  Future<void> _addRemote(SoundSourceKind source) async {
    final picked = await Navigator.of(context).push<RemoteSound>(
      MaterialPageRoute(builder: (_) => _RemoteSearchScreen(library: _library, source: source)),
    );
    if (picked == null) return;

    await _withBusy(() async {
      final asset = await _library.downloadRemote(sound: picked, source: source);
      if (!mounted) return;
      await context.read<AppConfigStore>().updateSound(
            (c) => c.copyWith(assets: [...c.assets, asset]),
          );
    });
  }

  Future<void> _delete(SoundAsset asset) async {
    final store = context.read<AppConfigStore>();
    final usedBy = store.sound.triggers.where((t) => t.soundIds.contains(asset.id)).length;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('音源を削除'),
        content: Text(
          usedBy > 0
              ? '「${asset.name}」を削除します。$usedBy件のトリガーから参照が外れます。'
              : '「${asset.name}」を削除します。',
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
    if (confirmed != true) return;

    await _withBusy(() async {
      // まず設定から参照を外し、背景Isolateが反映し終えてから実ファイルを消す。
      // 逆順にすると、再生中のファイルを消してしまう可能性がある。
      await store.updateSound((c) => c.copyWith(
            assets: c.assets.where((a) => a.id != asset.id).toList(),
            triggers: [
              for (final t in c.triggers)
                t.soundIds.contains(asset.id)
                    ? t.copyWith(soundIds: t.soundIds.where((id) => id != asset.id).toList())
                    : t,
            ],
          ));
      await store.waitForSync();
      await _library.deleteAsset(asset);
    });
  }

  Future<void> _play(SoundAsset asset) async {
    final dir = _soundsDir;
    if (dir == null) return;
    final path = _library.resolvePathSync(asset, dir);
    if (path == null) {
      _showError('音源ファイルが見つかりません: ${asset.fileName}');
      return;
    }
    try {
      await _preview.play(path, asset.volume / 100.0);
    } catch (e) {
      _showError('再生に失敗しました: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppConfigStore>();
    final assets = store.sound.assets;

    return Scaffold(
      appBar: AppBar(
        title: const Text('音源ライブラリ'),
        bottom: _busy ? const PreferredSize(preferredSize: Size.fromHeight(2), child: LinearProgressIndicator()) : null,
      ),
      body: assets.isEmpty
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  '音源がありません。\n右下の「追加」から取り込んでください。',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey),
                ),
              ),
            )
          : ListView.separated(
              padding: const EdgeInsets.only(bottom: 96),
              itemCount: assets.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final asset = assets[index];
                return ListTile(
                  leading: IconButton(
                    icon: const Icon(Icons.play_circle_outline),
                    tooltip: '試聴',
                    onPressed: () => _play(asset),
                  ),
                  title: Text(asset.name),
                  subtitle: Text('${_sourceLabel(asset.source)} / 音量 ${asset.volume}'),
                  trailing: PopupMenuButton<String>(
                    onSelected: (action) async {
                      if (action == 'volume') {
                        await _editVolume(asset);
                      } else if (action == 'delete') {
                        await _delete(asset);
                      }
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'volume', child: Text('音量を変更')),
                      PopupMenuItem(value: 'delete', child: Text('削除')),
                    ],
                  ),
                );
              },
            ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _busy ? null : _showAddMenu,
        icon: const Icon(Icons.add),
        label: const Text('追加'),
      ),
    );
  }

  Future<void> _editVolume(SoundAsset asset) async {
    var value = asset.volume.toDouble();
    final result = await showDialog<int>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(asset.name),
        content: StatefulBuilder(
          builder: (_, setDialogState) => Slider(
            value: value,
            max: 100,
            divisions: 20,
            label: '${value.round()}',
            onChanged: (v) => setDialogState(() => value = v),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(value.round()),
            child: const Text('保存'),
          ),
        ],
      ),
    );
    if (result == null || !mounted) return;
    await context.read<AppConfigStore>().updateSound((c) => c.copyWith(
          assets: [
            for (final a in c.assets) a.id == asset.id ? a.copyWith(volume: result) : a,
          ],
        ));
  }

  void _showAddMenu() {
    showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.folder_open),
              title: const Text('端末内の音声ファイル'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _addLocal();
              },
            ),
            ListTile(
              leading: const Icon(Icons.search),
              title: const Text('効果音ラボから検索'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _addRemote(SoundSourceKind.soundEffectLab);
              },
            ),
            ListTile(
              leading: const Icon(Icons.search),
              title: const Text('MyInstantsから検索'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _addRemote(SoundSourceKind.myInstants);
              },
            ),
          ],
        ),
      ),
    );
  }

  static String _sourceLabel(SoundSourceKind source) {
    switch (source) {
      case SoundSourceKind.local:
        return '端末内';
      case SoundSourceKind.soundEffectLab:
        return '効果音ラボ';
      case SoundSourceKind.myInstants:
        return 'MyInstants';
    }
  }
}

class _RemoteSearchScreen extends StatefulWidget {
  const _RemoteSearchScreen({required this.library, required this.source});

  final SoundLibrary library;
  final SoundSourceKind source;

  @override
  State<_RemoteSearchScreen> createState() => _RemoteSearchScreenState();
}

class _RemoteSearchScreenState extends State<_RemoteSearchScreen> {
  final TextEditingController _controller = TextEditingController();
  List<RemoteSound> _results = const [];
  bool _searching = false;
  String? _error;

  String get _title =>
      widget.source == SoundSourceKind.soundEffectLab ? '効果音ラボ' : 'MyInstants';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    setState(() {
      _searching = true;
      _error = null;
    });
    try {
      final results = widget.source == SoundSourceKind.soundEffectLab
          ? await widget.library.searchSoundEffectLab(_controller.text)
          : await widget.library.searchMyInstants(_controller.text);
      if (!mounted) return;
      setState(() => _results = results);
    } catch (e) {
      if (!mounted) return;
      // HTMLパースに依存しているのでサイト構造の変更で壊れうる。
      // 失敗はエラー表示に留め、アプリを落とさない。
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('$_titleから検索')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _controller,
              autofocus: true,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _search(),
              decoration: InputDecoration(
                labelText: 'キーワード',
                suffixIcon: IconButton(
                  icon: const Icon(Icons.search),
                  onPressed: _searching ? null : _search,
                ),
              ),
            ),
          ),
          if (_searching) const LinearProgressIndicator(),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 12)),
            ),
          Expanded(
            child: _results.isEmpty
                ? Center(
                    child: Text(
                      _searching ? '検索中…' : 'キーワードを入力して検索してください',
                      style: const TextStyle(color: Colors.grey),
                    ),
                  )
                : ListView.separated(
                    itemCount: _results.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final item = _results[index];
                      return ListTile(
                        title: Text(item.name),
                        trailing: const Icon(Icons.download),
                        onTap: () => Navigator.of(context).pop(item),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
