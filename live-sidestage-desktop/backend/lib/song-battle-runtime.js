'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_STATE_KEY = 'songBattleWidgetSettings';
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.wav', '.aac', '.ogg']);
const MAX_SCANNED_FILES = 20000;
const MAX_SCAN_DEPTH = 12;

function defaultHistoryFilePath() {
    return path.join(os.homedir(), 'AppData', 'Local', 'VirtualDJ', 'History', 'tracklist.txt');
}

const TEST_VOTERS = {
    A: [
        { id: '__test_voter_a__', nickname: 'テストリスナーA', letter: 'A', color: '#f87171' },
        { id: '__test_voter_b__', nickname: 'テストリスナーB', letter: 'B', color: '#fb923c' },
        { id: '__test_voter_c__', nickname: 'テストリスナーC', letter: 'C', color: '#facc15' }
    ],
    B: [
        { id: '__test_voter_d__', nickname: 'テストリスナーD', letter: 'D', color: '#60a5fa' },
        { id: '__test_voter_e__', nickname: 'テストリスナーE', letter: 'E', color: '#818cf8' },
        { id: '__test_voter_f__', nickname: 'テストリスナーF', letter: 'F', color: '#34d399' }
    ]
};

function buildTestAvatarDataUrl(letter, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">`
        + `<rect width="80" height="80" rx="14" fill="${color}"/>`
        + `<text x="40" y="53" font-size="38" font-family="sans-serif" font-weight="bold" `
        + `text-anchor="middle" fill="white">${letter}</text></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function defaultSongBattleSettings() {
    return {
        directory: '',
        giftNameA: '',
        giftNameB: '',
        durationSec: 60,
        startMode: 'manual',
        loopIntervalMin: 10,
        historyExcludeCount: 20,
        historyFilePath: defaultHistoryFilePath()
    };
}

module.exports = function createSongBattleRuntime({
    io,
    vdjClient,
    getScopedStateValue,
    setScopedStateValue,
    normalizeBroadcasterId,
    normalizeWholeNumber,
    fetchTikTokGiftCatalog,
}) {
    const state = {
        status: 'idle',
        starting: false,
        cancelRequested: false,
        songA: null,
        songB: null,
        giftImageA: '',
        giftImageB: '',
        startedAt: 0,
        endsAt: 0,
        durationSec: 0,
        tallyA: 0,
        tallyB: 0,
        voterSide: new Map(),
        voters: new Map(),
        usedTrackPaths: new Set(),
        endTimer: null,
        loopTimer: null
    };

    function normalizeSongBattleSettings(value) {
        let source = value;

        if (typeof source === 'string') {
            try {
                source = JSON.parse(source);
            } catch {
                source = null;
            }
        }

        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            source = {};
        }

        const fallback = defaultSongBattleSettings();
        const durationSec = normalizeWholeNumber(source.durationSec);
        const loopIntervalMin = normalizeWholeNumber(source.loopIntervalMin);
        const historyExcludeCount = normalizeWholeNumber(source.historyExcludeCount);

        return {
            directory: String(source.directory || '').trim(),
            giftNameA: String(source.giftNameA || '').trim(),
            giftNameB: String(source.giftNameB || '').trim(),
            durationSec: durationSec && durationSec > 0 ? Math.min(durationSec, 3600) : fallback.durationSec,
            startMode: source.startMode === 'auto-loop' ? 'auto-loop' : 'manual',
            loopIntervalMin: loopIntervalMin && loopIntervalMin > 0 ? Math.min(loopIntervalMin, 1440) : fallback.loopIntervalMin,
            historyExcludeCount: historyExcludeCount !== null ? Math.max(0, Math.min(historyExcludeCount, 500)) : fallback.historyExcludeCount,
            historyFilePath: String(source.historyFilePath || '').trim() || fallback.historyFilePath
        };
    }

    function getSettings() {
        return normalizeSongBattleSettings(getScopedStateValue(SETTINGS_STATE_KEY));
    }

    function setSettings(next) {
        const normalized = normalizeSongBattleSettings(next);
        setScopedStateValue(SETTINGS_STATE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    // ディレクトリ配下(サブディレクトリ含む)の対応拡張子ファイルを再帰的に列挙する
    function scanTrackPool(dir) {
        const results = [];
        const stack = [{ dirPath: dir, depth: 0 }];

        while (stack.length > 0 && results.length < MAX_SCANNED_FILES) {
            const { dirPath, depth } = stack.pop();
            if (depth > MAX_SCAN_DEPTH) continue;

            let entries;
            try {
                entries = fs.readdirSync(dirPath, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries) {
                if (results.length >= MAX_SCANNED_FILES) break;
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    stack.push({ dirPath: fullPath, depth: depth + 1 });
                } else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                    results.push(fullPath);
                }
            }
        }

        return results;
    }

    // tracklist.txt はフォーマットがユーザー設定次第で可変のため、
    // 「末尾N行のテキストにタイトルが部分一致するか」というヒューリスティクで除外判定する
    function readRecentHistoryLines(historyFilePath, count) {
        if (!count || count <= 0) return [];

        let content;
        try {
            content = fs.readFileSync(historyFilePath, 'utf8');
        } catch {
            return [];
        }

        const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        return lines.slice(-count).map((line) => line.toLowerCase());
    }

    function isTitleInHistory(titleGuess, historyLines) {
        const normalizedTitle = String(titleGuess || '').trim().toLowerCase();
        if (normalizedTitle.length < 2 || historyLines.length === 0) return false;
        return historyLines.some((line) => line.includes(normalizedTitle));
    }

    function shuffle(array) {
        const copy = [...array];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    async function extractTrackInfo(filePath) {
        const fallbackTitle = path.basename(filePath, path.extname(filePath));

        try {
            const mm = await import('music-metadata');
            const metadata = await mm.parseFile(filePath, { duration: false, skipCovers: false });
            const common = metadata.common || {};
            const picture = Array.isArray(common.picture) && common.picture.length > 0 ? common.picture[0] : null;
            const coverDataUrl = picture
                ? `data:${picture.format};base64,${Buffer.from(picture.data).toString('base64')}`
                : '';

            return {
                filePath,
                title: fallbackTitle,
                artist: common.artist || '',
                coverDataUrl
            };
        } catch {
            return { filePath, title: fallbackTitle, artist: '', coverDataUrl: '' };
        }
    }

    function pickCandidatePaths(settings) {
        const pool = scanTrackPool(settings.directory);
        if (pool.length < 2) {
            throw new Error('楽曲ディレクトリに十分な曲がありません（2曲以上必要です）。');
        }

        let available = pool.filter((filePath) => !state.usedTrackPaths.has(filePath));
        if (available.length < 2) {
            state.usedTrackPaths.clear();
            available = pool;
        }

        const historyLines = readRecentHistoryLines(settings.historyFilePath, settings.historyExcludeCount);
        const shuffled = shuffle(available);
        const notRecentlyPlayed = shuffled.filter((filePath) => {
            const titleGuess = path.basename(filePath, path.extname(filePath));
            return !isTitleInHistory(titleGuess, historyLines);
        });

        const ordered = [...notRecentlyPlayed, ...shuffled.filter((p) => !notRecentlyPlayed.includes(p))];
        const chosen = [...new Set(ordered)].slice(0, 2);

        if (chosen.length < 2) {
            throw new Error('選出できる曲が不足しています。');
        }

        return chosen;
    }

    function clearTimers() {
        if (state.endTimer) {
            clearTimeout(state.endTimer);
            state.endTimer = null;
        }
        if (state.loopTimer) {
            clearTimeout(state.loopTimer);
            state.loopTimer = null;
        }
    }

    async function resolveGiftImages(settings) {
        const giftNameA = settings.giftNameA.trim().toLowerCase();
        const giftNameB = settings.giftNameB.trim().toLowerCase();

        try {
            const catalog = await fetchTikTokGiftCatalog();
            const findImage = (giftName) => {
                if (!giftName) return '';
                const match = catalog.find((gift) => String(gift.name || '').trim().toLowerCase() === giftName);
                return match?.imageUrl || '';
            };

            return { giftImageA: findImage(giftNameA), giftImageB: findImage(giftNameB) };
        } catch {
            return { giftImageA: '', giftImageB: '' };
        }
    }

    function getRoundSnapshot() {
        return {
            status: state.status,
            songA: state.songA,
            songB: state.songB,
            giftImageA: state.giftImageA,
            giftImageB: state.giftImageB,
            startedAt: state.startedAt,
            endsAt: state.endsAt,
            durationSec: state.durationSec,
            tallyA: state.tallyA,
            tallyB: state.tallyB,
            voters: Array.from(state.voters.values())
        };
    }

    async function startRound() {
        if (state.status === 'running' || state.starting) {
            throw new Error('投票中です。終了または中止してから開始してください。');
        }

        state.starting = true;
        state.cancelRequested = false;
        try {
            const settings = getSettings();
            if (!settings.directory) {
                throw new Error('楽曲ディレクトリが未設定です。');
            }
            if (!settings.giftNameA || !settings.giftNameB) {
                throw new Error('ギフトA/ギフトBの名前が未設定です。');
            }

            const [pathA, pathB] = pickCandidatePaths(settings);
            const [songA, songB, giftImages] = await Promise.all([
                extractTrackInfo(pathA),
                extractTrackInfo(pathB),
                resolveGiftImages(settings)
            ]);

            if (state.cancelRequested) {
                state.cancelRequested = false;
                state.songA = null;
                state.songB = null;
                state.giftImageA = '';
                state.giftImageB = '';
                state.tallyA = 0;
                state.tallyB = 0;
                state.voterSide = new Map();
                state.voters = new Map();
                io.emit('song-battle:round-cancelled', getRoundSnapshot());
                return getRoundSnapshot();
            }

            clearTimers();
            state.status = 'running';
            state.songA = songA;
            state.songB = songB;
            state.giftImageA = giftImages.giftImageA;
            state.giftImageB = giftImages.giftImageB;
            state.startedAt = Date.now();
            state.durationSec = settings.durationSec;
            state.endsAt = state.startedAt + settings.durationSec * 1000;
            state.tallyA = 0;
            state.tallyB = 0;
            state.voterSide = new Map();
            state.voters = new Map();
            state.usedTrackPaths.add(pathA);
            state.usedTrackPaths.add(pathB);

            io.emit('song-battle:round-start', getRoundSnapshot());
            state.endTimer = setTimeout(() => {
                endRound({ cancelled: false }).catch((error) => {
                    console.warn('⚠️ 曲対決投票の終了処理に失敗しました:', error.message);
                });
            }, settings.durationSec * 1000);

            return getRoundSnapshot();
        } finally {
            state.starting = false;
        }
    }

    async function endRound({ cancelled }) {
        if (state.status !== 'running') {
            return getRoundSnapshot();
        }

        clearTimers();
        const settings = getSettings();
        state.status = 'idle';

        if (cancelled) {
            io.emit('song-battle:round-cancelled', getRoundSnapshot());
            return getRoundSnapshot();
        }

        const winnerSide = state.tallyA === state.tallyB
            ? (Math.random() < 0.5 ? 'A' : 'B')
            : (state.tallyA > state.tallyB ? 'A' : 'B');
        const winnerTrack = winnerSide === 'A' ? state.songA : state.songB;

        try {
            const [deckNum] = await vdjClient.resolveTargetDecks('non-master');
            if (deckNum && winnerTrack?.filePath) {
                await vdjClient.loadTrackToDeck(deckNum, winnerTrack.filePath);
            }
        } catch (error) {
            console.warn('⚠️ 勝者曲のVirtualDJロードに失敗しました:', error.message);
        }

        io.emit('song-battle:round-end', {
            ...getRoundSnapshot(),
            winnerSide
        });

        if (settings.startMode === 'auto-loop') {
            state.loopTimer = setTimeout(() => {
                startRound().catch((error) => {
                    console.warn('⚠️ 曲対決投票の自動開始に失敗しました:', error.message);
                });
            }, settings.loopIntervalMin * 60000);
        }

        return getRoundSnapshot();
    }

    function registerVote(giftEvent) {
        if (state.status !== 'running') return;

        const userId = normalizeBroadcasterId(giftEvent?.uniqueId);
        if (!userId) return;

        const giftName = String(giftEvent?.giftName || '').trim().toLowerCase();
        const coins = normalizeWholeNumber(giftEvent?.totalGifts) ?? 0;
        if (coins <= 0) return;

        const settings = getSettings();
        let side = state.voterSide.get(userId);

        if (!side) {
            if (giftName && giftName === settings.giftNameA.trim().toLowerCase()) {
                side = 'A';
            } else if (giftName && giftName === settings.giftNameB.trim().toLowerCase()) {
                side = 'B';
            } else {
                return;
            }
            state.voterSide.set(userId, side);
        }

        if (side === 'A') {
            state.tallyA += coins;
        } else {
            state.tallyB += coins;
        }

        const existingVoter = state.voters.get(userId);
        state.voters.set(userId, {
            userId,
            side,
            image: giftEvent?.image || existingVoter?.image || '',
            nickname: giftEvent?.nickname || existingVoter?.nickname || userId,
            coins: (existingVoter?.coins || 0) + coins
        });

        io.emit('song-battle:vote-update', getRoundSnapshot());
    }

    function testVote(side) {
        if (state.status !== 'running') {
            throw new Error('投票中ではありません。');
        }
        if (side !== 'A' && side !== 'B') {
            throw new Error('side は A か B を指定してください。');
        }

        const pool = TEST_VOTERS[side];
        const persona = pool[Math.floor(Math.random() * pool.length)];
        let lockedSide = state.voterSide.get(persona.id);
        if (!lockedSide) {
            lockedSide = side;
            state.voterSide.set(persona.id, lockedSide);
        }

        if (lockedSide === 'A') {
            state.tallyA += 1;
        } else {
            state.tallyB += 1;
        }

        const existingVoter = state.voters.get(persona.id);
        state.voters.set(persona.id, {
            userId: persona.id,
            side: lockedSide,
            image: buildTestAvatarDataUrl(persona.letter, persona.color),
            nickname: persona.nickname,
            coins: (existingVoter?.coins || 0) + 1
        });

        io.emit('song-battle:vote-update', getRoundSnapshot());
        return getRoundSnapshot();
    }

    return {
        getSettings,
        setSettings,
        getRoundSnapshot,
        startRound,
        endRoundNow: () => endRound({ cancelled: false }),
        cancelRound: () => {
            if (state.starting) {
                state.cancelRequested = true;
                return getRoundSnapshot();
            }
            return endRound({ cancelled: true });
        },
        registerVote,
        testVote
    };
};
