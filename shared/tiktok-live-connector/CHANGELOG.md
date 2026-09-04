# Changelog

live-sidestage 内製 fork (`TLC-sidestage`)。本家 `zerodytrash/TikTok-Live-Connector` からの改造版。
バージョンは本家のバージョン体系から独立した、この fork 独自の semver。

## 1.1.0 - 2026-09-05

- `WebcastLinkLayerMessage`(コラボ/linkMicの参加・離脱通知)に `legacy-client.ts` の case を追加し、
  `WebcastPushConnection` から `linkLayer` イベントとして発火するようにした。スキーマ自体は既存
  (`types/tiktok-schema.ts`)だが case が無く、これまで `decodedData` 経由でしか拾えなかった
  (`linkMicBattleTask` / `linkMicBattleItemCard` と同種の未対応漏れ)

## 1.0.0 - 2026-09-04

- パッケージ名を `tiktok-live-connector`(本家と同名) から `TLC-sidestage` に改名
- バージョン体系を本家追従(`2.1.1-betaN`)から fork 独自の semver に切り替え、`1.0.0` から開始
- 改名時点で analytics / desktop / TikCaption 全プロジェクトの vendor tarball を本改名前の最新版(旧 `2.1.1-beta3` 相当)に統一
