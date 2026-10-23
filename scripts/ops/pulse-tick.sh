#!/usr/bin/env bash
set -euo pipefail
# Secrets come from the existing scheduler environment, never URL/query arguments.
: "${CRON_SECRET:?CRON_SECRET is required}"
: "${MINION_PULSE_TICK_URL:?MINION_PULSE_TICK_URL is required}"
node --input-type=module -e '
const url=new URL(process.env.MINION_PULSE_TICK_URL);
if(url.pathname!=="/api/pulse/tick" || url.search || url.hash || url.username || url.password || !(url.protocol==="https:" || (url.protocol==="http:" && ["127.0.0.1","[::1]"].includes(url.hostname))))process.exit(2);
'
# Authorization is supplied via stdin config: it never appears in the process argument list.
if [[ "$CRON_SECRET" == *$'\n'* || "$CRON_SECRET" == *$'\r'* || "$CRON_SECRET" == *'"'* || "$CRON_SECRET" == *'\'* ]]; then
  exit 2
fi
printf 'header = "Authorization: Bearer %s"\n' "$CRON_SECRET" |
  curl --config - --silent --show-error --fail --max-time 55 --connect-timeout 5 --request GET "$MINION_PULSE_TICK_URL"
