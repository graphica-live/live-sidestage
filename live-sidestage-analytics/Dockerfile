FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate && npx next build

EXPOSE 3000

CMD ["sh", "-c", "echo \"[startup] PORT=$PORT\" && npx tsx scripts/migrate-shared-tiktok-room.ts && npx tsx scripts/migrate-match-session.ts && npx prisma db push --accept-data-loss && npx tsx scripts/migrate-match-battle-candidates.ts && node server.js"]
