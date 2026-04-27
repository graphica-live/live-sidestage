FROM node:20-slim

WORKDIR /app

# 依存関係のインストールをキャッシュさせる
COPY package*.json ./
RUN npm install

COPY . .

# Docker上では backend を既定で起動
CMD ["npm", "run", "backend:start"]