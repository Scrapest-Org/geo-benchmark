FROM oven/bun:1.3.9 AS base
WORKDIR /app

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
COPY packages/ /temp/dev/packages/
COPY apps/ /temp/dev/apps/
RUN find /temp/dev -type f -not -name "package.json" -not -name "bun.lock" -delete
RUN cd /temp/dev && bun install --frozen-lockfile

FROM base AS release
WORKDIR /app
COPY --from=install /temp/dev/node_modules ./node_modules
COPY package.json .
COPY packages/ ./packages
COPY apps/web_push/src/ .

ENV NODE_ENV=production

USER bun
ENTRYPOINT [ "bun", "run", "main.ts" ]