// 日本地図の図形データ(src/event/prefecture-shapes.ts)を作る。
//
// **通常は再実行不要。** 県境の形は変わらないので、生成物をコミットして固定してある。
// 元データを差し替えるときだけ使う。
//
// 使い方:
//   npm pack japanmap@1.0.4                      # tarball を取得
//   tar xf japanmap-1.0.4.tgz                    # package/src/japan.json が出る
//   node scripts/generate-prefecture-shapes.mjs package/src/japan.json
//
// 元データ: japanmap 1.0.4 (MIT, Copyright (c) 2024 The JapanMap Authors)
//   https://github.com/daikiejp/japanmap
//
// **ランタイム依存としては入れない。** 描画は自前でやるのでライブラリ本体は不要で、
// 入れると React の peer dependency と classnames が付いてくる。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../src/event/prefecture-shapes.ts");

/** 元データの viewBox。図形の座標系はこれを前提にしている。 */
const SOURCE_VIEW_BOX = { x: 200, y: 0, width: 600, height: 650 };

/**
 * path をサブパスの点列へ分解する。
 *
 * 元データのコマンドは `M m L l Z z` だけで、曲線を含まない（生成時に検証する）。
 * 曲線が入るデータへ差し替えるならここを書き直すこと。
 */
function toSubpaths(d) {
  const out = [];
  let current = null;
  let x = 0;
  let y = 0;
  let mode = null;
  const nums = [];

  const flush = () => {
    if (!mode || nums.length === 0) return;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const isMove = mode === "M" || mode === "m";
      if (mode === "M") {
        x = nums[i];
        y = nums[i + 1];
      } else if (mode === "m") {
        x += nums[i];
        y += nums[i + 1];
      } else if (mode === "L") {
        x = nums[i];
        y = nums[i + 1];
      } else {
        x += nums[i];
        y += nums[i + 1];
      }
      // 連続する M の2組目以降は暗黙の L として扱う(SVG の仕様)。
      if (isMove && i === 0) {
        current = [];
        out.push(current);
      }
      current?.push([x, y]);
    }
    nums.length = 0;
  };

  for (const token of d.matchAll(/([A-Za-z])|(-?\d*\.?\d+)/g)) {
    if (token[1]) {
      flush();
      if (token[1] === "z" || token[1] === "Z") {
        mode = null;
        continue;
      }
      mode = token[1];
    } else {
      nums.push(Number(token[2]));
    }
  }
  flush();

  return out.filter((s) => s.length >= 3);
}

/** 靴ひも公式。向きは問わないので絶対値で返す。 */
function area(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function boundingBox(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

const round = (v) => Math.round(v * 10) / 10;

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("使い方: node scripts/generate-prefecture-shapes.mjs <japan.json のパス>");
    process.exit(1);
  }

  const source = JSON.parse(readFileSync(input, "utf8"));
  if (source.length !== 47) {
    throw new Error(`47件でないデータは受け付けない: ${source.length}件`);
  }

  const commands = new Set();
  for (const row of source) for (const m of row.path.matchAll(/[A-Za-z]/g)) commands.add(m[0]);
  const unsupported = [...commands].filter((c) => !"MmLlZz".includes(c));
  if (unsupported.length > 0) {
    throw new Error(`未対応のパスコマンドが入っている: ${unsupported.join(" ")}`);
  }

  const shapes = source.map((row) => {
    const code = row.id.replace(/^JP/, "");
    if (!/^\d{2}$/.test(code)) throw new Error(`id からコードを取れない: ${row.id}`);

    const subpaths = toSubpaths(row.path);
    if (subpaths.length === 0) throw new Error(`${row.kanji}: パスを解釈できない`);

    // 代表点は「最大面積のサブパス」のバウンディングボックス中心。
    // 離島が多い県(東京9 / 長崎12 / 鹿児島13 / 沖縄28)でも本島が最大になる。
    const main = subpaths.reduce((a, b) => (area(b) > area(a) ? b : a));
    const box = boundingBox(main);

    return {
      code,
      name: row.kanji,
      path: row.path,
      cx: round((box.minX + box.maxX) / 2),
      cy: round((box.minY + box.maxY) / 2),
      width: round(box.maxX - box.minX),
      height: round(box.maxY - box.minY),
    };
  });

  const body = shapes
    .map(
      (s) =>
        `  {\n    code: "${s.code}",\n    name: "${s.name}",\n` +
        `    cx: ${s.cx},\n    cy: ${s.cy},\n    width: ${s.width},\n    height: ${s.height},\n` +
        `    path: "${s.path}",\n  },`
    )
    .join("\n");

  const file = `// 日本地図の図形。**自動生成。手で編集しない。**
//
// 生成: node scripts/generate-prefecture-shapes.mjs <japan.json のパス>
// 元データ: japanmap 1.0.4 の src/japan.json
//   MIT License, Copyright (c) 2024 The JapanMap Authors
//   https://github.com/daikiejp/japanmap
//
// code は JIS X 0401 の上2桁("01".."47")で、EventTeam.prefectureCode と同じもの。
// cx / cy は最大面積のサブパス(=本島)のバウンディングボックス中心で、順位バッジの位置に使う。
// width / height も同じサブパスのもの。県の中に何を置けるかの判断に使う。

export type PrefectureShape = {
  code: string;
  name: string;
  /** 順位バッジを置く位置(最大サブパスの中心) */
  cx: number;
  cy: number;
  /** 最大サブパスの大きさ。県内に描けるかの判断に使う */
  width: number;
  height: number;
  path: string;
};

/** 元データの座標系。図形はこの viewBox を前提にしている。 */
export const SOURCE_VIEW_BOX = ${JSON.stringify(SOURCE_VIEW_BOX)};

export const PREFECTURE_SHAPES: PrefectureShape[] = [
${body}
];

const BY_CODE = new Map(PREFECTURE_SHAPES.map((s) => [s.code, s]));

export function findShape(code: string): PrefectureShape | null {
  return BY_CODE.get(code) ?? null;
}
`;

  writeFileSync(OUT, file, "utf8");
  console.log(`${OUT} を書いた (${shapes.length}件 / ${Math.round(file.length / 1024)}KB)`);
}

main();
