#!/bin/sh
# Run a heavy gate command (make ci, make test-conformance, make smoke) while holding the one shared
# lock, so parallel agents don't exhaust the machine's 36 GB. Usage, from your compiler/ dir:
#   /Users/er/Documents/Projects/v12-class/gate.sh make test-conformance
# It waits for the lock, prints who holds it while waiting, and releases it on exit or interrupt.
LOCK=/Users/er/Documents/Projects/v12-class/.gate.lock
while ! mkdir "$LOCK" 2>/dev/null; do
  holder=$(cat "$LOCK/owner" 2>/dev/null)
  pid=${holder%% *}
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    rm -rf "$LOCK"   # the holder died without releasing
    continue
  fi
  echo "gate.sh: waiting for the lock held by: $holder" >&2
  sleep 30
done
echo "$$ $(pwd) $*" > "$LOCK/owner"
trap 'rm -rf "$LOCK"' EXIT INT TERM
"$@"
