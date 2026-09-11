FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package*.json ./
COPY vendor ./vendor
RUN npm ci

COPY . .
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate && npx next build

# server.js のHost allowlist(*.livesidestage.com ワイルドカードDNS対応)は
# NODE_ENV=production でのみ有効になる(devはローカル開発フォールバックとして無効)。
# npm ci/next build より前に置くとdevDependenciesが除外されビルドが壊れるため、
# 実行時にのみ効くようbuild完了後に置く。Railwayダッシュボード側でも設定済みだが、
# それが欠落・誤記された場合にallowlistがfail-openしないよう、イメージ側にも明示する。
ENV NODE_ENV=production

EXPOSE 3000

# migrate-shared-tiktok-room.ts は削除した。2026-08-15 以前の DB 形(Streamer.tiktokId /
# gifts.streamerId)を対象にした一度きりの移行で、識別子統一の reset が全テーブルを
# TRUNCATE する以上、対象は永久に0件になる。
#
# migrate-tiktok-userid-reset.ts も 2026-09-09 の本番 cutover 完了をもって CMD から外した
# (旧形の列 47 件を検出して 57 テーブルを TRUNCATE 済み)。以後は対象が0件でスキップされる
# だけだが、起動のたびに全テーブルを走査するうえ、将来のスキーマ変更で列名が偶然一致すると
# 本番データを TRUNCATE しうるため残さない。スクリプト本体は監査用に scripts/ へ残してある。
#
# prisma db push --accept-data-loss / migrate-match-session.ts / migrate-match-battle-candidates.ts
# は 2026-09-11 に CMD から除去した(prisma migrate deploy 移行、docs/deploy/prisma-migration-runbook.md
# 参照)。スキーマ反映は Railway の Pre-Deploy Command(`npm run predeploy:web`)へ分離し、
# CMD は起動のみを担う。
#
# 【重要】このイメージは baseline(`0_init`)未登録の DB に対しては旧スキーマのまま起動し、
# Prisma クエリが失敗しうる。baseline 未実施の本番環境へこのコードをデプロイしないこと
# (docs/deploy/prisma-migration-runbook.md の「Baseline Registration」節完了が前提)。
CMD ["sh", "-c", "echo \"[startup] PORT=$PORT\" && node server.js"]
