'use strict';
// room_id付き接続(enableExtendedGiftInfo:true)で得られる availableGifts の全件を保存する。
// これには通常のグローバルカタログに加え、配信者固有(community_gift等)のギフトも含まれる。
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
  });

  try {
    await conn.connect();
    const gifts = conn.availableGifts || [];
    fs.writeFileSync(path.join(RAW_DIR, 'node-giftlist-room-scoped.json'), JSON.stringify(gifts, null, 2));
    console.log('saved', gifts.length, 'gifts to node-giftlist-room-scoped.json');
    const communityGifts = gifts.filter((g) => g.tracker_params?.gift_subtype === 'community_gift');
    console.log('community/subscriber gifts found:', communityGifts.length);
    for (const g of communityGifts) console.log(' -', g.id, g.name);
  } catch (err) {
    console.log('FAILED:', err.message);
  } finally {
    try {
      await conn.disconnect?.();
    } catch {
      /* noop */
    }
  }
  process.exit(0);
}

main();
