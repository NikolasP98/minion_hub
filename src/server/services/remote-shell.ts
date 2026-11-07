/**
 * Helpers for building commands that run on a remote host over `ssh host '<cmd>'`.
 *
 * ssh joins its trailing arguments into one string that the remote login shell
 * parses, so every interpolated value must be single-quoted (shQuote) and every
 * value with a known shape must be validated before it gets near a command.
 */

/** POSIX single-quote escaping: the result is one literal word for any input. */
export function shQuote(value: string): string {
  if (value.includes('\0')) throw new Error('Refusing to quote a value containing NUL');
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const UNIX_USER = /^[a-z_][a-z0-9_-]{0,31}$/;
const HOSTNAME = /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/;
// Letters/digits from any script (agent names are user-typed) plus . _ - / and space.
// Deliberately excludes quotes, $, `, ;, &, |, <, >, \, newlines and glob characters:
// rsync hands a remote source path to the remote shell on older protocols.
const SNAPSHOT_PATH = /^\/[\p{L}\p{N}._\-/ ]+$/u;

export function assertUnixUser(user: string): string {
  if (!UNIX_USER.test(user)) throw new Error(`Invalid unix user: ${JSON.stringify(user)}`);
  return user;
}

export function assertSshHost(host: string): string {
  if (!HOSTNAME.test(host)) throw new Error(`Invalid host: ${JSON.stringify(host)}`);
  return host;
}

export function assertPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${String(port)}`);
  }
  return port;
}

/**
 * A snapshot path must be absolute, inside the configured backup base path,
 * free of `..` segments, and made only of conservative characters.
 */
export function assertSnapshotPath(snapshotPath: string, basePath: string): string {
  const base = basePath.replace(/\/+$/, '');
  if (!SNAPSHOT_PATH.test(snapshotPath)) {
    throw new Error('Snapshot path contains characters that are not allowed');
  }
  if (snapshotPath.split('/').some((segment) => segment === '..')) {
    throw new Error('Snapshot path must not contain ".." segments');
  }
  if (!snapshotPath.startsWith(`${base}/`)) {
    throw new Error('Snapshot path is outside the configured backup directory');
  }
  return snapshotPath;
}
