#!/bin/sh
set -eu

created_node_link=0
created_node_target=
created_node_identity=
cleanup() {
  status=$?
  if [ "$created_node_link" -eq 1 ]; then
    if [ -L /usr/bin/node ] \
      && [ "$(readlink /usr/bin/node)" = "$created_node_target" ] \
      && [ "$(stat -c '%d:%i' /usr/bin/node)" = "$created_node_identity" ]; then
      sudo rm -f /usr/bin/node
    else
      echo 'temporary_node_link_ownership_lost' >&2
      status=1
    fi
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ ! -e /usr/bin/node ] && [ ! -L /usr/bin/node ]; then
  sudo ln -s "$(command -v node)" /usr/bin/node
  created_node_link=1
  created_node_target=$(readlink /usr/bin/node)
  created_node_identity=$(stat -c '%d:%i' /usr/bin/node)
fi
test "$(/usr/bin/node -p 'process.version+":"+process.versions.modules')" = \
  "$(node -p 'process.version+":"+process.versions.modules')"
sudo --preserve-env=PATH /usr/bin/node --test \
  --test-name-pattern='root installer' scripts/ops/notification-worker-artifact.test.mjs
