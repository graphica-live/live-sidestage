FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npx next build

EXPOSE 3000
ENV PORT=3000

CMD sh -c "npx prisma db push; npx next start -p ${PORT:-3000}"
