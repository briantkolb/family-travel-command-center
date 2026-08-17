FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS production-dependencies
WORKDIR /app
COPY runtime/package.json runtime/package-lock.json ./
RUN npm ci && npm cache clean --force

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV APP_INTERNAL_PORT=3001
ENV HOST=0.0.0.0
ENV APP_INTERNAL_HOST=127.0.0.1
ENV DATA_DIR=/data

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/server.mjs ./server.mjs
COPY --from=builder --chown=node:node /app/lib ./lib
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/app/data/trip.json ./app/data/trip.json
COPY --from=builder --chown=node:node /app/app/data/packing.json ./app/data/packing.json

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.mjs"]
