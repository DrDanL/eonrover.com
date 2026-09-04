FROM node:20-bullseye-slim AS base
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci || npm ci

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN npm run build --workspace @eonrover/shared \
  && npx prisma generate --schema apps/api/prisma/schema.prisma \
  && npm run build --workspace @eonrover/worker

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/worker ./apps/worker
WORKDIR /repo/apps/worker
CMD ["node", "dist/index.js"]
