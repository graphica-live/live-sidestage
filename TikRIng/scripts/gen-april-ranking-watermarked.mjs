/**
 * 2026年4月 着用数Top10 の透かし付き画像をローカル生成するスクリプト
 * Usage: node scripts/gen-april-ranking-watermarked.mjs
 * 出力先: scripts/out/april-ranking/
 */

import { createCanvas, loadImage } from 'canvas';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, 'out', 'april-ranking');
mkdirSync(OUT_DIR, { recursive: true });

const ORIGIN = 'https://tikring.graphica-produce.com';
const WATERMARK_TEXT = 'TikRing';

const RANKING = [
  { rank: 1,  id: '0269fc20-d9e7-4e2a-99e6-ce9560cb27ea', count: 152 },
  { rank: 2,  id: 'bd0c203b-0bc0-47a7-bc6a-5df7e5e11e36', count: 105 },
  { rank: 3,  id: '4242f83b-d801-41b5-bf0f-fe64fa051556', count: 94  },
  { rank: 4,  id: '72e356e7-ff7f-4997-89e3-b25b6a3cf1b0', count: 71  },
  { rank: 5,  id: '2cf5b77c-a946-4da9-88d0-db3293e0156c', count: 69  },
  { rank: 6,  id: '762aebd6-8f6e-4210-bce9-ac845a7d4abd', count: 65  },
  { rank: 7,  id: '89dc66c1-100e-4a4d-b79b-8dc7d251735d', count: 64  },
  { rank: 8,  id: 'b2c92974-29c2-4983-86e1-b948a510e2fa', count: 61  },
  { rank: 9,  id: '4a574ed3-ba9d-4dce-9dc9-e2b75630bcef', count: 58  },
  { rank: 10, id: 'd55c37df-b798-4aba-85ed-b9f64b2f9b86', count: 55  },
];

// FrameRankingAccordion の StrongWatermarkOverlay(compact) と同等の設定
const WATERMARK_OPTIONS = {
  gradientTopAlpha:    0.14,
  gradientMidAlpha:    0.22,
  gradientBottomAlpha: 0.30,
  textAlpha:           0.72,
  strokeAlpha:         0.90,
};

async function generateWatermarkedPng(thumbnailUrl, options) {
  const image = await loadImage(thumbnailUrl);
  const size = Math.max(image.width, image.height);
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);

  const offsetX = (size - image.width) / 2;
  const offsetY = (size - image.height) / 2;
  ctx.drawImage(image, offsetX, offsetY, image.width, image.height);

  // グラデーションオーバーレイ
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0,    `rgba(0,0,0,${options.gradientTopAlpha})`);
  gradient.addColorStop(0.55, `rgba(0,0,0,${options.gradientMidAlpha})`);
  gradient.addColorStop(1,    `rgba(0,0,0,${options.gradientBottomAlpha})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // TikRing テキスト透かし（-45度 タイル）
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const fontSize = Math.max(26, Math.round(size * 0.08));
  const spacing  = Math.max(108, Math.round(size * 0.28));
  ctx.font        = `900 ${fontSize}px Arial, sans-serif`;
  ctx.fillStyle   = `rgba(255,255,255,${options.textAlpha})`;
  ctx.strokeStyle = `rgba(0,0,0,${options.strokeAlpha})`;
  ctx.lineWidth   = Math.max(2, Math.round(size * 0.006));

  for (let x = -size * 1.2; x <= size * 1.2; x += spacing) {
    for (let y = -size * 1.2; y <= size * 1.2; y += spacing) {
      ctx.strokeText(WATERMARK_TEXT, x, y);
      ctx.fillText(WATERMARK_TEXT, x, y);
    }
  }
  ctx.restore();

  return canvas.toBuffer('image/png');
}

(async () => {
  for (const { rank, id, count } of RANKING) {
    const url = `${ORIGIN}/api/share/thumbnail/${id}.png?raw=1`;
    process.stdout.write(`[${rank}/10] ${id} (${count}回) ... `);
    try {
      const buf = await generateWatermarkedPng(url, WATERMARK_OPTIONS);
      const outPath = resolve(OUT_DIR, `rank${String(rank).padStart(2, '0')}_${id}.png`);
      writeFileSync(outPath, buf);
      console.log(`saved → ${outPath}`);
    } catch (err) {
      console.error(`FAILED: ${err.message}`);
    }
  }
  console.log('\n完了。出力先:', OUT_DIR);
})();
