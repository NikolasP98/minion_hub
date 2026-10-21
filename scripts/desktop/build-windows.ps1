$ErrorActionPreference = 'Stop'
function Assert-Exit { if ($LASTEXITCODE -ne 0) { throw "Native command failed: $LASTEXITCODE" } }
node scripts/desktop/release.mjs prepare $env:DESKTOP_VERSION $env:DESKTOP_PLATFORM
Assert-Exit
bun run tauri build --ci --no-sign --target $env:DESKTOP_TARGET --config $env:DESKTOP_CONFIG -- --locked
Assert-Exit
node scripts/desktop/release.mjs collect $env:DESKTOP_VERSION $env:DESKTOP_PLATFORM $env:GITHUB_SHA
Assert-Exit
node scripts/desktop/updates.mjs collect $env:DESKTOP_VERSION $env:DESKTOP_PLATFORM $env:GITHUB_SHA
Assert-Exit
