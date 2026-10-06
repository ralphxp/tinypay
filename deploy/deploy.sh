#!/usr/bin/env bash
# Redeploy script — run this ON THE SERVER from the project root (~/tinypay).
# First deploy: see DEPLOY.md for the one-time server setup this assumes
# (Node, pnpm, pm2, nginx, certbot, and a filled-in .env already in place).
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Pulling latest..."
git pull --ff-only

echo "==> Installing dependencies..."
pnpm install --frozen-lockfile

echo "==> Applying database migrations..."
pnpm exec prisma migrate deploy

echo "==> Building..."
pnpm run build

echo "==> Reloading (zero-downtime if already running, starts fresh otherwise)..."
pm2 reload deploy/ecosystem.config.cjs --update-env || pm2 start deploy/ecosystem.config.cjs

pm2 save
echo "==> Done. pm2 status:"
pm2 status
