#!/bin/sh
set -eu

unit="minion-notification-disabled-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}.service"
marker="/run/${unit}.approved"
runtime=${unit%.service}
sentinel="/run/$runtime/started"
test_unit="/run/systemd/system/$unit"
cleanup() {
  sudo systemctl stop "$unit" 2>/dev/null || true
  sudo rm -f "$test_unit" "$marker"
  sudo rm -rf "/run/$runtime"
  sudo systemctl daemon-reload
}
trap cleanup EXIT HUP INT TERM
sed -e "s|ConditionPathExists=.*|ConditionPathExists=$marker|" \
    -e 's|^Type=.*|Type=oneshot|' \
    -e "s|^User=.*|User=$USER|" -e "s|^Group=.*|Group=$(id -gn)|" \
    -e "/^Group=/a RuntimeDirectory=$runtime" \
    -e "/^Group=/a RuntimeDirectoryPreserve=yes" \
    -e '/^LoadCredential=/d' \
    -e "s|^ExecStart=.*|ExecStart=/usr/bin/touch $sentinel|" \
    deploy/systemd/minion-hub-notification-worker.service | sudo tee "$test_unit" >/dev/null
sudo systemctl daemon-reload
sudo systemctl start "$unit"
test ! -e "$sentinel"
test "$(systemctl is-enabled "$unit" 2>&1 || true)" = static
test "$(systemctl is-active "$unit" 2>&1 || true)" = inactive
sudo touch "$marker"
sudo systemctl start "$unit"
test -e "$sentinel"
