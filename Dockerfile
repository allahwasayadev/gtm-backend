# ---------- Stage 1: install + build ----------
# Base pinned to the exact version already present in ECR so unchanged base
# layers are reused on push. Bump deliberately, not implicitly via :20-alpine.
FROM node:20.20.1-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY prisma ./prisma/
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src/
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# ---------- Stage 2: production image ----------
FROM node:20.20.1-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl tini
ENV NODE_ENV=production

# Copy only what we need
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/package.json ./

EXPOSE 3001

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
