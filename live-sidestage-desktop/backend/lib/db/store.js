const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function migrateLegacyDatabaseFilesIfNeeded(appRoot, dbDirectory, dbPath) {
    const legacyDirectory = path.join(appRoot, 'data');

    if (path.resolve(legacyDirectory) === path.resolve(dbDirectory)) {
        return [];
    }

    if (!fs.existsSync(legacyDirectory) || fs.existsSync(dbPath)) {
        return [];
    }

    const copiedFiles = [];
    const fileNames = [
        'contributors.sqlite3',
        'contributors.sqlite3-shm',
        'contributors.sqlite3-wal'
    ];

    for (const fileName of fileNames) {
        const sourcePath = path.join(legacyDirectory, fileName);
        const targetPath = path.join(dbDirectory, fileName);

        if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
            continue;
        }

        fs.copyFileSync(sourcePath, targetPath);
        copiedFiles.push(fileName);
    }

    return copiedFiles;
}

function createDbStore(options) {
    const {
        appRoot,
        userDataDirectory
    } = options;

    const dbDirectory = path.join(userDataDirectory, 'data');
    const dbPath = path.join(dbDirectory, 'contributors.sqlite3');

    fs.mkdirSync(dbDirectory, { recursive: true });

    const migratedLegacyFiles = migrateLegacyDatabaseFilesIfNeeded(appRoot, dbDirectory, dbPath);
    const db = new Database(dbPath);

    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('busy_timeout = 5000');

    db.exec(`
        CREATE TABLE IF NOT EXISTS daily_contributors (
            day_key TEXT NOT NULL,
            broadcaster_id TEXT NOT NULL,
            unique_id TEXT NOT NULL,
            nickname TEXT NOT NULL,
            profile_image_url TEXT,
            total_coins INTEGER NOT NULL DEFAULT 0,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (day_key, broadcaster_id, unique_id)
        );

        CREATE TABLE IF NOT EXISTS display_state (
            state_key TEXT PRIMARY KEY,
            state_value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS broadcaster_state (
            broadcaster_id TEXT NOT NULL,
            state_key TEXT NOT NULL,
            state_value TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (broadcaster_id, state_key)
        );

        CREATE TABLE IF NOT EXISTS listener_name_overrides (
            broadcaster_id TEXT NOT NULL,
            unique_id TEXT NOT NULL,
            nickname TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (broadcaster_id, unique_id)
        );

        CREATE TABLE IF NOT EXISTS raw_gift_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            broadcaster_id TEXT NOT NULL,
            day_key TEXT NOT NULL,
            event_key TEXT NOT NULL UNIQUE,
            msg_id TEXT,
            event_id TEXT,
            unique_id TEXT NOT NULL,
            nickname TEXT NOT NULL,
            profile_image_url TEXT,
            gift_id TEXT,
            gift_name TEXT,
            gift_image_url TEXT,
            repeat_count INTEGER NOT NULL DEFAULT 1,
            coin_amount INTEGER NOT NULL,
            raw_payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            processed_at TEXT,
            processing_error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_raw_gift_events_unprocessed
        ON raw_gift_events (broadcaster_id, processed_at, id);
    `);

    const dailyContributorColumns = new Set(
        db.prepare('PRAGMA table_info(daily_contributors)').all().map((column) => column.name)
    );

    if (!dailyContributorColumns.has('qualified_at')) {
        db.exec('ALTER TABLE daily_contributors ADD COLUMN qualified_at TEXT');
    }

    const rawGiftEventColumns = new Set(
        db.prepare('PRAGMA table_info(raw_gift_events)').all().map((column) => column.name)
    );

    if (!rawGiftEventColumns.has('gift_image_url')) {
        db.exec('ALTER TABLE raw_gift_events ADD COLUMN gift_image_url TEXT');
    }

    const upsertContributorStmt = db.prepare(`
        INSERT INTO daily_contributors (
            day_key,
            broadcaster_id,
            unique_id,
            nickname,
            profile_image_url,
            total_coins,
            first_seen_at,
            last_seen_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day_key, broadcaster_id, unique_id) DO UPDATE SET
            nickname = excluded.nickname,
            profile_image_url = CASE
                WHEN excluded.profile_image_url = '' THEN daily_contributors.profile_image_url
                ELSE excluded.profile_image_url
            END,
            total_coins = daily_contributors.total_coins + excluded.total_coins,
            last_seen_at = excluded.last_seen_at,
            updated_at = excluded.updated_at
    `);

    const contributorByIdStmt = db.prepare(`
        SELECT
            daily_contributors.day_key AS dayKey,
            daily_contributors.unique_id AS uniqueId,
            COALESCE(listener_name_overrides.nickname, daily_contributors.nickname) AS nickname,
            daily_contributors.profile_image_url AS image,
            daily_contributors.total_coins AS total,
            daily_contributors.first_seen_at AS firstSeenAt
        FROM daily_contributors
        LEFT JOIN listener_name_overrides
            ON listener_name_overrides.broadcaster_id = daily_contributors.broadcaster_id
            AND listener_name_overrides.unique_id = daily_contributors.unique_id
        WHERE daily_contributors.day_key = ?
            AND daily_contributors.broadcaster_id = ?
            AND daily_contributors.unique_id = ?
    `);

    const adminContributorsByDayStmt = db.prepare(`
        SELECT
            daily_contributors.day_key AS dayKey,
            daily_contributors.unique_id AS uniqueId,
            COALESCE(listener_name_overrides.nickname, daily_contributors.nickname) AS nickname,
            daily_contributors.profile_image_url AS image,
            daily_contributors.total_coins AS total,
            daily_contributors.first_seen_at AS firstSeenAt
        FROM daily_contributors
        LEFT JOIN listener_name_overrides
            ON listener_name_overrides.broadcaster_id = daily_contributors.broadcaster_id
            AND listener_name_overrides.unique_id = daily_contributors.unique_id
        WHERE daily_contributors.day_key = ?
            AND daily_contributors.broadcaster_id = ?
    `);

    const adminContributorsByTimeRangeStmt = db.prepare(`
        SELECT
            raw_gift_events.unique_id AS uniqueId,
            COALESCE(listener_name_overrides.nickname, MAX(raw_gift_events.nickname)) AS nickname,
            COALESCE(
                MAX(CASE
                    WHEN raw_gift_events.profile_image_url IS NOT NULL AND TRIM(raw_gift_events.profile_image_url) <> ''
                        THEN raw_gift_events.profile_image_url
                    ELSE ''
                END),
                ''
            ) AS image,
            COALESCE(SUM(raw_gift_events.coin_amount), 0) AS total,
            MIN(raw_gift_events.created_at) AS firstSeenAt
        FROM raw_gift_events
        LEFT JOIN listener_name_overrides
            ON listener_name_overrides.broadcaster_id = raw_gift_events.broadcaster_id
            AND listener_name_overrides.unique_id = raw_gift_events.unique_id
        WHERE raw_gift_events.broadcaster_id = ?
          AND raw_gift_events.created_at >= ?
          AND raw_gift_events.created_at <= ?
        GROUP BY raw_gift_events.unique_id
        ORDER BY firstSeenAt ASC, raw_gift_events.unique_id ASC
    `);

    const contributorDaysByUniqueIdStmt = db.prepare(`
        SELECT DISTINCT day_key AS dayKey
        FROM daily_contributors
        WHERE broadcaster_id = ?
          AND unique_id = ?
        ORDER BY day_key ASC
    `);

    const upsertListenerNameOverrideStmt = db.prepare(`
        INSERT INTO listener_name_overrides (
            broadcaster_id,
            unique_id,
            nickname,
            updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(broadcaster_id, unique_id) DO UPDATE SET
            nickname = excluded.nickname,
            updated_at = excluded.updated_at
    `);

    const availableDaysStmt = db.prepare(`
        SELECT
            day_key AS dayKey,
            COUNT(*) AS contributorCount,
            COALESCE(SUM(total_coins), 0) AS totalCoins,
            MAX(updated_at) AS updatedAt
        FROM daily_contributors
        WHERE broadcaster_id = ?
        GROUP BY day_key
        ORDER BY day_key DESC
    `);

    const deleteContributorStmt = db.prepare(`
        DELETE FROM daily_contributors
        WHERE day_key = ?
          AND broadcaster_id = ?
          AND unique_id = ?
    `);

    const deleteDayStmt = db.prepare(`
        DELETE FROM daily_contributors
        WHERE day_key = ?
          AND broadcaster_id = ?
    `);

    const updateContributorTotalStmt = db.prepare(`
        UPDATE daily_contributors
        SET total_coins = ?,
            updated_at = ?,
            last_seen_at = ?
        WHERE day_key = ?
          AND broadcaster_id = ?
          AND unique_id = ?
    `);

    const getStateValueStmt = db.prepare(`
        SELECT state_value AS stateValue
        FROM display_state
        WHERE state_key = ?
    `);

    const getBroadcasterStateValueStmt = db.prepare(`
        SELECT state_value AS stateValue
        FROM broadcaster_state
        WHERE broadcaster_id = ?
          AND state_key = ?
    `);

    const setDisplayStateStmt = db.prepare(`
        INSERT INTO display_state (state_key, state_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(state_key) DO UPDATE SET
            state_value = excluded.state_value,
            updated_at = excluded.updated_at
    `);

    const setBroadcasterStateStmt = db.prepare(`
        INSERT INTO broadcaster_state (broadcaster_id, state_key, state_value, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(broadcaster_id, state_key) DO UPDATE SET
            state_value = excluded.state_value,
            updated_at = excluded.updated_at
    `);

    const insertRawGiftEventStmt = db.prepare(`
        INSERT INTO raw_gift_events (
            broadcaster_id,
            day_key,
            event_key,
            msg_id,
            event_id,
            unique_id,
            nickname,
            profile_image_url,
            gift_id,
            gift_name,
            gift_image_url,
            repeat_count,
            coin_amount,
            raw_payload,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_key) DO NOTHING
    `);

    const unprocessedRawGiftEventsStmt = db.prepare(`
        SELECT
            id,
            day_key AS dayKey,
            unique_id AS uniqueId,
            nickname,
            profile_image_url AS image,
            coin_amount AS totalGifts,
            created_at AS timestamp,
            gift_name AS giftName,
            gift_image_url AS giftImage,
            raw_payload AS rawPayload
        FROM raw_gift_events
        WHERE broadcaster_id = ?
          AND processed_at IS NULL
        ORDER BY id ASC
        LIMIT ?
    `);

    const adminGiftEventsByDayStmt = db.prepare(`
        SELECT
            id,
            day_key AS dayKey,
            unique_id AS uniqueId,
            nickname,
            profile_image_url AS image,
            coin_amount AS totalGifts,
            created_at AS timestamp,
            gift_id AS giftId,
            gift_name AS giftName,
            gift_image_url AS giftImage,
            repeat_count AS repeatCount,
            raw_payload AS rawPayload
        FROM raw_gift_events
        WHERE broadcaster_id = ?
          AND day_key = ?
                ORDER BY created_at ASC, id ASC
    `);

    const rawGiftEventByIdStmt = db.prepare(`
        SELECT
            id,
            day_key AS dayKey,
            unique_id AS uniqueId,
            nickname,
            profile_image_url AS image,
            coin_amount AS totalGifts,
            created_at AS timestamp,
            gift_id AS giftId,
            gift_name AS giftName,
            gift_image_url AS giftImage,
            repeat_count AS repeatCount,
            raw_payload AS rawPayload,
            processed_at AS processedAt
        FROM raw_gift_events
        WHERE broadcaster_id = ?
          AND id = ?
    `);

    const latestGiftNamesByIdStmt = db.prepare(`
        SELECT
            latest.gift_id AS giftId,
            latest.gift_name AS giftName,
            latest.gift_image_url AS giftImage,
            latest.created_at AS latestTimestamp
        FROM raw_gift_events AS latest
        INNER JOIN (
            SELECT
                gift_id,
                MAX(created_at) AS latestTimestamp
            FROM raw_gift_events
            WHERE broadcaster_id = ?
              AND gift_id IS NOT NULL
              AND TRIM(gift_id) <> ''
              AND gift_name IS NOT NULL
              AND TRIM(gift_name) <> ''
            GROUP BY gift_id
        ) AS grouped
            ON grouped.gift_id = latest.gift_id
           AND grouped.latestTimestamp = latest.created_at
        WHERE latest.broadcaster_id = ?
        GROUP BY latest.gift_id
        ORDER BY latest.created_at DESC
    `);

        const knownGiftNamesStmt = db.prepare(`
                SELECT
                        gift_name AS giftName,
                        MAX(created_at) AS latestTimestamp
                FROM raw_gift_events
                WHERE broadcaster_id = ?
                    AND gift_name IS NOT NULL
                    AND TRIM(gift_name) <> ''
                GROUP BY gift_name
                ORDER BY latestTimestamp DESC, gift_name COLLATE NOCASE ASC
                LIMIT ?
        `);

    const recentGiftSendersStmt = db.prepare(`
        SELECT
            dc.unique_id AS uniqueId,
            COALESCE(lno.nickname, dc.nickname) AS nickname,
            dc.profile_image_url AS image,
            MAX(dc.last_seen_at) AS lastSeenAt
        FROM daily_contributors dc
        LEFT JOIN listener_name_overrides lno
            ON lno.broadcaster_id = dc.broadcaster_id
            AND lno.unique_id = dc.unique_id
        WHERE dc.broadcaster_id = ?
          AND dc.day_key >= ?
        GROUP BY dc.unique_id
        ORDER BY lastSeenAt DESC
        LIMIT ?
    `);

    const markRawGiftEventProcessedStmt = db.prepare(`
        UPDATE raw_gift_events
        SET processed_at = ?, processing_error = NULL
        WHERE id = ?
    `);

    const markRawGiftEventErrorStmt = db.prepare(`
        UPDATE raw_gift_events
        SET processing_error = ?
        WHERE id = ?
    `);

    const deleteRawGiftEventByIdStmt = db.prepare(`
        DELETE FROM raw_gift_events
        WHERE broadcaster_id = ?
          AND id = ?
    `);

    const processStoredGiftEventTxn = db.transaction((storedEvent, processedAt, broadcasterId) => {
        upsertContributorStmt.run(
            storedEvent.dayKey,
            broadcasterId,
            storedEvent.uniqueId,
            storedEvent.nickname,
            storedEvent.image,
            storedEvent.totalGifts,
            storedEvent.timestamp,
            storedEvent.timestamp,
            processedAt
        );

        markRawGiftEventProcessedStmt.run(processedAt, storedEvent.id);

        return contributorByIdStmt.get(storedEvent.dayKey, broadcasterId, storedEvent.uniqueId);
    });

    return {
        dbPath,
        migratedLegacyFiles,
        close() {
            db.close();
        },
        getGlobalStateValue(stateKey) {
            return getStateValueStmt.get(stateKey)?.stateValue || null;
        },
        setGlobalStateValue(stateKey, stateValue, updatedAt) {
            setDisplayStateStmt.run(stateKey, String(stateValue), updatedAt);
            return stateValue;
        },
        getBroadcasterStateValue(broadcasterId, stateKey) {
            return getBroadcasterStateValueStmt.get(broadcasterId, stateKey)?.stateValue || null;
        },
        setBroadcasterStateValue(broadcasterId, stateKey, stateValue, updatedAt) {
            setBroadcasterStateStmt.run(broadcasterId, stateKey, String(stateValue), updatedAt);
            return stateValue;
        },
        getContributorById(dayKey, broadcasterId, uniqueId) {
            return contributorByIdStmt.get(dayKey, broadcasterId, uniqueId) || null;
        },
        getAdminContributorsByDay(dayKey, broadcasterId) {
            return adminContributorsByDayStmt.all(dayKey, broadcasterId);
        },
        getAdminContributorsByTimeRange(broadcasterId, startedAt, endedAt) {
            return adminContributorsByTimeRangeStmt.all(broadcasterId, startedAt, endedAt);
        },
        getAdminGiftEventsByDay(dayKey, broadcasterId) {
            return adminGiftEventsByDayStmt.all(broadcasterId, dayKey);
        },
        getRawGiftEventById(id, broadcasterId) {
            return rawGiftEventByIdStmt.get(broadcasterId, id) || null;
        },
        getLatestGiftNamesById(broadcasterId) {
            return latestGiftNamesByIdStmt.all(broadcasterId, broadcasterId);
        },
        getKnownGiftNames(broadcasterId, limit = 100) {
            return knownGiftNamesStmt.all(broadcasterId, Number(limit) || 100);
        },
        getRecentGiftSenders(broadcasterId, sinceDay, limit = 200) {
            return recentGiftSendersStmt.all(broadcasterId, sinceDay, Number(limit) || 200);
        },
        getAvailableDays(broadcasterId) {
            return availableDaysStmt.all(broadcasterId);
        },
        deleteContributor(dayKey, broadcasterId, uniqueId) {
            return deleteContributorStmt.run(dayKey, broadcasterId, uniqueId).changes;
        },
        deleteDay(dayKey, broadcasterId) {
            return deleteDayStmt.run(dayKey, broadcasterId).changes;
        },
        updateContributorTotal({ dayKey, broadcasterId, uniqueId, totalCoins, updatedAt }) {
            const result = updateContributorTotalStmt.run(
                totalCoins,
                updatedAt,
                updatedAt,
                dayKey,
                broadcasterId,
                uniqueId
            );

            if (!result.changes) {
                return null;
            }

            return contributorByIdStmt.get(dayKey, broadcasterId, uniqueId) || null;
        },
        getContributorDaysByUniqueId(broadcasterId, uniqueId) {
            return contributorDaysByUniqueIdStmt.all(broadcasterId, uniqueId).map((row) => row.dayKey);
        },
        upsertListenerNameOverride(broadcasterId, uniqueId, nickname, updatedAt) {
            upsertListenerNameOverrideStmt.run(broadcasterId, uniqueId, nickname, updatedAt);
        },
        storeRawGiftEvent(broadcasterId, event) {
            const result = insertRawGiftEventStmt.run(
                broadcasterId,
                event.dayKey,
                event.eventKey,
                event.msgId,
                event.eventId,
                event.uniqueId,
                event.nickname,
                event.image,
                event.giftId,
                event.giftName,
                event.giftImage,
                event.repeatCount,
                event.totalGifts,
                event.rawPayload,
                event.timestamp
            );

            return result.changes > 0;
        },
        getUnprocessedRawGiftEvents(broadcasterId, batchSize) {
            return unprocessedRawGiftEventsStmt.all(broadcasterId, batchSize);
        },
        processStoredGiftEvent(storedEvent, processedAt, broadcasterId) {
            return processStoredGiftEventTxn(storedEvent, processedAt, broadcasterId);
        },
        markRawGiftEventError(id, errorMessage) {
            markRawGiftEventErrorStmt.run(errorMessage, id);
        },
        deleteRawGiftEventById(id, broadcasterId) {
            return deleteRawGiftEventByIdStmt.run(broadcasterId, id).changes;
        }
    };
}

module.exports = {
    createDbStore
};