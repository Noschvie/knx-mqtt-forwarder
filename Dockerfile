FROM node:26-alpine AS base
WORKDIR /app

RUN apk add --no-cache tzdata

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 8070

CMD ["node", "src/index.js"]
