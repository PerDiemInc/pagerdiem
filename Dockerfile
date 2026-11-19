FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/data/pagerdiem.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "src/server.js"]
