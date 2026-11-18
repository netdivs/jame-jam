# Production image for Jame Jam ERP (Next.js + Prisma).
# Two stages: build as root, then run as the unprivileged "node" user (TS-02). The runtime keeps the dev
# dependencies because `prisma migrate deploy` (on start) and `tsx` (the jobs service) need them.
FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
USER node
EXPOSE 3000
# Apply pending migrations, then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
