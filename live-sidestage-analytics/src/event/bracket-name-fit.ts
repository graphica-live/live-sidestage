// トーナメント表のカードに出す出場者名の文字サイズを、名前の長さから決める。
//
// **DOM を測らない。** 公開の表(`BracketTree.tsx`)はサーバーコンポーネントで、全体を
// `BracketScroller` が transform で縮小するだけの構造になっている。クライアントで実寸を
// 測ってから文字サイズを決める方式にすると、表が「等倍で描く → 測る → 縮む」の二段階で
// 動くうえ、カード高さが後から変わってコネクタの幾何(ファイル冒頭のコメントを参照)まで
// 揺れる。代わりに**文字幅を「全角=1 / 半角=0.55」で見積もり**、枠幅を割って求める。
//
// 見積もりなので、ラテン文字が多い名前では数 px ぶん外れる。はみ出しは呼び出し側の
// truncate / line-clamp が受け止める前提で、**枠に収まる側へ倒して**丸める。

/**
 * 名前が使える幅(px)。実寸は 128(カード w-40(160) − p-2.5(20) − サイド枠 px-1.5(12))で、
 * **見積もりの誤差ぶんを引いて 118 にしてある。** 太字の日本語は 1em ちょうどより
 * わずかに広く、実測(6〜7文字の名前)で 128 のままだと末尾が省略記号に化けた。
 */
const NAME_BOX_W = 118;

/** 1行の上限。これ以上大きくすると 1行でも名前枠(NAME_BOX_H)の高さに収まらない。 */
const MAX_ONE_LINE_PX = 22;

/**
 * 2行の上限。名前枠の高さを2行で割った値で、`ONE_LINE_FLOOR_PX` と同じ値になっている
 * のは偶然ではない — 「1行でこれを下回るなら、2行に折ったほうが必ず大きくなる」
 * という関係でこの2つを選んでいる。
 */
const MAX_TWO_LINE_PX = 16;

/** 1行を保つ下限。これを下回るほど長い名前は、縮め続けずに2行へ折る。 */
const ONE_LINE_FLOOR_PX = 16;

/** 2行にしても入りきらない名前の下限。ここまでで止めて、あとは line-clamp で省略する。 */
const MIN_FONT_PX = 9;

/** 半角1文字を全角何文字ぶんとして数えるか。ラテン文字の平均的な字幅。 */
const HALF_WIDTH_UNIT = 0.55;

/** 絵文字1文字ぶん。カラー絵文字は全角より広く出る(実測で名前が省略記号に化けた)。 */
const EMOJI_UNIT = 1.3;

export type BracketNameFit = {
  /** style の fontSize にそのまま入れる px 値。 */
  fontSizePx: number;
  /** 1 なら1行(truncate)、2 なら2行(line-clamp)で描く。 */
  lines: 1 | 2;
};

/**
 * 表示幅を「全角1文字 = 1」で数える。半角とみなすのは ASCII と半角カナ、
 * 絵文字は全角より広い扱い(`EMOJI_UNIT`)で、残りのひらがな・漢字・全角記号は 1。
 *
 * 幅ゼロの合成用コードポイント(異体字セレクタ・ZWJ)は数えない。それ以外の絵文字の
 * ZWJ シーケンスは要素数ぶん数えるので過大評価になるが、その分だけ文字が小さくなる
 * = 枠に収まる側へ倒れる。
 */
export function nameWidthUnits(name: string): number {
  let units = 0;
  for (const ch of name.trim()) {
    const code = ch.codePointAt(0) ?? 0;
    // 異体字セレクタ(U+FE0E/U+FE0F)と ZWJ(U+200D)は単体では幅を持たない。
    if (code === 0xfe0e || code === 0xfe0f || code === 0x200d) continue;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xff61 && code <= 0xff9f)) {
      units += HALF_WIDTH_UNIT;
    } else if (code >= 0x1f000) {
      units += EMOJI_UNIT;
    } else {
      units += 1;
    }
  }
  return units;
}

/**
 * 名前を枠幅いっぱいまで拡げるための文字サイズと行数を返す。
 *
 * `scale` は**枠ごと拡大する倍率**。幅も上限も下限も同じ倍率で動くので、
 * 「カードより一回り大きい枠」(優勝バナー)でも折り返しの判断が変わらない。
 * 呼び出し側は枠の幅と高さを同じ倍率で用意すること。
 */
export function fitBracketName(name: string, scale = 1): BracketNameFit {
  const boxWidth = NAME_BOX_W * scale;
  const maxOneLine = MAX_ONE_LINE_PX * scale;

  const units = nameWidthUnits(name);
  if (units <= 0) return { fontSizePx: round(maxOneLine), lines: 1 };

  const oneLine = boxWidth / units;
  if (oneLine >= ONE_LINE_FLOOR_PX * scale) {
    return { fontSizePx: round(Math.min(maxOneLine, oneLine)), lines: 1 };
  }

  // 2行に折れば1行あたりの幅は半分で済む。端数は切り上げる(奇数長のとき、
  // 文字数の多い側の行がはみ出さないように)。
  const perLine = Math.ceil(units / 2);
  const twoLines = boxWidth / perLine;
  return {
    fontSizePx: round(
      Math.min(MAX_TWO_LINE_PX * scale, Math.max(MIN_FONT_PX * scale, twoLines))
    ),
    lines: 2,
  };
}

/** 0.1px 刻み。CSS の px 値としてこれ以上の精度は意味がない。 */
function round(px: number): number {
  return Math.round(px * 10) / 10;
}
