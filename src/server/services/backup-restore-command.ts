import { buildRemotePermissionCommand } from '$server/auth/secure-permissions';
import {
  assertPort,
  assertSnapshotPath,
  assertSshHost,
  assertUnixUser,
  shQuote,
} from './remote-shell';

export interface RestoreCommandInput {
  /** Unix account that owns ~/.minion on the gateway host. */
  minionUser: string;
  backupUser: string;
  backupHost: string;
  backupPort: number;
  /** Configured backup base directory; the snapshot must live under it. */
  basePath: string;
  snapshotPath: string;
}

/**
 * Builds the shell string that `ssh root@gateway <cmd>` runs for a restore.
 * Every interpolated value is validated and quoted; throws on anything unsafe
 * so the caller never starts a half-built command.
 */
export function buildRestoreCommand(input: RestoreCommandInput): string {
  const minionUser = assertUnixUser(input.minionUser);
  const backupUser = assertUnixUser(input.backupUser);
  const backupHost = assertSshHost(input.backupHost);
  const backupPort = assertPort(input.backupPort);
  const snapshotPath = assertSnapshotPath(input.snapshotPath, input.basePath);

  const target = `/home/${minionUser}/.minion/`;
  // -s (--protect-args): the remote path is sent over the rsync protocol instead of
  // being re-parsed by the backup host's shell, so the second hop is safe too.
  const rsyncCmd = [
    'rsync -az -s --stats',
    `-e ${shQuote(`ssh -p ${backupPort}`)}`,
    shQuote(`${backupUser}@${backupHost}:${snapshotPath}/`),
    shQuote(target),
  ].join(' ');

  // minionUser passed validation, so it is safe inside the nested double quotes below.
  const permCmd = buildRemotePermissionCommand(minionUser);
  const restartCmd = `sudo -u ${minionUser} bash -c "XDG_RUNTIME_DIR=/run/user/$(id -u ${minionUser}) systemctl --user restart minion-gateway" 2>/dev/null || true`;

  return `${rsyncCmd} && echo '--- Enforcing secure permissions ---' && ${permCmd} && echo '--- Restarting gateway ---' && ${restartCmd}`;
}
