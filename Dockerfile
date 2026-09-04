FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# The host/BuildKit environment may set NODE_ENV=production. The build stage
# still needs TypeScript and the other dev-only build tools; runtime remains
# production-only in the final stage below.
RUN npm ci --include=dev
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine
RUN apk add --no-cache curl procps
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config
COPY --from=build /app/migrations ./migrations
RUN mkdir -p /app/work/runtime && chown -R node:node /app
USER node
CMD ["sh", "-c", "node dist/scripts/migrate.js && exec node dist/src/http/server.js"]
