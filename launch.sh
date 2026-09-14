#!/bin/sh
# xhostd runtime step: runs at boot as user `app` with the full env. It must
# answer GET / on $XHOST_HTTP_PORT within 120 seconds and exec the server so it
# receives stop signals.
set -eu
cd "$(dirname "$0")"
export NEXT_TELEMETRY_DISABLED=1

# Migrations run here, never in install.sh (the build has no database). A
# failure is fatal: the app cannot serve a single page without its tables, and
# failing the boot keeps the previous deploy running instead.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  node --import tsx scripts/migrate.ts
fi

# Salesforce mirror sync (src/worker/sync-worker.ts): its own process and heap,
# restarted if it ever dies. Off unless SYNC_WORKER=true — only one instance
# per database may run it.
if [ "${SYNC_WORKER:-false}" = "true" ]; then
  (
    while true; do
      node --max-old-space-size="${SYNC_HEAP_MB:-256}" --import tsx src/worker/sync-worker.ts
      echo "[launch] sync worker exited ($?); restarting in 30s"
      sleep 30
    done
  ) &
fi

export NODE_OPTIONS="--max-old-space-size=${WEB_HEAP_MB:-256}"
exec node_modules/.bin/next start -p "$XHOST_HTTP_PORT" -H 0.0.0.0
