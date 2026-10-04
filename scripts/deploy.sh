#!/bin/sh
# Rebuild and restart the persistent instance (launchd: com.amie.cairn),
# the one Tailscale serves. `npm run dev` is unaffected.
set -e
cd "$(dirname "$0")/.."
npm run build
launchctl kickstart -k "gui/$(id -u)/com.amie.cairn"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sfo /dev/null http://localhost:8210/; then echo "cairn: deployed"; exit 0; fi
  sleep 1
done
echo "cairn: restarted, but not answering on :8210 -- see ~/Library/Logs/com.amie.cairn.log" >&2
exit 1
