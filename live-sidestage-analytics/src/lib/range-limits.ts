// 1リクエストで集計できる期間の上限(日数)。年間実績を1回で取れるよう366日(うるう年ぶん)にしてある。
// Giftは @@index([roomId, dayKey]) に乗るが、無制限の期間を許すと監視対象ぶんの
// フルスキャンを誘発するため上限自体は残す。
// 呼び出し頻度の制限(レート制限)は未実装なので、この上限が1リクエストあたりの負荷の唯一の歯止め。
//
// 依存先が無い軽量ファイルにしてあるのは、agency/params.ts が tiktok-room.ts 経由で
// Prismaまで読み込む重い依存を持っており、mobile-analytics-query.ts からそこを
// importするのは不自然なため。両者はこの値だけを共有する。
//
// 注意: agency/params.ts の MAX_RANGE_DAYS は「暦日ベース」(YYYY-MM-DD文字列の日数差、両端含む)、
// mobile-analytics-query.ts の custom range は「経過時間ベース」(時刻付きDateの差分ミリ秒)で
// 数え方が異なる。値(366)は同じだが意味は別物であることに注意。
export const MAX_RANGE_DAYS = 366;
