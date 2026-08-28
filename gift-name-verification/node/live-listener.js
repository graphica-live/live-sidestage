'use strict';
// 実LIVEに接続して 'gift' イベントを受信し、生データを NDJSON で追記する。
// enableExtendedGiftInfo は使わない(メイン検証と同じ接続方針: 別スクリプトで検証済み)。
const { WebcastPushConnection } = require('tiktok-live-connector');
const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'raw');
const OUT_FILE = path.join(RAW_DIR, 'node-gift-events.jsonl');
const TARGET = process.env.TARGET_UNIQUE_ID || 'yu_ki_nojo';
const DURATION_MS = Number(process.env.LISTEN_DURATION_MS || 15 * 60 * 1000);

const seenGiftIds = new Set();

async function main() {
  const conn = new WebcastPushConnection(`@${TARGET}`, {
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
    enableExtendedGiftInfo: false,
    enableWebsocketUpgrade: true,
    enableRequestPolling: false,
    authenticateWs: false,
    sessionId: undefined,
  });

  conn.on('gift', (data) => {
    seenGiftIds.add(data.giftId);
    const record = {
      receivedAt: new Date().toISOString(),
      giftId: data.giftId,
      giftName: data.giftName,
      giftType: data.giftType,
      repeatEnd: data.repeatEnd,
      repeatCount: data.repeatCount,
      diamondCount: data.diamondCount,
      giftPictureUrl: data.giftPictureUrl,
      uniqueId: data.uniqueId,
    };
    fs.appendFileSync(OUT_FILE, JSON.stringify(record) + '\n');
    console.log(`[gift] id=${data.giftId} name=${data.giftName} x${data.repeatCount}`);
  });

  conn.on('streamEnd', () => console.log('[streamEnd]'));
  conn.on('error', (err) => console.log('[error]', err?.message));

  try {
    await conn.connect();
    console.log(`connected to @${TARGET}, listening for ${DURATION_MS}ms ...`);
  } catch (err) {
    console.log('connect failed:', err.message);
    process.exit(1);
  }

  setTimeout(async () => {
    console.log(`done. unique giftIds observed: ${seenGiftIds.size}`);
    try {
      await conn.disconnect();
    } catch {
      /* noop */
    }
    process.exit(0);
  }, DURATION_MS);
}

main();
