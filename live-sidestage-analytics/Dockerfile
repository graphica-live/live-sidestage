FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npx next build

EXPOSE 3000

CMD ["sh", "-c", "echo \"[startup] PORT=$PORT\" && npx prisma db push --accept-data-loss && node server.js"]
