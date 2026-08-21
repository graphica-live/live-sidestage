FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npx next build

EXPOSE 3100

# db push はここで実行しない。event スキーマのマイグレーションは event_migrator の接続で
# 手元から明示実行する(README の「デプロイ順序」を参照)。
CMD ["sh", "-c", "echo \"[startup] PORT=$PORT\" && npx next start -p ${PORT:-3100}"]
