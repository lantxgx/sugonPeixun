FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY openapi.yaml ./openapi.yaml
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/app/data MEDIA_DIR=/app/data/media
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "src/server.js"]
