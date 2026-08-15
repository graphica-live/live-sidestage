// ギフト履歴の編集機能まわりの純粋ロジック。ルートハンドラから分離してユニットテスト可能にしている。

export type GiftEditInput =
  | { ok: true; giftName: string; totalDiamonds: number }
  | { ok: false; error: string };

export function parseGiftEditInput(body: unknown): GiftEditInput {
  const b = (body ?? {}) as Record<string, unknown>;

  const giftName = typeof b.giftName === "string" ? b.giftName.trim() : "";
  if (!giftName) {
    return { ok: false, error: "ギフト名を入力してください。" };
  }

  const totalDiamonds = Number(b.totalDiamonds);
  if (!Number.isInteger(totalDiamonds)) {
    return { ok: false, error: "コイン数は整数で指定してください。" };
  }

  return { ok: true, giftName, totalDiamonds };
}

export type GiftHistoryRow = {
  giftName: string;
  totalDiamonds: number;
  edit: { giftName: string; totalDiamonds: number } | null;
};

// TikTok受信時点のオリジナル値(giftName/totalDiamonds)はそのまま残し、
// GiftEditが存在する行だけ表示用に上書きする。オリジナルGiftレコード自体は書き換えない。
export function applyGiftEdit<T extends GiftHistoryRow>(
  row: T
): Omit<T, "edit"> & { edited: boolean } {
  const { edit, ...rest } = row;
  return {
    ...rest,
    giftName: edit?.giftName ?? row.giftName,
    totalDiamonds: edit?.totalDiamonds ?? row.totalDiamonds,
    edited: edit !== null,
  };
}
