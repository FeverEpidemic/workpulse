# syntax=docker/dockerfile:1
#
# Two images from one file:
#   docker build --target web    -t workpulse-web .
#   docker build --target worker -t workpulse-worker .
# No secret or NEXT_PUBLIC_* value is passed at build time: every environment supplies
# its configuration when the container starts, so one image serves staging and production.

ARG NODE_IMAGE=node:24.18.0-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.19.0 && npm cache clean --force
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

FROM base AS deps
RUN pnpm install --frozen-lockfile

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

FROM deps AS build
COPY . .
# public/ is optional in the repository; the runtime stage always copies it.
RUN mkdir -p public && WORKPULSE_STANDALONE=1 pnpm build

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node workers ./workers
COPY --chown=node:node src ./src
USER node
CMD ["node", "workers/run.ts"]
