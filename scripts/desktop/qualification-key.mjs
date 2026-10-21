import { appendFileSync, chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// A PR never sees the production private key. Its disposable key is kept outside
// the uploaded artifact directory, and stdout (which includes keys) is suppressed.
const path = join(process.env.RUNNER_TEMP, 'desktop-test-updater.key');
const result = spawnSync(
  process.execPath,
  ['node_modules/@tauri-apps/cli/tauri.js', 'signer', 'generate', '--ci', '--write-keys', path],
  { encoding: 'utf8' },
);
if (result.status !== 0) throw Error('Qualification key generation failed');
chmodSync(path, 0o600);
appendFileSync(
  process.env.GITHUB_ENV,
  `TAURI_SIGNING_PRIVATE_KEY_PATH=${path}\nTAURI_SIGNING_PRIVATE_KEY_PASSWORD=\nDESKTOP_UPDATER_PUBLIC_KEY=${readFileSync(`${path}.pub`, 'utf8').trim()}\n`,
);
