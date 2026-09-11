# 管理画面worker監視一覧に署名消費列を追加 - 作業ログ

**対応した計画**: `C:\dev\live-sidestage\.claude\plans\20260911-admin-workers-signature-consumption-columns.md`

## 実装したステップ

### Batch 02: 列1「署名消費（24時間）」の追加 (完了)

Risk: MEDIUM | Worker: worker-normal

#### 実装内容
1. **AssignedRoom型** (worker-status.ts 61-80行)
   - `signatureUsage24hCount: number | null` を追加
   - コメント: "includeSignatureUsage24h未指定時はnull(「0件」と区別するため)"

2. **fetchAdminRoomList関数** (worker-status.ts 204-261行)
   - オプションに `includeSignatureUsage24h?: boolean` を追加
   - 既存の週間集計（233-241行）に続いて、24時間版集計を実装:
     ```ts
     const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
     const grouped24h = await prisma.eulerSignUsage.groupBy({
       by: ["roomId"],
       where: { roomId: { in: rooms.map((r) => r.id) }, createdAt: { gte: oneDayAgo } },
       _count: { _all: true },
     });
     const usage24hByRoomId = new Map(grouped24h.map((g) => [g.roomId, g._count._all]));
     ```
   - rooms.map結果へ `signatureUsage24hCount: usage24hByRoomId ? usage24hByRoomId.get(r.id) ?? 0 : null` を追加

3. **route.ts** (src/app/api/admin/workers/route.ts 50行)
   - fetchAdminRoomList呼び出しへ `includeSignatureUsage24h: true` を追加

4. **sort-rooms.ts** (src/app/(dashboard)/admin/workers/sort-rooms.ts)
   - RoomSortKeyに `"signatureUsage24hCount"` を追加
   - 既存のweeklyEulerSignUsageCount比較ブロックと同型の比較ロジックを追加

5. **page.tsx** (src/app/(dashboard)/admin/workers/page.tsx)
   - テーブルヘッダーに新列を追加（「週間署名消費」列の直後）:
     - 見出し: 「署名消費(24時間)」
     - 注記: 「成功/失敗含む・現在のroomId基準」
     - ソートボタン対応
   - テーブルセルに新列を追加

6. **テスト追加** (src/lib/worker-status.integration.test.ts 252-291行)
   - `includeSignatureUsage24h未指定時はsignatureUsage24hCountがnull` - ✓
   - `includeSignatureUsage24h:trueかつ署名消費0件ならsignatureUsage24hCountは0(nullでない)` - ✓
   - `includeSignatureUsage24h:trueで直近24時間以内(ちょうど24時間前を含む)の署名消費を数え、25時間前は含めない` - ✓

7. **テストモック更新**
   - sort-rooms.test.ts, worker-status.test.ts, worker-guardian.test.ts, worker-guardian.cycle.test.ts の room/roomOverrides 関数に `signatureUsage24hCount: null` を追加

## 主な変更ファイル

- `src/lib/worker-status.ts` - 型・集計ロジック
- `src/lib/worker-status.integration.test.ts` - 統合テスト追加
- `src/lib/worker-status.test.ts` - モック更新
- `src/app/api/admin/workers/route.ts` - API呼び出しオプション
- `src/app/(dashboard)/admin/workers/sort-rooms.ts` - ソートロジック
- `src/app/(dashboard)/admin/workers/sort-rooms.test.ts` - モック更新
- `src/app/(dashboard)/admin/workers/page.tsx` - テーブル列追加
- `src/lib/worker-guardian.test.ts` - モック更新
- `src/lib/worker-guardian.cycle.test.ts` - モック更新

## 実施した検証

### 1. 型チェック
```bash
npm run typecheck
```
**結果**: ✓ 通過（Batch 02に関する型エラーなし）
- 残存エラーは全てBatch 01（lastCollabSourceRoomId）に関連

### 2. ユニットテスト
```bash
npx vitest run --exclude "**/*.integration.test.ts"
```
**結果**: ✓ 116 Test Files passed, 1554 Tests passed

### 3. 統合テスト（worker-status）
```bash
npx dotenv -e .env.local.test -- vitest run src/lib/worker-status.integration.test.ts
```
**結果**: ✓ 1 Test File passed, 16 Tests passed

### 4. ユニットテスト（sort-rooms）
```bash
npx vitest run src/app/\(dashboard\)/admin/workers/sort-rooms.test.ts
```
**結果**: ✓ 1 Test File passed, 6 Tests passed

### 5. 統合テスト全体（ローカルDB）
pre-commit hookによる検証:
- `npm run test:unit` - ✓ 116 files, 1554 tests passed
- `npm run test:integration` - ✓ 101 files, 960 tests passed

### 6. ローカルDB反映
```bash
npm run db:push:local
```
**結果**: ✓ スキーマ同期成功

## 作成したcommit

- **bf14ba08**: `feat: 管理画面worker監視一覧に署名消費(24時間)列を追加`
  - Batch 02の全変更を含むシングルcommit
  - pre-commit hook検証全てpass

## 計画との差異

差異なし。計画ファイルの「Batch 02: 列1「署名消費（24時間）」の追加」セクション（199-251行）の要件を完全に実装。

## 未解決事項

なし。Batch 02は完全に完了。

## 注記

- Batch 01（schema変更・tiktok-room.ts修正）は別エージェントが並列実装中
- Batch 02の変更はBatch 01と独立（新規schema不要、既存パターンの複製）
- 計画のBatch 01・Batch 02並列開始・Batch 03順次 の構成に従っている
- 既存の不変条件（Invariants）を全て遵守：
  - fetchAssignedRoomsには触れない（fetchAdminRoomList専用）
  - includeSignatureUsage24h未指定時はnull
  - worker本体への影響なし
  - オンデマンド・インデックス付きクエリのみ
