'use strict';
// 「英語名+diamond_countが同一なのにgiftIdが複数存在する」重複エントリを洗い出す。
// user報告: モバイルのギフトパネルには「ユニコーンファンタジー」(giftId=5338)が見えるのに
// 実際に配信中に届く/投げられるのは「幻のユニコーン」(giftId=7237)という別 giftId だった。
// これが684件カタログ全体でどれだけ起きているかを機械的に確認する。
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, 'raw');
const giftsEn = JSON.parse(fs.readFileSync(path.join(RAW, 'node-giftlist-default.json'), 'utf-8'));
const giftsJa = JSON.parse(fs.readFileSync(path.join(RAW, 'node-giftlist-webcast_language-ja-JP.json'), 'utf-8'));
const jaById = new Map(giftsJa.map((g) => [g.id, g.name]));

const key = (g) => `${g.name}|${g.diamond_count}`;
const groups = new Map();
for (const g of giftsEn) {
  const k = key(g);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(g);
}

const dupGroups = [...groups.entries()]
  .map(([k, arr]) => {
    const uniqueIds = [...new Set(arr.map((g) => g.id))];
    return { key: k, entries: uniqueIds.map((id) => ({ giftId: id, ...pick(arr.find((g) => g.id === id)) })) };
  })
  .filter((g) => g.entries.length > 1);

function pick(g) {
  return {
    englishName: g.name,
    japaneseName: jaById.get(g.id) ?? null,
    diamondCount: g.diamond_count,
    iconUri: g.icon?.uri ?? null,
    primaryEffectId: g.primary_effect_id ?? null,
    isDisplayedOnPanel: g.is_displayed_on_panel ?? null,
    isGlobalGift: g.is_global_gift ?? null,
  };
}

for (const g of dupGroups) {
  const jaNames = new Set(g.entries.map((e) => e.japaneseName));
  const icons = new Set(g.entries.map((e) => e.iconUri));
  g.japaneseNameDiffers = jaNames.size > 1;
  g.sameIcon = icons.size === 1;
}

dupGroups.sort((a, b) => (b.japaneseNameDiffers ? 1 : 0) - (a.japaneseNameDiffers ? 1 : 0));

fs.writeFileSync(path.join(__dirname, 'duplicate-gift-groups.json'), JSON.stringify(dupGroups, null, 2));

console.log('total duplicate groups (same englishName+diamond, different giftId):', dupGroups.length);
console.log('of which japanese name also differs between the duplicate ids:', dupGroups.filter((g) => g.japaneseNameDiffers).length);
console.log();
for (const g of dupGroups) {
  console.log(g.key, g.japaneseNameDiffers ? '[JA NAME DIFFERS]' : '');
  for (const e of g.entries) {
    console.log('  ', e.giftId, e.japaneseName, 'panel=' + e.isDisplayedOnPanel, 'global=' + e.isGlobalGift, 'sameIcon=' + g.sameIcon);
  }
}
