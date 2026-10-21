$ErrorActionPreference = 'Stop'
function Assert-Exit { if ($LASTEXITCODE -ne 0) { throw "Native command failed: $LASTEXITCODE" } }
node scripts/desktop/release.mjs prepare $env:DESKTOP_VERSION $env:DESKTOP_PLATFORM
Assert-Exit
if ($env:DESKTOP_SIGNED -eq 'true') {
  # Tauri invokes this signer for both the app executable and the NSIS installer.
  $signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' | Sort-Object FullName -Descending | Select-Object -First 1
  if (!$signtool) { throw 'Windows SDK signtool missing' }
  $env:SIGNTOOL_PATH = $signtool.FullName
  bun run tauri build --ci --target $env:DESKTOP_TARGET --config $env:DESKTOP_CONFIG -- --locked
  Assert-Exit
  $app = "src-tauri/target/$env:DESKTOP_TARGET/release/minion-hub-desktop.exe"
  $installers = @(Get-ChildItem "src-tauri/target/$env:DESKTOP_TARGET/release/bundle/nsis/*.exe")
  if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS installer' }
  foreach ($file in @($app, $installers[0].FullName)) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate -or $signature.SignerCertificate.Subject -cne $env:WINDOWS_SIGNER_SUBJECT) {
      throw "Trusted, timestamped signature from expected publisher required: $file"
    }
  }
} else {
  bun run tauri build --ci --no-sign --target $env:DESKTOP_TARGET --config $env:DESKTOP_CONFIG -- --locked
  Assert-Exit
}
node scripts/desktop/release.mjs collect $env:DESKTOP_VERSION $env:DESKTOP_PLATFORM $env:GITHUB_SHA
Assert-Exit
