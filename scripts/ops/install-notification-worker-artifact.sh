#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then echo 'installer_requires_root' >&2; exit 1; fi
if [ "$#" -ne 18 ]; then
  echo 'usage: install ARCHIVE MANIFEST MANIFEST_SHA ATTESTATION EXPECTED_ARCHIVE_SHA EXPECTED_LOCK_SHA SOURCE TREE REPOSITORY WORKFLOW WORKFLOW_COMMIT WORKFLOW_SOURCE_COMMIT RUN_ID RUN_ATTEMPT BUILDER_IMAGE DEPENDENCY_IMAGE TRANSLATION_PLUGIN_SHA TARGET_ROOT' >&2
  exit 1
fi
archive=$1 manifest=$2 manifest_sha=$3 bundle=$4 expected_archive=$5 expected_lock=$6
source_commit=$7 source_tree=$8 repository=$9 workflow=${10} workflow_commit=${11}
workflow_source_commit=${12} run_id=${13} run_attempt=${14} builder_image=${15}
dependency_image=${16} translation_plugin_sha=${17} target_root=${18}
service=minion-hub-notification-worker.service

case "$target_root" in /*) ;; *) echo 'target_root_absolute' >&2; exit 1;; esac
secure_dir() {
  directory=$1
  if [ -L "$directory" ]; then echo 'unsafe_ancestry' >&2; exit 1; fi
  if [ -e "$directory" ]; then
    test -d "$directory" || { echo 'unsafe_ancestry' >&2; exit 1; }
    test "$(stat -c %u "$directory")" -eq 0 || { echo 'unsafe_ancestry' >&2; exit 1; }
    mode=$(stat -c %a "$directory")
    case "$mode" in *[2367][0-7]|*[0-7][2367]) echo 'unsafe_ancestry' >&2; exit 1;; esac
  else
    install -d -o root -g root -m 0755 "$directory"
  fi
}
python3 - "$target_root" <<'PY' || { echo 'unsafe_ancestry' >&2; exit 1; }
import os, stat, sys

target = os.path.normpath(sys.argv[1])
if target != sys.argv[1] or not target.startswith('/') or target == '/':
    raise SystemExit(1 if target != '/' else 0)
current = '/'
for component in target.removeprefix('/').split('/'):
    current = os.path.join(current, component)
    info = os.lstat(current)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise SystemExit(1)
PY

secure_control_ancestors() {
  python3 - "$target_root" "$1" <<'PY' || { echo 'unsafe_control_file' >&2; exit 1; }
import os, stat, sys
current = sys.argv[1]
for component in sys.argv[2].split('/')[:-1]:
    current = os.path.join(current, component)
    try:
        info = os.lstat(current)
    except FileNotFoundError:
        break
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise SystemExit(1)
PY
}
secure_optional_file() {
  candidate=$1 expected_mode=$2
  if [ -L "$candidate" ]; then echo 'unsafe_control_file' >&2; exit 1; fi
  if [ -e "$candidate" ]; then
    test -f "$candidate" && test "$(stat -c %u "$candidate")" -eq 0 \
      || { echo 'unsafe_control_file' >&2; exit 1; }
    mode=$(stat -c %a "$candidate")
    if [ -n "$expected_mode" ]; then
      test "$mode" = "$expected_mode" || { echo 'unsafe_control_file' >&2; exit 1; }
    else
      test "$((0$mode & 022))" -eq 0 || { echo 'unsafe_control_file' >&2; exit 1; }
    fi
  fi
}
secure_control_ancestors etc/minion/hub-notification-worker.env
secure_control_ancestors etc/minion/notification-worker.activation-approved
secure_optional_file "$target_root/etc/minion/hub-notification-worker.env" 600
marker="$target_root/etc/minion/notification-worker.activation-approved"
if [ -e "$marker" ] || [ -L "$marker" ]; then echo 'activation_marker_present' >&2; exit 1; fi

secure_dir "$target_root/var"
secure_dir "$target_root/var/lib"
secure_dir "$target_root/var/lib/minion-worker-installer"
verified_inputs=$(mktemp -d "$target_root/var/lib/minion-worker-installer/verify.XXXXXX")
trap 'rm -rf "$verified_inputs"' EXIT HUP INT TERM
install -o root -g root -m 0444 "$archive" "$verified_inputs/archive.tar"
install -o root -g root -m 0444 "$manifest" "$verified_inputs/manifest.json"
install -o root -g root -m 0444 "$bundle" "$verified_inputs/attestation.jsonl"
archive=$verified_inputs/archive.tar
manifest=$verified_inputs/manifest.json
bundle=$verified_inputs/attestation.jsonl
if systemctl is-active --quiet "$service"; then echo 'service_active' >&2; exit 1; fi
test "$(uname -s)" = Linux || { echo 'host_os' >&2; exit 1; }
case "$(uname -m)" in x86_64) host_arch=x64;; aarch64) host_arch=arm64;; *) echo 'host_arch' >&2; exit 1;; esac
printf '%s  %s\n' "${manifest_sha#sha256:}" "$manifest" | sha256sum -c - >/dev/null
node scripts/ops/verify-notification-worker-artifact.mjs \
  --archive="$archive" --manifest="$manifest" --source-commit="$source_commit" \
  --source-tree="$source_tree" --archive-sha256="$expected_archive" --repository="$repository" \
  --lock-sha256="$expected_lock" \
  --manifest-sha256="$manifest_sha" --workflow="$workflow" --workflow-commit="$workflow_commit" \
  --workflow-source-commit="$workflow_source_commit" \
  --run-id="$run_id" --run-attempt="$run_attempt" \
  --builder-image="$builder_image" --dependency-image="$dependency_image" \
  --translation-plugin-sha256="$translation_plugin_sha" \
  --target-os=linux --target-arch="$host_arch" >/dev/null
host_node=$(/usr/bin/node -p 'process.version+" "+process.versions.modules')
manifest_node=$(python3 scripts/ops/validate-worker-archive.py strict-json "$manifest" | \
  node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const m=JSON.parse(s);process.stdout.write(m.nodeVersion+" "+m.nodeAbi+" "+m.targetArch)})')
test "$manifest_node" = "$host_node $host_arch" || { echo 'host_runtime' >&2; exit 1; }
for subject in "$archive" "$manifest"; do
  gh attestation verify "$subject" --repo "$repository" --bundle "$bundle" \
    --signer-workflow "github.com/$repository/$workflow" --source-digest "$workflow_source_commit" \
    --signer-digest "$workflow_commit" \
    --deny-self-hosted-runners >/dev/null
done

digest=${expected_archive#sha256:}
secure_dir "$target_root/opt"
secure_dir "$target_root/opt/minion"
secure_dir "$target_root/opt/minion/hub-notification-worker"
release_root="$target_root/opt/minion/hub-notification-worker/releases"
release="$release_root/$digest"
staging="$release_root/.stage-$digest-$$"
secure_dir "$release_root"
trap 'rm -rf "$staging" "$verified_inputs"' EXIT HUP INT TERM
if [ -e "$release" ] || [ -L "$release" ]; then
  test -d "$release" && test ! -L "$release" || { echo 'occupied_release' >&2; exit 1; }
  test -f "$release/.manifest.json" && test ! -L "$release/.manifest.json" \
    || { echo 'occupied_release' >&2; exit 1; }
  printf '%s  %s\n' "${manifest_sha#sha256:}" "$release/.manifest.json" | sha256sum -c - >/dev/null \
    || { echo 'occupied_release' >&2; exit 1; }
  node scripts/ops/worker-payload-integrity.mjs verify "$release" --require-root-owned \
    || { echo 'occupied_release' >&2; exit 1; }
else
  install -d -o root -g root -m 0755 "$staging"
  WORKER_EXTRACT_ROOT="$staging" python3 scripts/ops/validate-worker-archive.py extract "$archive"
  install -o root -g root -m 0444 "$manifest" "$staging/.manifest.json"
  find "$staging" -type d -exec chmod 0555 {} +
  find "$staging" -type f -exec chmod 0444 {} +
  chmod 0555 "$staging/ops/minion-hub-notification-worker-launcher"
  chmod 0555 "$staging/ops/verify-disabled-worker.sh"
  node scripts/ops/worker-payload-integrity.mjs verify "$staging" --require-root-owned
  mv "$staging" "$release"
fi
secure_dir "$target_root/etc"
secure_dir "$target_root/etc/systemd"
secure_dir "$target_root/etc/systemd/system"
unit_target="$target_root/etc/systemd/system/$service"
unit_created=0
if [ -e "$unit_target" ]; then
  test -f "$unit_target" && test ! -L "$unit_target" \
    && test "$(stat -c %u "$unit_target")" -eq 0 \
    && test "$((0$(stat -c %a "$unit_target") & 022))" -eq 0 \
    || { echo 'unit_unsafe' >&2; exit 1; }
  cmp -s "$release/ops/minion-hub-notification-worker.service" "$unit_target" \
    || { echo 'unit_mismatch' >&2; exit 1; }
else
  install -o root -g root -m 0444 "$release/ops/minion-hub-notification-worker.service" "$unit_target"
  unit_created=1
fi
rollback_unit() {
  rm -rf "$staging" "$verified_inputs"
  if [ -n "${temporary:-}" ]; then rm -f "$temporary"; fi
  if [ "$unit_created" -eq 1 ]; then rm -f "$unit_target"; systemctl daemon-reload || true; fi
}
trap rollback_unit EXIT HUP INT TERM
systemctl daemon-reload
"$release/ops/verify-disabled-worker.sh" "$service"
current="$target_root/opt/minion/hub-notification-worker/current"
temporary="$current.new.$$"
ln -s "releases/$digest" "$temporary"
mv -T "$temporary" "$current"
rm -rf "$verified_inputs"
trap - EXIT HUP INT TERM
printf '%s\n' "$expected_archive"
