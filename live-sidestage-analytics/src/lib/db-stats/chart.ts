import { Resvg } from "@resvg/resvg-js";

export type ChartPoint = { label: string; value: number };

const WIDTH = 640;
const HEIGHT = 220;
const PADDING_LEFT = 56;
const PADDING_RIGHT = 16;
const PADDING_TOP = 28;
const PADDING_BOTTOM = 32;

/**
 * 件数推移の折れ線グラフをPNGにレンダリングする(メール本文への埋め込み用)。
 * 外部サービス(quickchart等)に社内テーブル名・件数を送らずに済むよう、
 * SVGを自前で組み立ててresvg-js(WASM、ネイティブビルド不要)でラスタライズする。
 */
export function renderTrendChartPng(title: string, points: ChartPoint[]): Buffer {
  const svg = buildTrendChartSvg(title, points);
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } });
  return resvg.render().asPng();
}

function buildTrendChartSvg(title: string, points: ChartPoint[]): string {
  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  if (points.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
      <text x="${WIDTH / 2}" y="${HEIGHT / 2}" font-size="14" text-anchor="middle" fill="#666">データなし</text>
    </svg>`;
  }

  const values = points.map((p) => p.value);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const range = maxValue - minValue || 1;

  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;
  const toX = (i: number) => PADDING_LEFT + i * stepX;
  const toY = (v: number) => PADDING_TOP + plotHeight - ((v - minValue) / range) * plotHeight;

  const linePoints = points.map((p, i) => `${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(" ");
  const dots = points
    .map((p, i) => `<circle cx="${toX(i).toFixed(1)}" cy="${toY(p.value).toFixed(1)}" r="2.5" fill="#e3342f" />`)
    .join("");

  // ラベルは詰まりすぎないよう最大6件までに間引く(先頭・末尾は必ず含める)。
  const labelIndices = pickLabelIndices(points.length, 6);
  const labels = labelIndices
    .map(
      (i) =>
        `<text x="${toX(i).toFixed(1)}" y="${HEIGHT - 8}" font-size="10" text-anchor="middle" fill="#666">${escapeXml(
          points[i].label
        )}</text>`
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" />
    <text x="${PADDING_LEFT}" y="18" font-size="13" font-weight="bold" fill="#222">${escapeXml(title)}</text>
    <text x="${PADDING_LEFT - 6}" y="${PADDING_TOP + 4}" font-size="10" text-anchor="end" fill="#999">${formatAxisValue(
      maxValue
    )}</text>
    <text x="${PADDING_LEFT - 6}" y="${(PADDING_TOP + HEIGHT - PADDING_BOTTOM).toFixed(1)}" font-size="10" text-anchor="end" fill="#999">${formatAxisValue(
      minValue
    )}</text>
    <line x1="${PADDING_LEFT}" y1="${PADDING_TOP}" x2="${PADDING_LEFT}" y2="${HEIGHT - PADDING_BOTTOM}" stroke="#ddd" />
    <line x1="${PADDING_LEFT}" y1="${HEIGHT - PADDING_BOTTOM}" x2="${WIDTH - PADDING_RIGHT}" y2="${HEIGHT - PADDING_BOTTOM}" stroke="#ddd" />
    <polyline points="${linePoints}" fill="none" stroke="#e3342f" stroke-width="2" />
    ${dots}
    ${labels}
  </svg>`;
}

function pickLabelIndices(count: number, max: number): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}

function formatAxisValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}
