#!/bin/sh
# xhostd build step: runs once per deploy, as root, with NO env and NO database.
# Every page reads the session cookie, so `next build` renders nothing that
# touches the database; the placeholder URL only keeps imports from throwing.
set -eu
export DATABASE_URL="postgresql://build:build@127.0.0.1:1/build"
export NEXT_TELEMETRY_DISABLED=1

npm ci --include=dev
npx next build

# next start writes its cache under .next/cache as user `app`.
mkdir -p .next/cache
chmod -R a+rwX .next/cache
