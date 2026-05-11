/**
 * Recursive secure-permission enforcement for auth profile directories.
 *
 * Ensures all profile directories and credential files use restrictive
 * permissions (0700 for directories, 0600 for files) so that sensitive
 * data is never world-readable.
 *
 * Covers:
 * - All profile directories (not just the active one)
 * - Runs on startup and on profile creation/modification
 * - Works in Docker/containerized environments
 */
import { readdirSync, statSync, chmodSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Directory permission: owner rwx only */
const DIR_MODE = 0o700;
/** File permission: owner rw only */
const FILE_MODE = 0o600;

/**
 * Recursively enforce secure permissions on a directory tree.
 * Directories get 0700, files get 0600.
 */
export function enforceSecurePermissions(dirPath: string): void {
  if (!existsSync(dirPath)) return;

  const stat = statSync(dirPath);
  if (!stat.isDirectory()) {
    chmodSync(dirPath, FILE_MODE);
    return;
  }

  chmodSync(dirPath, DIR_MODE);

  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      enforceSecurePermissions(fullPath);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      chmodSync(fullPath, FILE_MODE);
    }
  }
}

/**
 * Create a directory with secure permissions (0700).
 * Creates parent directories as needed.
 */
export function secureCreateDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode: DIR_MODE });
  }
  chmodSync(dirPath, DIR_MODE);
}

/**
 * Enforce secure permissions on all auth profile directories
 * under a given base path (e.g. ~/.minion/).
 *
 * Scans for known sensitive subdirectories:
 * - agents/      (agent workspaces and configs)
 * - auth/        (auth tokens and credentials)
 * - profiles/    (user profile data)
 * - keys/        (API keys and certificates)
 * - config files (minion.json, *.pem, *.key)
 */
export function enforceProfilePermissions(basePath: string): void {
  if (!existsSync(basePath)) return;

  // Secure the base directory itself
  chmodSync(basePath, DIR_MODE);

  const entries = readdirSync(basePath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(basePath, entry.name);
    if (entry.isDirectory()) {
      // Recursively secure all subdirectories
      enforceSecurePermissions(fullPath);
    } else if (entry.isFile()) {
      // Secure all files in the profile root
      chmodSync(fullPath, FILE_MODE);
    }
  }
}

/**
 * Build the SSH command to recursively enforce secure permissions
 * on a remote server's profile directory.
 *
 * Returns the shell command string to execute via SSH.
 */
export function buildRemotePermissionCommand(minionUser: string): string {
  const homeDir = `/home/${minionUser}/.minion`;
  return [
    // Directories: 0700
    `find "${homeDir}" -type d -exec chmod 700 {} +`,
    // Files: 0600
    `find "${homeDir}" -type f -exec chmod 600 {} +`,
  ].join(' && ');
}
