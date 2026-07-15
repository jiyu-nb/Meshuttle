FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV DATA_DIR=/data HOST=0.0.0.0 PORT=8787
EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1

CMD ["node", "src/server.js"]

