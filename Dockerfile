FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV APP_INTERNAL_PORT=3001
ENV HOST=0.0.0.0
ENV APP_INTERNAL_HOST=127.0.0.1
ENV DATA_DIR=/data
COPY --from=builder /app ./
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000
CMD ["npm", "start"]
