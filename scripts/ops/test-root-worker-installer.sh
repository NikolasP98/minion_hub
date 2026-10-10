#!/bin/sh
set -eu

created_node_link=0
cleanup() {
  if [ "$created_node_link" -eq 1 ]; then sudo rm -f /usr/bin/node; fi
}
trap cleanup EXIT HUP INT TERM

if [ ! -e /usr/bin/node ] && [ ! -L /usr/bin/node ]; then
  sudo ln -s "$(command -v node)" /usr/bin/node
  created_node_link=1
fi
test "$(/usr/bin/node -p 'process.version+":"+process.versions.modules')" = \
  "$(node -p 'process.version+":"+process.versions.modules')"
sudo --preserve-env=PATH /usr/bin/node --test \
  --test-name-pattern='root installer' scripts/ops/notification-worker-artifact.test.mjs
