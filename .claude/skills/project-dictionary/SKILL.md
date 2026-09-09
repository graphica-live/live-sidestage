---
name: project-dictionary
description: プロジェクト固有の用語・ID・Entity名・Column名・APIフィールド名・略語・Status/Roleの意味を `docs/project-dictionary.md` で一元管理し、参照と更新の両方を扱う。設計・実装・レビュー中に固有用語の意味を確認したいとき、新しいEntity/Column/型/APIフィールドの名前を決める前に既存概念との重複を確認したいとき、内部IDと外部プラットフォームIDの取り違えを防ぎたいとき、用語の定義や名称が変わったので辞書を更新したいときに使う。一般的な技術用語・一時変数・実装詳細の登録には使わない。
---

# project-dictionary

`docs/project-dictionary.md` がこのプロジェクトの用語辞書。**参照と更新の両方をこのSkillが扱う。**

## 前提: 辞書は「語の正本」であって「事実の全文」ではない

このリポジトリには既に詳細な正本ドキュメントがある。辞書はそれらを**再掲しない**。語 → 正本へのポインタと、混同を防ぐ最小限の定義だけを持つ。

| 知りたいこと | 正本 |
| --- | --- |
| 語の意味・正式名称・別名禁止・内部/外部の別 | `docs/project-dictionary.md`（このSkill） |
| Entityが何を表すか・正本・所有・lifecycle・保存禁止項目 | `docs/architecture/ENTITY_MAP.md` |
| 識別子3語彙の命名規約と改名不可の背景 | `live-sidestage-analytics/CLAUDE.md`「識別子の命名規約」 |
| 列の型・制約 | `prisma/schema.prisma` / `backend/lib/db/store.js` / `TikRIng/migrations/*.sql` |

**辞書と実コードが食い違ったら、どちらかを推測で上書きしない。** 不整合として扱い、実コードを確認したうえで辞書側の記述を直すか、命名規約違反として報告する。辞書は既存コードを無条件に正当化する道具ではなく、採用済みの正式な概念・命名を維持するためのもの。

## 1. 参照するとき

**辞書全体を毎回読み込まない。** 対象の語とその関連語だけを引く。

```bash
grep -n "^## " docs/project-dictionary.md          # 見出し一覧（索引）
grep -n -A 20 "^## principalId$" docs/project-dictionary.md   # 1語だけ読む
```

優先的に引くべき語のカテゴリ:

- ID（内部ID / 外部プラットフォームID / トークン類）
- Entity名 / Table名 / Column名
- DTO / Schema / 型名 / APIフィールド名
- Domain Object / Role名 / Status名 / enum値
- 外部サービス固有の識別子
- プロジェクト独自の略語・製品名

辞書に定義がある語は、**その定義を優先する。** 単語の一般的な意味やAI自身の一般知識だけで固有用語を再解釈しない（例: `Streamer` を「配信者一般」と読まない、`Principal` を認証ライブラリ一般の用語として読まない）。

## 2. 名前を決める前（実装・設計時）

新しいEntity / Column / 型 / 変数 / APIフィールド / JSONキーを作る前に、**同じ意味の既存概念が無いか確認する。**

```bash
grep -n "^## " docs/project-dictionary.md
grep -rn "<候補名>" --include="*.ts" --include="*.prisma" --include="*.dart" --include="*.js"
```

既存概念に別名を新設しない。例: `principalId` があるのに `userId` / `sidestageUserId` / `internalUserId` / `memberId` を同一概念として導入しない。別名が要る合理的理由（外部シリアライズ済みで改名不可、意味が実際に違う等）がある場合は、**既存概念との違いを明示**したうえで辞書へ差分を書く。

## 3. 内部IDと外部IDを混同しない

内部システムのIDと外部プラットフォームのIDは**常に別概念**として扱う。名前が似ていること、値が1対1に見えることを理由に代替可能と判断してはならない。

- `principalId`（sidestage内部） / `tiktokUid`（TikTok発行） / `tiktokHandle`（TikTok・ユーザーが変更可能）
- `roomId`（`TiktokRoom.id`、cuid、内部） / TikTokの配信枠roomId（外部）
- `battleId`（TikTok発行の文字列） / `BattleHistory.id`（内部cuid）

とくに **mutable な外部識別子（`tiktokHandle`）を同一性キーに使わない**。この誤りは例外もログも出ないままデータが割れる。

## 4. 辞書へ追加するとき

追加を検討するのは次の場合だけ。

- 新しいドメイン概念が正式に導入された
- 新しいID体系が導入された
- プロジェクト固有の意味を持つ名称が追加された
- 一般的な意味と異なる使い方をする用語が追加された
- 今後Claudeや開発者が混同する可能性が高い用語が追加された

**コード中に新しい単語が登場しただけでは登録しない。** 一時変数・ローカル変数・一般的な技術用語（`string` / `boolean` / `REST` / `HTTP` / `PostgreSQL` / ライブラリ名）・実装詳細は辞書化しない。

### 追加前の確認（省略しない）

1. 辞書内に既存定義が無いか（見出し一覧をgrep）
2. 類似名称・同義語が無いか（語幹でgrep）
3. 既存Entityに同じ概念が無いか（`ENTITY_MAP.md` §6 Entity Boundary、§3 の重複表）
4. DB Schemaに同義Columnが無いか（`schema.prisma` をgrep）
5. API / DTO / Type に同じ意味のフィールドが無いか
6. 新規概念なのか、既存概念の別名なのか

重複の可能性が残る間は、新規用語として確定しない。

### AIが独断で用語を確定しない

**Claudeが実装中に考案した名称を、そのまま正式なプロジェクト用語として辞書へ登録してはならない。** 例: `creatorId` を思いついても、`principalId` / `streamerId` / `tiktokUid` との関係を確認せずに新概念として追加しない。

辞書へ書いてよいのは次のいずれか。

- ユーザーが採用した名称
- 既にコードへマージ済みで、実コードから事実として確認できる名称
- 既存正本ドキュメント（`ENTITY_MAP.md` / 各CLAUDE.md）に記載済みの名称

いずれにも当たらない候補名は、辞書ではなく実装計画やレビュー報告の中で「提案」として扱う。

## 5. 定義や名称を変えるとき

辞書の文章だけを書き換えて、コードとの意味が乖離する状態を作らない。名称変更の場合は次への影響を確認する。

- Entity / Column / Relation / index・制約
- DTO / Schema / Type / enum
- API のレスポンスキー / リクエストキー
- Test / seed / fixture
- Documentation（各CLAUDE.md / `ENTITY_MAP.md` / `docs/`）

**外部へシリアライズ済みの名前（モバイルJWTのclaim、Stripe metadata、発行済みOBS URL、公開シェアリンク）は改名できない。** 変更する場合は「読み出した直後に内部名へ写す」か「両受け期間を設ける」しかない。背景は `live-sidestage-analytics/CLAUDE.md`「識別子の命名規約」。

## 辞書ファイルの書式

各項目は原則として次の4セクション。混同しやすい重要概念では4つとも埋める。そうでない語は必要なものだけでよい。

```md
## principalId

### Definition
sidestage内部のPrincipalを一意に識別するID。

### Not
- TikTokのユーザーIDではない
- TikTokのhandleではない

### Usage
- 認証・課金・所有の主体の識別

### Naming
正式名称は `principalId`。`userId` 等の別名を新設しない。
```

ID系の語では、重要な場合に次を明記する。

- 誰が発行するIDか（sidestage / TikTok / Stripe / Google / Apple）
- 何を識別するか
- 変更可能か（immutable / mutable）
- 内部IDか外部IDか
- 主キーとして使うか
