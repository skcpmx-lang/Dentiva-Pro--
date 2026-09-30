# validate-installer.ps1 — end-to-end validation of the NSIS installer built by
# electron-builder on a windows-latest CI runner.
#
# Validates, with hard failures:
#   1. The installer .exe exists in .\release and is non-trivially sized.
#   2. Executable metadata: ProductName, ProductVersion, CompanyName.
#   3. SHA-256 checksum file + GitHub step summary.
#   4. Silent install (/S): app files land in the per-user install dir.
#   5. Uninstall registry entry: DisplayName, Publisher, DisplayVersion.
#   6. Desktop + Start Menu shortcuts exist.
#   7. The installed (packaged) app launches and stays alive for 10 seconds.
#   8. Silent uninstall removes the app files and registry entry.
#
# Unsigned binaries are EXPECTED here (no code-signing certificate in CI) and
# are reported as a note, not a failure — signing is an explicit external step.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Step($m) { Write-Output ""; Write-Output "=== $m ===" }
function Ok($m)   { Write-Output "  [OK] $m" }
function Die($m)  { Write-Output "  [FAIL] $m"; Set-Content -Path validation.failed -Value $m; exit 1 }

$productName = 'Dentiva Pro'
$expectedVersion = '1.0.0'
$expectedPublisher = 'Shohan Khan'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Dentiva Pro'

# ---------------------------------------------------------------- locate exe
Step 'Locate installer'
$setup = Get-ChildItem -Path .\release -Filter '*.exe' -File |
  Where-Object { $_.DirectoryName -eq (Resolve-Path .\release).Path } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { Die 'No setup .exe found in .\release' }
if ($setup.Name -notmatch [regex]::Escape($productName)) { Die "Installer name does not contain product name: $($setup.Name)" }
if ($setup.Length -lt 40MB) { Die "Installer suspiciously small: $([math]::Round($setup.Length / 1MB, 1)) MB" }
Ok "Installer: $($setup.Name) ($([math]::Round($setup.Length / 1MB, 1)) MB)"

# ------------------------------------------------------------------ metadata
Step 'Executable metadata (VersionInfo)'
$vi = $setup.VersionInfo
if ($vi.ProductName -ne $productName) { Die "ProductName is '$($vi.ProductName)' (expected '$productName')" }
if ($vi.ProductVersion -ne $expectedVersion) { Die "ProductVersion is '$($vi.ProductVersion)' (expected '$expectedVersion')" }
if ($vi.CompanyName -ne $expectedPublisher) { Die "CompanyName is '$($vi.CompanyName)' (expected '$expectedPublisher')" }
Ok "ProductName=$($vi.ProductName)  ProductVersion=$($vi.ProductVersion)  CompanyName=$($vi.CompanyName)"
Ok "FileDescription=$($vi.FileDescription)  LegalCopyright=$($vi.LegalCopyright)"

$sig = Get-AuthenticodeSignature $setup.FullName
if ($sig.Status -eq 'Valid') { Ok 'Binary is code-signed' }
else { Write-Output '  [NOTE] Binary is unsigned (expected in CI — code signing is an external release step)' }

# ------------------------------------------------------------------ checksum
Step 'SHA-256 checksum'
$hash = (Get-FileHash $setup.FullName -Algorithm SHA256).Hash
$checksumFile = "$($setup.FullName).sha256"
"$hash  $($setup.Name)" | Out-File -FilePath $checksumFile -Encoding ascii
Ok "SHA-256: $hash"
"$hash  $($setup.Name)" | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
"Installer: $($setup.Name) ($([math]::Round($setup.Length / 1MB, 1)) MB)" | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8

# -------------------------------------------------------------- silent install
Step 'Silent install (/S)'
if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait
$appExe = Join-Path $installDir "$productName.exe"
if (-not (Test-Path $appExe)) { Die "Installed app exe missing: $appExe" }
$uninstExe = Join-Path $installDir "Uninstall $productName.exe"
if (-not (Test-Path $uninstExe)) { Die "Uninstaller missing: $uninstExe" }
$resources = Join-Path $installDir 'resources'
if (-not (Test-Path (Join-Path $resources 'app.asar'))) { Die 'Packaged app.asar missing' }
Ok "Installed to $installDir"
Ok 'app.asar + uninstaller present'

# ------------------------------------------------------------------ registry
Step 'Uninstall registry entry (per-user)'
# electron-builder's NSIS default uninstall DisplayName is
# "${productName} ${version}" (NsisTarget.js:473) — i.e. "Dentiva Pro 1.0.0".
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$entry = $null
$deadline = (Get-Date).AddSeconds(30)
while (-not $entry -and ((Get-Date) -lt $deadline)) {
  $entry = Get-ChildItem $uninstallKey -ErrorAction SilentlyContinue |
    Where-Object { $_.GetValue('DisplayName') -like "$productName*" } |
    Select-Object -First 1
  if (-not $entry) { Start-Sleep -Seconds 2 }
}
if (-not $entry) {
  # Diagnostics: show every Dentiva-related uninstall entry in both hives.
  Write-Output '  [diag] Dentiva-related uninstall entries found:'
  $found = $false
  foreach ($hive in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    foreach ($k in (Get-ChildItem $hive -ErrorAction SilentlyContinue)) {
      $dn = $k.GetValue('DisplayName')
      if ($dn -and $dn -like '*Dentiva*') {
        Write-Output "  [diag] $hive\$($k.PSChildName) => DisplayName='$dn' Version='$($k.GetValue('DisplayVersion'))' Publisher='$($k.GetValue('Publisher'))'"
        $found = $true
      }
    }
  }
  if (-not $found) { Write-Output '  [diag] (none in HKCU, HKLM or WOW6432Node)' }
  Die "No per-user uninstall entry with DisplayName like '$productName*' after silent install"
}
$display = $entry.GetValue('DisplayName')
if ($display -ne "$productName $expectedVersion") { Die "Registry DisplayName is '$display' (expected '$productName $expectedVersion')" }
if ($entry.GetValue('Publisher') -ne $expectedPublisher) { Die "Registry Publisher is '$($entry.GetValue('Publisher'))' (expected '$expectedPublisher')" }
if ($entry.GetValue('DisplayVersion') -ne $expectedVersion) { Die "Registry DisplayVersion is '$($entry.GetValue('DisplayVersion'))' (expected '$expectedVersion')" }
Ok "DisplayName=$display  Publisher=$($entry.GetValue('Publisher'))  DisplayVersion=$($entry.GetValue('DisplayVersion'))"

# ----------------------------------------------------------------- shortcuts
Step 'Shortcuts'
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$productName.lnk"
# Without nsis.menuCategory the shortcut is created directly in Programs;
# with one it lives in a subfolder — accept either (electron-builder common.nsh).
$startMenuLnk = Join-Path ([Environment]::GetFolderPath('StartMenu')) "Programs\$productName.lnk"
if (-not (Test-Path $startMenuLnk)) {
  $startMenuLnk = Join-Path ([Environment]::GetFolderPath('StartMenu')) "Programs\$productName\$productName.lnk"
}
if (-not (Test-Path $desktopLnk)) { Die "Desktop shortcut missing: $desktopLnk" }
if (-not (Test-Path $startMenuLnk)) { Die "Start Menu shortcut missing: $startMenuLnk" }
$sh = New-Object -ComObject WScript.Shell
foreach ($lnk in @($desktopLnk, $startMenuLnk)) {
  $target = $sh.CreateShortcut($lnk).TargetPath
  if ($target -ne $appExe) { Die "Shortcut $lnk targets '$target' (expected '$appExe')" }
}
Ok "Desktop shortcut -> $appExe"
Ok "Start Menu shortcut -> $appExe"

# -------------------------------------------------------------------- launch
Step 'Launch installed app (packaged) and verify it stays alive'
$p = Start-Process -FilePath $appExe -ArgumentList '--disable-gpu' -PassThru
Start-Sleep -Seconds 10
if ($p.HasExited) { Die "Packaged app exited with code $($p.ExitCode) within 10 s of launch — crash on launch" }
Ok "Packaged app launched (PID $($p.Id)) and stayed alive for 10 s"
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
try { $p.WaitForExit(20000) } catch { }
Get-Process -Name 'Dentiva Pro' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# ------------------------------------------------------------------ uninstall
Step 'Silent uninstall (/S)'
Start-Process -FilePath $uninstExe -ArgumentList '/S' -Wait
# The NSIS uninstaller spawns a detached copy of itself; poll for completion.
$deadline = (Get-Date).AddSeconds(45)
while ((Test-Path $appExe) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Seconds 2 }
if (Test-Path $appExe) { Die "App exe still present after silent uninstall: $appExe" }
$entry = Get-ChildItem $uninstallKey -ErrorAction SilentlyContinue | Where-Object { $_.GetValue('DisplayName') -like "$productName*" } | Select-Object -First 1
if ($entry) { Die "Uninstall registry entry still present after silent uninstall ($($entry.GetValue('DisplayName')))" }
Ok 'App files and registry entry removed by silent uninstall'

Write-Output ""; Write-Output "INSTALLER VALIDATION PASSED"
