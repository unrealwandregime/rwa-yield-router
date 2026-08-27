# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

FROM ${NODE_IMAGE} AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:${PATH}

WORKDIR /workspace

RUN npm install --global pnpm@11.14.0

COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter @rwa-yield-router/worker... build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @rwa-yield-router/worker deploy --prod --legacy /output/worker

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    WORKER_ENABLED=true \
    WORKER_PORT=3001

WORKDIR /app

RUN apk upgrade --no-cache libcrypto3=3.5.8-r0 libssl3=3.5.8-r0 && \
    rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack

COPY --from=build --chown=node:node /output/worker ./

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.WORKER_PORT||'3001')+'/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "dist/main.js"]
