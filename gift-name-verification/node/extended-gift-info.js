'use strict';
// enableExtendedGiftInfo: true の挙動を確認する。
// メモリ上の既知の懸念: 2.1.1-beta1 の connect() は内部で fetchAvailableGifts() を呼び、
// 失敗時に InvalidResponseError を投げて接続そのものが落ちる(dist/lib/client.js:192-194)。
// gift/list/ 自体は無料で動くので、今回は接続まで成功するかどうかを実測する。
const { WebcastPushConnection } = require('tiktok-live-connector');
const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'raw');
const TARGET = process.env.TARGET_UNIQUE_ID || 'yu_ki_nojo';

async function main() {
  const conn = new WebcastPushConnection(`@${TARGET}`, {
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
    enableRequestPolling: false,
    authenticateWs: false,
    sessionId: undefined,
  });

  const result = { library: 'tiktok-live-connector', libraryVersion: '2.1.1-beta1', target: TARGET };
  try {
    await conn.connect();
    result.connectOk = true;
    const gifts = conn.availableGifts;
    result.availableGiftsCount = Array.isArray(gifts) ? gifts.length : null;
    result.sample = Array.isArray(gifts) ? gifts.slice(0, 3) : null;
    console.log('connect() OK, availableGifts count =', result.availableGiftsCount);

    // extendedGiftInfo が実際の gift イベントに乗るかを10秒だけ観察する。
    const firstGift = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 10000);
      conn.once('gift', (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
    if (firstGift) {
      result.observedGiftEvent = {
        giftId: firstGift.giftId,
        giftName: firstGift.giftName,
        hasExtendedGiftInfo: Boolean(firstGift.extendedGiftInfo),
        extendedGiftInfoName: firstGift.extendedGiftInfo?.name ?? null,
      };
      console.log('gift event observed:', JSON.stringify(result.observedGiftEvent));
    } else {
      console.log('no gift event observed within 10s window');
    }
  } catch (err) {
    result.connectOk = false;
    result.error = err.message;
    console.log('connect() FAILED:', err.message);
  } finally {
    try {
      await conn.disconnect?.();
    } catch {
      /* noop */
    }
  }

  fs.writeFileSync(path.join(RAW_DIR, 'node-extended-gift-info.json'), JSON.stringify(result, null, 2));
  process.exit(0);
}

main();
