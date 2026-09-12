# TikTok スーパーファン判別（live-sidestage）

実配信 probe（@yu_ki_nojo）と配信者ラベル照合で確定した判別ロジックの説明書。
TikTok 側の生データの正本は `~/.cursor/skills/tiktok-probe/KNOWLEDGE.md`「スーパーファン判別 — 確定」。

## 判定ロジック

### 配信中（コメント・ギフト）

connector が平坦化した `chat` / `gift` イベントに残るフィールドを使う。

| 判定 | 条件 |
| --- | --- |
| スーパーファン (SF) | `userIdentity.isSubscriberOfAnchor === true` かつ `publicAreaMessageCommon.portraitInfo.portraitTag` に `ttlive_ls_msgGroups_viewerLabel_subForMo` |
| 非スーパーファン (NSF) | `userIdentity.isSubscriberOfAnchor === false` かつ 同 `portraitTag` に `ttlive_ls_msgGroups_viewerLabel_notSub` |

**使わない:** 平坦化後の `isSubscriber` / `userBadges` / `teamMemberLevel`（実測では SF 判別に使えない）。

実装: `live-sidestage-analytics/src/lib/super-fan-status.ts` の `resolveSuperFanStatus()`。

### 入室（SF 加入バナー）

| 判定 | `WebcastBarrageMessage` の `content.displayType` |
| --- | --- |
| SF 加入 | `ttlive_superFan` を含む（例: `ttlive_superFan_commentNotif_superFanJoined`） |
| 通常ファンクラブ入室のみ | `pm_mt_fan_live_join`（**SF ではない**） |

本人: `schema` の `user_id=...`。connector は `superFan` イベントも emit する。

## analytics がモバイルへ出すもの

| socket イベント | 内容 |
| --- | --- |
| `chat:comment` | 判定可能時のみ `isSuperFan: boolean` を付与 |
| `chat:gift` | 同上 |
| `chat:superFanJoin` | SF 加入バナー（`schemaVersion` + `tiktokUid` + `barrageDisplayType` 等） |

`CHAT_EVENT_SCHEMA_VERSION` は据え置き（optional フィールド追加のみ）。旧アプリは `isSuperFan` / `chat:superFanJoin` を無視する。

## コード位置

- 判別: `src/lib/super-fan-status.ts`
- listener 付与・入室通知: `src/lib/tiktok-listener.ts`
- socket 配信: `src/lib/chat-feed.ts`
- Worker→Web 転送: `src/app/api/internal/gift-event/route.ts`（`chatSuperFanJoinEvent`）

## 限界

- コメントもギフトも送らない視聴者は、配信中イベントだけでは SF/NSF を判定できない。
- 既存 SF の再入室で `ttlive_superFan_*` バナーが毎回出るかは未確認（probe 知見の「未確認」）。
