// 陣営構成 → ステージの割り方。comp の5バリアントを再現する純関数。
// 縦横比・レーンの置き方は .impeccable/approved/battle-replay/spec.md の契約値。

import type { BattleReplayPayload, ReplayTeam } from "@/lib/battle-replay-contract";

export type StageVariant = "duo" | "trio" | "quad" | "team22" | "one3";

export type StageCell = {
  /** `payload.anchors` の添字。 */
  anchorIndex: number;
  teamIndex: number;
  isSelf: boolean;
  /** 画面右側の枠。カードは右から入り、色帯・名前チップ・順位バッジが左右反転する。 */
  right: boolean;
  /** 縦が足りない枠。カードを下端の1行へ寄せる。 */
  inline: boolean;
  /** 自分より一回り小さい相手カードにする(1vs1 は左右等寸なので false)。 */
  opponentCard: boolean;
  /** アイコンを一段大きくする(自陣が単独で全高を占める枠)。 */
  largeAvatar: boolean;
};

export type StageLayout = {
  variant: StageVariant;
  cells: StageCell[];
  /** 1vs1 だけステージ全幅の2段レーンを使う。 */
  fullWidthLanes: boolean;
};

function flatten(teams: ReplayTeam[]): { anchorIndex: number; teamIndex: number; isSelf: boolean }[] {
  const flat: { anchorIndex: number; teamIndex: number; isSelf: boolean }[] = [];
  let cursor = 0;
  for (const team of teams) {
    for (const _participant of team.participants) {
      flat.push({ anchorIndex: cursor, teamIndex: team.index, isSelf: team.isSelf });
      cursor += 1;
    }
  }
  return flat;
}

type FlatCell = { anchorIndex: number; teamIndex: number; isSelf: boolean };

/** 自陣を先頭へ寄せる(相手同士の順序は保つ)。grid は行優先なので並びがそのまま配置になる。 */
function selfFirst(flat: FlatCell[]): FlatCell[] {
  return [...flat.filter((f) => f.isSelf), ...flat.filter((f) => !f.isSelf)];
}

export function buildStageLayout(payload: BattleReplayPayload): StageLayout {
  const flat = flatten(payload.teams);
  const selfCount = flat.filter((f) => f.isSelf).length;
  const total = flat.length;
  const soloTeams = payload.teams.every((t) => t.participants.length === 1);

  // 1vs1
  if (total === 2 && soloTeams) {
    return {
      variant: "duo",
      fullWidthLanes: true,
      // **左右は配列の並びでなく isSelf で決める。** teams は teamIndex 昇順で自陣が先頭になる
      // 想定だが、そこへ依存すると並びが変わった瞬間に自分が右枠へ回る(気づけない)。
      cells: selfFirst(flat).map((f) => ({
        ...f,
        right: !f.isSelf,
        inline: false,
        opponentCard: false,
        largeAvatar: f.isSelf,
      })),
    };
  }

  // チーム戦(2vs2): 左列=自チーム / 右列=相手チーム。grid は行優先なので交互に並べる
  if (!soloTeams && selfCount === 2 && total === 4) {
    const self = flat.filter((f) => f.isSelf);
    const opponents = flat.filter((f) => !f.isSelf);
    const cells: StageCell[] = [];
    for (let i = 0; i < 2; i++) {
      const s = self[i];
      const o = opponents[i];
      if (s) cells.push({ ...s, right: false, inline: true, opponentCard: false, largeAvatar: false });
      if (o) cells.push({ ...o, right: true, inline: true, opponentCard: true, largeAvatar: false });
    }
    return { variant: "team22", fullWidthLanes: false, cells };
  }

  // チーム戦(1vs3): 左に自陣1枠(全高) + 右に相手3枠
  if (!soloTeams && selfCount === 1 && total === 4) {
    return {
      variant: "one3",
      fullWidthLanes: false,
      cells: selfFirst(flat).map((f) => ({
        ...f,
        right: !f.isSelf,
        inline: !f.isSelf,
        opponentCard: !f.isSelf,
        largeAvatar: f.isSelf,
      })),
    };
  }

  // 3コラボ: 左に縦長1枠(全高) + 右に上下2枠
  if (total === 3) {
    return {
      variant: "trio",
      fullWidthLanes: false,
      cells: selfFirst(flat).map((f) => ({
        ...f,
        right: !f.isSelf,
        inline: !f.isSelf,
        opponentCard: !f.isSelf,
        largeAvatar: f.isSelf,
      })),
    };
  }

  // 4コラボ(既定)
  return {
    variant: "quad",
    fullWidthLanes: false,
    cells: selfFirst(flat).map((f, i) => ({
      ...f,
      right: i % 2 === 1,
      inline: true,
      opponentCard: !f.isSelf,
      largeAvatar: false,
    })),
  };
}
