FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/data/pagerdiem.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# Optional extra CA certificates (e.g. the Amazon RDS bundle); see certs/README.md.
COPY certs ./certs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK CMD wget -qO- "http://localhost:${PORT:-3000}/healthz" || exit 1
CMD ["node", "src/server.js"]
