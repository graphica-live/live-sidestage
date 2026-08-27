#!/usr/bin/env node
'use strict';

// ギフト名日本語辞書（共通資産）の検証と配布。
//
//   node shared/gift-names/sync.mjs           正本を整形し、配布コピーを更新する
//   node shared/gift-names/sync.mjs --check   何も書かず、正本と配布コピーの整合だけ確認する
//
// 正本は shared/gift-names/*.json だけ。配布コピーは各プロジェクトのビルドが
// リポジトリルートを参照できないために存在する（electron-builder の files は
// アプリディレクトリ内しか含められず、Flutter の asset も package 外を辿れない）。
// 詳細と運用は同ディレクトリの README.md を参照。
//
// Node 標準モジュールだけで動く。npm install は不要。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const DICTIONARY = 'gift-names-ja.json';
const REFERENCE = 'gift-names-ja-reference.json';

// 配布先。プロジェクトを増やすときはここに1行足す。
//
// **live-sidestage-mobile は外した。** モバイルは TikTok 公式の日本語名を
// サーバー(GET /api/mobile/gifts の labelJa)から取って端末へ貯める方式へ移した
// (lib/core/gift_name_ja.dart)。desktop も同じ方向へ移行中で、完了したらこの辞書ごと消す。
const TARGETS = [
    { from: DICTIONARY, to: 'live-sidestage-desktop/backend/lib/gift-names/gift-names-ja.json' },
    { from: REFERENCE, to: 'live-sidestage-desktop/backend/lib/gift-names/gift-names-ja-reference.json' },
];

const NORMALIZATION = 'trim -> unify apostrophes -> collapse whitespace -> lowercase';

// 辞書キーの正規化。README.md の「正規化仕様」と同じ規則を、
// live-sidestage-desktop/backend/lib/gift-name-ja.js と
// live-sidestage-mobile/lib/core/gift_name_ja.dart が同じ順序で実装している。
// 変更するときは3箇所すべてと両者のテストを合わせること。
const APOSTROPHES = /[‘’ʼ´`]/gu;
const WHITESPACE = /[\s　]+/gu;

export function normalizeGiftNameKey(raw) {
    return String(raw ?? '')
        .replace(APOSTROPHES, "'")
        .replace(WHITESPACE, ' ')
        .trim()
        .toLowerCase();
}

/**
 * 改行コードの違いを無視して内容を比べる。
 *
 * **Windows の `core.autocrlf` でチェックアウトされた作業コピーは CRLF になる。**
 * 生成テキストは常に LF なので、生の文字列比較だと「整形が崩れています」と誤検出して
 * pre-commit を通れなくなる（git worktree を切った直後がまさにこの状態になる）。
 * 書き出しは従来どおり LF のままで、比較だけ寛容にする。
 */
function sameIgnoringEol(a, b) {
    return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
}

function readJson(absPath) {
    try {
        return JSON.parse(fs.readFileSync(absPath, 'utf8'));
    } catch (error) {
        throw new Error(`${path.relative(REPO_ROOT, absPath)} を読めませんでした: ${error.message}`);
    }
}

const DICTIONARY_FIELDS = new Set(['version', 'normalization', 'entries']);

/** 正本の辞書を検証し、整形済みテキストを返す。 */
function canonicalizeDictionary(raw) {
    const problems = [];

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`${DICTIONARY} はオブジェクトである必要があります。`);
    }
    const entries = raw.entries;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
        throw new Error(`${DICTIONARY} の entries はオブジェクトである必要があります。`);
    }
    for (const field of Object.keys(raw)) {
        if (!DICTIONARY_FIELDS.has(field)) {
            problems.push(`未知のフィールド ${JSON.stringify(field)} があります。読み手が無視するだけなので消してください。`);
        }
    }

    const cleanEntries = {};
    for (const [key, value] of Object.entries(entries)) {
        const normalized = normalizeGiftNameKey(key);
        if (!normalized) {
            problems.push(`空のキーがあります。`);
            continue;
        }
        if (normalized !== key) {
            problems.push(`キー ${JSON.stringify(key)} が未正規化です（${JSON.stringify(normalized)} にしてください）。`);
        }
        if (typeof value !== 'string') {
            problems.push(`キー ${JSON.stringify(key)} の値が文字列ではありません。`);
            continue;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            problems.push(`キー ${JSON.stringify(key)} の値が空です。訳が無いなら行ごと消してください（英語名へフォールバックします）。`);
            continue;
        }
        if (trimmed !== value) {
            problems.push(`キー ${JSON.stringify(key)} の値に前後の空白があります。`);
        }
        // 値が正規化キーそのもの = 小文字化された英語が表示名になっている状態。
        // 行ごと消せば呼び出し元が持つ TikTok の元表記へフォールバックするので、
        // そちらの方が表示は正しくなる。"GG" や "TikTok Universe+" のように
        // 正式な英語表記を持つエントリはこれに該当しないので残せる。
        if (trimmed === normalized) {
            problems.push(`キー ${JSON.stringify(key)} の値が小文字化された英語名そのものです。行ごと消してください（元表記のままフォールバックした方が表示が正しくなります）。`);
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(cleanEntries, normalized) && cleanEntries[normalized] !== trimmed) {
            problems.push(`キー ${JSON.stringify(normalized)} が重複しています（${JSON.stringify(cleanEntries[normalized])} と ${JSON.stringify(trimmed)}）。`);
            continue;
        }
        cleanEntries[normalized] = trimmed;
    }

    if (problems.length) {
        throw new Error(`${DICTIONARY} に問題があります:\n  - ${problems.join('\n  - ')}`);
    }

    const sortedEntries = {};
    for (const key of Object.keys(cleanEntries).sort((a, b) => a.localeCompare(b, 'en'))) {
        sortedEntries[key] = cleanEntries[key];
    }

    return `${JSON.stringify(
        {
            version: 1,
            normalization: NORMALIZATION,
            entries: sortedEntries,
        },
        null,
        2,
    )}\n`;
}

/** 参照リストを検証し、整形済みテキストを返す。並び順（コイン昇順）は意味を持つのでソートしない。 */
function canonicalizeReference(raw) {
    if (!Array.isArray(raw)) {
        throw new Error(`${REFERENCE} は配列である必要があります。`);
    }

    const problems = [];
    const seen = new Set();
    const clean = [];

    for (const value of raw) {
        if (typeof value !== 'string') {
            problems.push('文字列でない要素があります。');
            continue;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            problems.push('空の要素があります。');
            continue;
        }
        if (seen.has(trimmed)) {
            problems.push(`${JSON.stringify(trimmed)} が重複しています。`);
            continue;
        }
        seen.add(trimmed);
        clean.push(trimmed);
    }

    if (problems.length) {
        throw new Error(`${REFERENCE} に問題があります:\n  - ${problems.join('\n  - ')}`);
    }

    return `${JSON.stringify(clean, null, 2)}\n`;
}

function main() {
    const checkOnly = process.argv.includes('--check');

    const canonical = {
        [DICTIONARY]: canonicalizeDictionary(readJson(path.join(HERE, DICTIONARY))),
        [REFERENCE]: canonicalizeReference(readJson(path.join(HERE, REFERENCE))),
    };

    const stale = [];
    const written = [];

    // 正本自身の整形崩れも直す（--check では検出だけ）。
    for (const [name, text] of Object.entries(canonical)) {
        const absPath = path.join(HERE, name);
        if (sameIgnoringEol(fs.readFileSync(absPath, 'utf8'), text)) continue;
        if (checkOnly) {
            stale.push(`shared/gift-names/${name}（整形が崩れています）`);
        } else {
            fs.writeFileSync(absPath, text, 'utf8');
            written.push(`shared/gift-names/${name}`);
        }
    }

    for (const target of TARGETS) {
        const absPath = path.join(REPO_ROOT, target.to);
        const text = canonical[target.from];
        const current = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : null;
        if (current !== null && sameIgnoringEol(current, text)) continue;
        if (checkOnly) {
            stale.push(`${target.to}（${current === null ? '未生成' : '正本と不一致'}）`);
        } else {
            fs.mkdirSync(path.dirname(absPath), { recursive: true });
            fs.writeFileSync(absPath, text, 'utf8');
            written.push(target.to);
        }
    }

    if (checkOnly) {
        if (stale.length) {
            console.error('ギフト名辞書の配布コピーが正本と一致していません:');
            for (const item of stale) console.error(`  - ${item}`);
            console.error('\n  node shared/gift-names/sync.mjs\n を実行して生成物を更新し、コミットに含めてください。');
            process.exit(1);
        }
        console.log('ギフト名辞書: 正本と配布コピーは一致しています。');
        return;
    }

    if (written.length) {
        console.log('ギフト名辞書を更新しました:');
        for (const item of written) console.log(`  - ${item}`);
    } else {
        console.log('ギフト名辞書: 更新はありません。');
    }
}

// import されたとき（テストから normalizeGiftNameKey を使う場合）は実行しない。
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
