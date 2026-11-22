FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/data/pagerdiem.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY skills ./skills
# Optional extra CA certificates (e.g. the Amazon RDS bundle); see certs/README.md.
COPY certs ./certs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK CMD wget -qO- "http://localhost:${PORT:-3000}/healthz" || exit 1
CMD ["node", "src/server.js"]
