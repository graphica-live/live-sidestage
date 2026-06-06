FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npx next build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push && node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
