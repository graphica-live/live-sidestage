# 初ギフト倍率の逆算をギフト完全性でゲートした判断

- date: 2026-09-07
- feature: battle-replay（初ギフト倍率の逆算 / 再生UI）
- risk: HIGH（赤帯は「事実」としてユーザーに提示される値のため）
- reviewers: Codex（`--reasoning-effort low`）/ DeepSeek V4 Flash

## 変更の要点

`inferOpeningMultiplier` へ渡すギフトを `captureStatus === "complete"` の participant のものだけに絞った。

## なぜ

公式スコアの増分（`armies`）は自room由来なので欠けないが、ギフト明細は途中接続・切断で
**一部だけ**欠けうる。欠けたギフトで増分を割ると比が過大に出る。同額ギフトが2連投された区間で
1件しか観測できていなければ `ratio` はちょうど 2.0 になり、同じ欠落が2区間で起きると
候補2件が一致して `measured`（＝赤帯）へ昇格する。**「全欠落」ではなく「部分欠落」が危険**という
非自明な指摘で、Codex の finding を実コードで照合して採用した。

本番（read-only）での影響: HIMEKA のバトルは `measured/2` → `inferred/2` へ降格。
直近200バトルで `measured` が 53 → 48 件。

## 残るリスク

1. **保存済み `captureStatus` は古い行では陳腐化している。** `refineCaptureWithOfficialScore` を入れた
   ea1a636（2026-09-07）より前に確定したバトルは、実際には `complete` 相当でも `partial` のまま保存されている。
   再計算すると HIMEKA の4 anchor はすべて `complete` になる。**保存値を使い続ける方針をユーザーが選択済み**
   なので、古いバトルは `inferred` 止まりになる（赤帯が出ない側に倒れるので安全側）。
2. **タップポイントを差し引いていない。** リスナーは10タップごとに3ポイントをギフト無しで加算できるため、
   `scoreDelta = ギフト × 倍率 + タップポイント` であり、現行の `RATIO_TOLERANCE = 0.02` は
   タップする視聴者が数人いるだけで破れる（例: `406 / 200 = 2.03` は実際に棄却された）。
   恒久対応として、ファースト区間のタップを両陣営の room で計測して
   `TiktokBattle` へ丸めて保存する別PRを予定（自room・相手roomとも同じ `battleId` の行を持つことを本番で実測済み）。
