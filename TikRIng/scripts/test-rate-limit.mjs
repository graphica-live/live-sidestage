// レートリミットのテストスクリプト
// 使い方: wrangler pages dev dist を起動してから node scripts/test-rate-limit.mjs

const BASE_URL = 'http://localhost:8788';

// 最小限の1x1透過PNG (base64)
const MINIMAL_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';
const pngBuffer = Buffer.from(MINIMAL_PNG_B64, 'base64');

async function uploadFrame(label) {
  const body = new FormData();
  const frameFile = new File([pngBuffer], 'frame.png', { type: 'image/png' });
  const maskFile = new File([pngBuffer], 'mask.png', { type: 'image/png' });
  body.append('file', frameFile);
  body.append('openingMask', maskFile);

  const res = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    body,
  });

  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }

  console.log(`[${label}] status=${res.status} message=${json?.message ?? json?.error ?? '(no message)'}`);
  return { status: res.status, json };
}

console.log('=== レートリミットテスト開始 ===');
console.log('期待: 最初の5回はアップロード試行、6回目に429レスポンス\n');

let rateLimitHit = false;
for (let i = 1; i <= 7; i++) {
  const result = await uploadFrame(`リクエスト${i}`);
  if (result.status === 429) {
    rateLimitHit = true;
    console.log(`\n✓ レートリミット発動 (${i}回目): ${result.json?.message}`);
    if (i !== 6) {
      console.log(`  ※ 注意: 期待は6回目でしたが${i}回目で発動しました`);
    }
    break;
  }
  if (i > 6) {
    console.log('\n✗ 7回目までレートリミットが発動しませんでした');
  }
}

if (!rateLimitHit) {
  console.log('\n✗ レートリミットが発動しませんでした（アップロードが全部失敗した可能性があります）');
}

console.log('\n=== テスト完了 ===');
