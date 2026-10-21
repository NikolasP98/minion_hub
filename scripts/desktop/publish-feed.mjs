import { readFileSync } from 'node:fs';
import { assertNewerFeed } from './updates.mjs';

// Called only by an explicitly published, fully assembled release. The mutable
// channel contains metadata only; versioned installers are never overwritten.
const repository = 'NikolasP98/minion_hub';
const manifest = JSON.parse(readFileSync(`${process.env.DESKTOP_OUTPUT}/latest.json`));
const api = async (path, options = {}) => {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) throw Error(`GitHub feed request failed (${response.status})`);
  return response.status === 204 ? null : response.json();
};
const release = await api(`/releases/tags/desktop-v${manifest.version}`);
if (release.draft) throw Error('Draft releases cannot advance the update feed');
// Public downloads must actually work before announcing them to installed apps.
for (const { url } of Object.values(manifest.platforms)) {
  const response = await fetch(url, { method: 'HEAD' });
  if (!response.ok) throw Error('Versioned updater artifact is not publicly available');
}
const lookup = await fetch(
  `https://api.github.com/repos/${repository}/releases/tags/desktop-updates`,
  {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  },
);
let channel;
if (lookup.status === 404) {
  channel = await api('/releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: 'desktop-updates',
      target_commitish: process.env.GITHUB_SHA,
      name: 'Desktop update channel',
      prerelease: true,
      make_latest: 'false',
      body: 'Automatic desktop update metadata. Installers are in the versioned desktop releases.',
    }),
  });
} else {
  if (!lookup.ok) throw Error('Could not inspect update channel');
  channel = await lookup.json();
}
if (channel.draft) throw Error('Update channel must be public');
const current = channel.assets.find(({ name }) => name === 'latest.json');
if (current) {
  const response = await fetch(current.browser_download_url);
  if (!response.ok) throw Error('Could not verify the previous feed');
  const previous = await response.json();
  if (JSON.stringify(previous) === JSON.stringify(manifest)) {
    console.log(`Desktop update channel already contains ${manifest.version}`);
    process.exit(0);
  }
  assertNewerFeed(previous, manifest);
  await api(`/releases/assets/${current.id}`, { method: 'DELETE' });
}
// A failed replacement makes checks fail open; no application installs a missing
// or partially uploaded feed. Retry publication after correcting the failure.
const upload = await fetch(
  `https://uploads.github.com/repos/${repository}/releases/${channel.id}/assets?name=latest.json`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(manifest, null, 2) + '\n',
  },
);
if (!upload.ok) throw Error(`Feed upload failed (${upload.status})`);
const uploaded = await upload.json();
const response = await fetch(uploaded.browser_download_url);
if (!response.ok || JSON.stringify(await response.json()) !== JSON.stringify(manifest))
  throw Error('Published feed did not match the approved release');
console.log(`Desktop update channel advanced to ${manifest.version}`);
