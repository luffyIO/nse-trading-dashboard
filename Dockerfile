FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js config.js index.html styles.css script.js strategy-engine.js ./

USER node
EXPOSE 3000

CMD ["node", "server.js"]
