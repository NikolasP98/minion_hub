#!/usr/bin/env bash
# One-time setup for the Storybook site on Cloudflare: Pages project, custom domain,
# DNS record and a Cloudflare Access policy over every hostname that serves it
# (custom domain, production pages.dev and preview *.pages.dev), so none stays public.
#
# Usage: scripts/ops/storybook-cloudflare-setup.sh you@example.com [more@example.com ...]
# Token: CLOUDFLARE_API_TOKEN, or the first line of ~/.config/minion/cloudflare-storybook.token.
# Token permissions: Account › Cloudflare Pages: Edit, Account › Access: Apps and Policies: Edit,
# Account › Account Settings: Read, Zone (minion-ai.org) › DNS: Edit.
# Idempotent: existing project/domain/record/app are reused, the app's policy is replaced.
set -euo pipefail

PROJECT=minion-components
ZONE_NAME=minion-ai.org
HOST=components.$ZONE_NAME
API=https://api.cloudflare.com/client/v4

(($# > 0)) || { echo "usage: $0 email [email ...]" >&2; exit 2; }
TOKEN=${CLOUDFLARE_API_TOKEN:-$(head -n1 "$HOME/.config/minion/cloudflare-storybook.token" 2>/dev/null || true)}
[[ -n $TOKEN ]] || { echo "no CLOUDFLARE_API_TOKEN and no token file" >&2; exit 2; }

# Token stays off argv: curl reads the header from a here-string config.
cf() {
  local method=$1 path=$2 body=${3:-}
  local args=(-sS -X "$method" "$API$path" -H 'Content-Type: application/json' -K -)
  [[ -n $body ]] && args+=(--data "$body")
  curl "${args[@]}" <<<"header = \"Authorization: Bearer $TOKEN\""
}
ok() { python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("success") else 1)'; }
field() { python3 -c "import json,sys; d=json.load(sys.stdin); r=d['result']; r=(r[0] if r else None) if isinstance(r,list) else r; print(r$1 if r else '')"; }

ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-$(cf GET /accounts | field "['id']")}
ZONE_ID=$(cf GET "/zones?name=$ZONE_NAME" | field "['id']")
[[ -n $ACCOUNT_ID && -n $ZONE_ID ]] || { echo "account or zone not visible to this token" >&2; exit 1; }
echo "account $ACCOUNT_ID  zone $ZONE_ID"

# 1. Pages project (direct upload; CI deploys with wrangler).
if cf GET "/accounts/$ACCOUNT_ID/pages/projects/$PROJECT" | ok; then
  echo "pages project exists"
else
  cf POST "/accounts/$ACCOUNT_ID/pages/projects" "{\"name\":\"$PROJECT\",\"production_branch\":\"main\"}" | ok
  echo "pages project created"
fi

# 2. Custom domain on the project + proxied CNAME.
cf POST "/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/domains" "{\"name\":\"$HOST\"}" >/dev/null || true
REC_ID=$(cf GET "/zones/$ZONE_ID/dns_records?name=$HOST" | field "['id']")
REC="{\"type\":\"CNAME\",\"name\":\"$HOST\",\"content\":\"$PROJECT.pages.dev\",\"proxied\":true,\"comment\":\"Storybook (Cloudflare Pages)\"}"
if [[ -n $REC_ID ]]; then cf PUT "/zones/$ZONE_ID/dns_records/$REC_ID" "$REC" | ok; else cf POST "/zones/$ZONE_ID/dns_records" "$REC" | ok; fi
echo "dns $HOST -> $PROJECT.pages.dev"

# 3. Access application over every hostname, allow-list of emails.
cf GET "/accounts/$ACCOUNT_ID/access/organizations" | ok || {
  echo "Zero Trust is not enabled on this account: open dash.cloudflare.com > Zero Trust once, pick a team name and the Free plan, then rerun." >&2
  exit 1
}
INCLUDE=$(python3 -c 'import json,sys; print(json.dumps([{"email":{"email":e}} for e in sys.argv[1:]]))' "$@")
APP=$(python3 - "$HOST" "$PROJECT" "$INCLUDE" <<'PY'
import json, sys
host, project, include = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
print(json.dumps({
    "name": "Minion components (Storybook)",
    "type": "self_hosted",
    "domain": host,
    "destinations": [
        {"type": "public", "uri": host},
        {"type": "public", "uri": f"{project}.pages.dev"},
        {"type": "public", "uri": f"*.{project}.pages.dev"},
    ],
    "session_duration": "24h",
    "app_launcher_visible": True,
    "policies": [{"name": "Allow listed people", "decision": "allow", "include": include}],
}))
PY
)
APP_ID=$(cf GET "/accounts/$ACCOUNT_ID/access/apps?domain=$HOST" | field "['id']" || true)
if [[ -n $APP_ID ]]; then
  cf PUT "/accounts/$ACCOUNT_ID/access/apps/$APP_ID" "$APP" | ok
  echo "access app updated ($APP_ID)"
else
  cf POST "/accounts/$ACCOUNT_ID/access/apps" "$APP" | ok
  echo "access app created"
fi
echo "allowed: $*"
echo "account id for the CLOUDFLARE_ACCOUNT_ID repo secret: $ACCOUNT_ID"
