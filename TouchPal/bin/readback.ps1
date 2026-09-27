# TouchPal\bin\readback.ps1 -- pull the device's current shortcut.lst out of its own
# SD-card backup and report how many records the app actually holds (verify an import).
# ASCII-only source (see _adb.ps1).
#
#   powershell -File TouchPal\bin\readback.ps1
#   powershell -File TouchPal\bin\readback.ps1 -Find aaad
param(
  [string]$Device,
  [string]$Find,          # optional: locate a code and print its index/percent
  [int]$Show = 20
)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot '_adb.ps1')

$adb = Find-Adb
$dev = Resolve-Device -Adb $adb -Preferred $Device
$devZip = '/sdcard/TouchPalv5/Backup/files.zip'
$lib  = Join-Path $PSScriptRoot '..\lib'
$work = Join-Path $PSScriptRoot '..\work'
New-Item -ItemType Directory -Force -Path $work | Out-Null

Write-Output ('device = ' + $dev)
Write-Output '=== Backup/ timestamps on device ==='
Sh $adb $dev ('ls -l ' + $devZip + ' /sdcard/TouchPalv5/Backup/shortcut.lst')

$zip = Join-Path $work 'pulled.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Write-Output ''
Write-Output '=== pull files.zip ==='
& $adb -s $dev pull $devZip $zip 2>&1 | Select-Object -Last 1
if (-not (Test-Path $zip)) { throw "no $devZip on device (run the app backup, or a deploy, first)" }

$out = Join-Path $work 'pull'
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
node (Join-Path $lib 'ziptake.js') $zip '^shortcut\.lst$' $out | Out-Null
$lst = Join-Path $out 'shortcut.lst'
if (-not (Test-Path $lst)) { throw 'shortcut.lst not present in device files.zip' }

Write-Output ''
Write-Output '=== shortcut.lst in the app backup ==='
node (Join-Path $lib 'shortcut_build.js') parse $lst $Show
if ($Find) {
  Write-Output ''
  Write-Output ('=== locate code ' + $Find + ' ===')
  node (Join-Path $lib 'shortcut_build.js') find $lst $Find
}
Write-Output ''
Write-Output 'If the count/entries match your deployed dictionary, the import took effect.'
