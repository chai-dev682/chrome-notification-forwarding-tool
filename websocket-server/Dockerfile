FROM node:18-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Production image ---
FROM node:18-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js ./

USER appuser

EXPOSE 8080

ENV NODE_ENV=production

CMD ["node", "server.js"]
