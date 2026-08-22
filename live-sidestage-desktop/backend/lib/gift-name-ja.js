'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// TikTok LIVE ギフト名（英語）→日本語表示名の辞書。
//
// データはモノレポの共通資産 shared/gift-names/gift-names-ja.json が正本で、
// ここが読むのは shared/gift-names/sync.mjs が配った生成コピー。
// パッケージ版（asar 内）にはリポジトリの shared/ が入らないので、
// アプリに同梱できる backend/lib/gift-names/ 配下のコピーを参照する。
// **コピーは生成物。直接編集しない**（次の sync で上書きされる）。
//
// 未収録のギフトは元の名前をそのまま返す（表示が空になったり壊れたりしないため）。
// マッチング用の値（trigger.giftName 等）には使わないこと。あくまで表示専用。
//
// 対訳の追加ルール・正規化仕様は shared/gift-names/README.md を参照。

const BUNDLED_DICTIONARY_PATH = path.join(__dirname, 'gift-names', 'gift-names-ja.json');
// リポジトリ内で動いているときだけ存在する正本。パッケージ版では見つからない。
const SHARED_DICTIONARY_PATH = path.resolve(__dirname, '..', '..', '..', 'shared', 'gift-names', 'gift-names-ja.json');
const SYNC_SCRIPT_PATH = path.resolve(__dirname, '..', '..', '..', 'shared', 'gift-names', 'sync.mjs');

// 辞書を引くためのキー正規化。shared/gift-names/README.md の「正規化仕様」と同じ規則で、
// 同じ順序の実装が shared/gift-names/sync.mjs と
// live-sidestage-mobile/lib/core/gift_name_ja.dart にもある。変えるときは3箇所そろえること。
// TikTok から届く名前は "Adam’s Dream"（カーリー）と "It's Match Time"（ASCII）が
// 混在するので、アポストロフィを統一しないと同じギフトを引けないことがある。
const APOSTROPHES = /[‘’ʼ´`]/gu;
const WHITESPACE = /[\s　]+/gu;

function normalizeGiftNameKey(name) {
    return String(name || '')
        .replace(APOSTROPHES, "'")
        .replace(WHITESPACE, ' ')
        .trim()
        .toLowerCase();
}

function readDictionaryFile(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
        version: parsed.version ?? 1,
        normalization: parsed.normalization ?? '',
        entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {}
    };
}

// 呼び出し元が module.exports.GIFT_NAME_JA_MAP の参照を持ったままでも編集が反映されるよう、
// 再代入せず中身を入れ替える。
const GIFT_NAME_JA_MAP = {};

function replaceMap(entries) {
    for (const key of Object.keys(GIFT_NAME_JA_MAP)) {
        delete GIFT_NAME_JA_MAP[key];
    }
    for (const [key, value] of Object.entries(entries)) {
        GIFT_NAME_JA_MAP[normalizeGiftNameKey(key)] = String(value);
    }
}

try {
    replaceMap(readDictionaryFile(BUNDLED_DICTIONARY_PATH).entries);
} catch (error) {
    // 辞書が欠けても英語名フォールバックで動く。表示のための資産なので起動は止めない。
    console.warn('[gift-name-ja] 辞書を読み込めませんでした。ギフト名は英語のまま表示されます:', error?.message || error);
}

function getGiftDisplayNameJa(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
        return '';
    }

    return GIFT_NAME_JA_MAP[normalizeGiftNameKey(trimmed)] || trimmed;
}

// shared/gift-names/sync.mjs が書き出すのと同じ整形にする。
// ずれると sync.mjs --check（pre-commit）が落ちる。tests/unit/gift-name-ja.test.js が固定している。
function serializeDictionary(doc) {
    const entries = {};
    for (const key of Object.keys(doc.entries).sort((a, b) => a.localeCompare(b, 'en'))) {
        entries[key] = doc.entries[key];
    }

    return `${JSON.stringify({
        version: doc.version,
        normalization: doc.normalization,
        entries
    }, null, 2)}\n`;
}

// 同じ内容を正本と生成コピーの2箇所へ書く。途中で落ちても半端な JSON を
// 残さないよう、書き込みは一時ファイル + rename で行う。
function writeAtomic(filePath, text) {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, text, 'utf8');
    try {
        fs.renameSync(tmpPath, filePath);
    } catch (error) {
        try {
            fs.unlinkSync(tmpPath);
        } catch {
            // 消せなくても元ファイルは無傷。握りつぶしてよい。
        }
        throw error;
    }
}

// /db/gift-ja-editor.html からの手動入力を反映する。value が空ならエントリを削除
// （英語名フォールバックに戻す）。呼び出し元がユーザーの目視確認を経た値のみ渡すこと。
//
// 書き込むのは正本と生成コピーの両方。正本が無いパッケージ版では編集できない
// （asar は読み取り専用なので、そもそも従来も保存できなかった）。
function setGiftDisplayNameJa(rawName, value) {
    const key = normalizeGiftNameKey(rawName);
    if (!key) {
        return { ok: false, error: 'ギフト名が空です。' };
    }

    if (!fs.existsSync(SHARED_DICTIONARY_PATH)) {
        return { ok: false, error: '対訳の編集は開発リポジトリ内でのみ行えます（shared/gift-names が見つかりません）。' };
    }

    const trimmedValue = String(value || '').trim();

    let doc;
    try {
        doc = readDictionaryFile(SHARED_DICTIONARY_PATH);
    } catch (error) {
        return { ok: false, error: `辞書を読み込めませんでした: ${error?.message || error}` };
    }

    delete doc.entries[key];

    // 値が正規化キーそのもの（小文字化された英語）なら辞書へ入れない。入れると
    // "TikTok Universe+" が "tiktok universe+" と表示されて元表記より劣化する。
    // エントリを消しておけば呼び出し元が持つ元表記へフォールバックする。
    if (trimmedValue && trimmedValue !== key) {
        doc.entries[key] = trimmedValue;
    }

    const serialized = serializeDictionary(doc);
    try {
        fs.mkdirSync(path.dirname(BUNDLED_DICTIONARY_PATH), { recursive: true });
        writeAtomic(SHARED_DICTIONARY_PATH, serialized);
        writeAtomic(BUNDLED_DICTIONARY_PATH, serialized);
    } catch (error) {
        // メモリ上のマップは触っていないので、画面の表示とファイルの内容はずれない。
        return { ok: false, error: `辞書を保存できませんでした: ${error?.message || error}` };
    }

    replaceMap(doc.entries);
    distributeToOtherProjects();

    return { ok: true, key, value: doc.entries[key] ?? '' };
}

// 正本を書き換えたので、他プロジェクト（mobile など）の配布コピーも揃えておく。
// ここを省くと pre-commit の `sync.mjs --check` が落ちるだけなので、失敗しても保存は成功扱い。
function distributeToOtherProjects() {
    if (!fs.existsSync(SYNC_SCRIPT_PATH)) {
        return;
    }

    try {
        execFileSync(process.execPath, [SYNC_SCRIPT_PATH], {
            // Electron から呼ばれた場合、process.execPath は electron.exe なので Node として動かす。
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            stdio: 'ignore',
            timeout: 15000
        });
    } catch (error) {
        console.warn('[gift-name-ja] 配布コピーの同期に失敗しました。node shared/gift-names/sync.mjs を手動で実行してください:', error?.message || error);
    }
}

module.exports = {
    GIFT_NAME_JA_MAP,
    getGiftDisplayNameJa,
    setGiftDisplayNameJa,
    normalizeGiftNameKey
};
