FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package*.json ./
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

CMD ["sh", "-c", "echo \"[startup] PORT=$PORT\" && npx tsx scripts/migrate-shared-tiktok-room.ts && npx tsx scripts/migrate-match-session.ts && npx prisma db push --accept-data-loss && npx tsx scripts/migrate-match-battle-candidates.ts && node server.js"]
