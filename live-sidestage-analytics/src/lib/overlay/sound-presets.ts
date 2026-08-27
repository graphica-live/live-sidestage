// タイマー終了音・カウントダウン音・Like通知音のプリセットカタログ。
// **任意URL入力は許可しない**(OBSブラウザソースに外部URLを無条件でfetchさせない)。
// ブラウザからも import されるため import ゼロを保つ。
//
// 音源ファイル本体は public/audio/overlay/ 配下に同梱する想定。このタスクでは
// カタログの型と参照キーだけを用意しており、実ファイルの追加は別途行うこと
// (キーに対応するファイルが無い間は再生時に無音のまま失敗するだけで、他の機能には影響しない)。

export type SoundPreset = {
  key: string;
  label: string;
  url: string;
};

export const SOUND_PRESETS: SoundPreset[] = [
  { key: "chime", label: "チャイム", url: "/audio/overlay/chime.mp3" },
  { key: "bell", label: "ベル", url: "/audio/overlay/bell.mp3" },
  { key: "pop", label: "ポップ", url: "/audio/overlay/pop.mp3" },
];

export function findSoundPreset(key: string | null | undefined): SoundPreset | null {
  if (!key) return null;
  return SOUND_PRESETS.find((p) => p.key === key) ?? null;
}
