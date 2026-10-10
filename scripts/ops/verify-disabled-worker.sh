#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo 'disabled_verification_accepts_no_http_status' >&2
  exit 1
fi
service=$1
if systemctl is-enabled --quiet "$service"; then
  echo 'service_enabled' >&2
  exit 1
fi
if systemctl is-active --quiet "$service"; then
  echo 'service_active' >&2
  exit 1
fi
