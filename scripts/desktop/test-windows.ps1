$ErrorActionPreference = 'Stop'

# Tauri's normal bin target gets a Common Controls v6 manifest. Cargo's lib-test
# executable does not; Windows otherwise exits before running any mock IPC test
# (0xc0000139 / comctl32 TaskDialogIndirect). Patch only the test executable with
# the installed Windows SDK manifest tool, then run every test normally.
# Upstream: https://github.com/tauri-apps/tauri/issues/13419
$messages = & cargo test --manifest-path src-tauri/Cargo.toml --locked --release --lib --no-run --target $env:DESKTOP_TARGET --message-format=json
$buildExit = $LASTEXITCODE
$executables = @()
foreach ($line in $messages) {
    $record = $line | ConvertFrom-Json
    if ($record.reason -eq 'compiler-message' -and $record.message.rendered) {
        Write-Host $record.message.rendered
    }
    if ($record.reason -eq 'compiler-artifact' -and $record.profile.test -and
        $record.target.name -eq 'minion_hub_desktop_lib' -and $record.executable) {
        $executables += $record.executable
    }
}
if ($buildExit -ne 0) { throw "Native test compilation failed: $buildExit" }
if ($executables.Count -ne 1) { throw "Expected exactly one native test executable" }

$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$manifestTool = Get-ChildItem $sdkRoot -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName 'x64/mt.exe' } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
if (-not $manifestTool) { throw 'Windows SDK mt.exe is required for native tests' }
$manifest = Join-Path $PSScriptRoot '../../src-tauri/windows/test.manifest'
& $manifestTool -nologo -manifest $manifest "-outputresource:$($executables[0]);#1"
if ($LASTEXITCODE -ne 0) { throw "Embedding the test manifest failed: $LASTEXITCODE" }
& ($executables[0])
if ($LASTEXITCODE -ne 0) { throw "Native tests failed: $LASTEXITCODE" }
