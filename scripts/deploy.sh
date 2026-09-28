#!/bin/sh
# Rebuild and restart the persistent instance (launchd: com.amie.macros),
# the one Tailscale serves. `npm run dev` is unaffected.
set -e
cd "$(dirname "$0")/.."
npm run build
launchctl kickstart -k "gui/$(id -u)/com.amie.macros"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sfo /dev/null http://localhost:8210/; then echo "macros: deployed"; exit 0; fi
  sleep 1
done
echo "macros: restarted, but not answering on :8210 -- see ~/Library/Logs/com.amie.macros.log" >&2
exit 1
