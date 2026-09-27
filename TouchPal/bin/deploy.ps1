# TouchPal\bin\deploy.ps1 -- inject a wubi-phrase dictionary into the app's SD-card
# user-word backup (files.zip + loose shortcut.lst), the only non-root channel into
# getFilesDir(), where Storage::get_shortcut_file() lives.  After pushing, tap the app's
# "restore user words from SD card" to import.  ASCII-only source (see _adb.ps1).
#
#   powershell -File TouchPal\bin\deploy.ps1                     # deploy dict\full.lst
#   powershell -File TouchPal\bin\deploy.ps1 -Lst dict\pilot.lst # small pilot first
#   powershell -File TouchPal\bin\deploy.ps1 -Revert             # put the original back
param(
  [string]$Lst = (Join-Path $PSScriptRoot '..\dict\full.lst'),
  [string]$Device,
  [switch]$Revert
)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot '_adb.ps1')

$adb = Find-Adb
$dev = Resolve-Device -Adb $adb -Preferred $Device
$devZip = '/sdcard/TouchPalv5/Backup/files.zip'
$devLst = '/sdcard/TouchPalv5/Backup/shortcut.lst'
$lib    = Join-Path $PSScriptRoot '..\lib'
$work   = Join-Path $PSScriptRoot '..\work'
New-Item -ItemType Directory -Force -Path $work | Out-Null

Write-Output ('adb    = ' + $adb)
Write-Output ('device = ' + $dev)
Sh $adb $dev 'mkdir -p /sdcard/TouchPalv5/Backup' | Out-Null

if ($Revert) {
  $orig = Join-Path $work 'files.orig.zip'
  if (-not (Test-Path $orig)) { throw "no saved original at $orig (deploy at least once first)" }
  & $adb -s $dev push $orig $devZip 2>&1 | Select-Object -Last 1
  Write-Output 'reverted. Now tap "restore user words from SD card" in TouchPal to roll back.'
  exit 0
}

if (-not (Test-Path -LiteralPath $Lst)) { throw "missing dictionary: $Lst" }

# pull the app's current files.zip to use as the injection base
$base = Join-Path $work 'files.base.zip'
$orig = Join-Path $work 'files.orig.zip'
if (Test-Path $base) { Remove-Item $base -Force }
Write-Output '=== pull current device files.zip (base) ==='
& $adb -s $dev pull $devZip $base 2>&1 | Select-Object -Last 1
if (-not (Test-Path $base)) {
  throw "device has no $devZip yet: open TouchPal and tap 'backup user words to SD card' once, then retry"
}
Copy-Item -Force $base $orig   # pristine copy kept for -Revert

Write-Output ''
Write-Output '=== source records ==='
node (Join-Path $lib 'shortcut_build.js') parse $Lst 3

Write-Output ''
Write-Output '=== rebuild files.zip (replace shortcut.lst) ==='
$new  = Join-Path $work 'files.new.zip'
$spec = Join-Path $work 'spec.json'
$json = '{"src":'   + (ConvertTo-Json $base -Compress) +
        ',"dst":'   + (ConvertTo-Json $new  -Compress) +
        ',"verbose":true,"add":[{"name":"shortcut.lst","file":' +
        (ConvertTo-Json $Lst -Compress) + ',"method":8,"level":6}]}'
[System.IO.File]::WriteAllText($spec, $json)
node (Join-Path $lib 'ziprebuild.js') $spec

Write-Output ''
Write-Output '=== verify the new zip round-trips ==='
$chk = Join-Path $work 'chk'
Remove-Item $chk -Recurse -Force -ErrorAction SilentlyContinue
node (Join-Path $lib 'ziptake.js') $new '^shortcut\.lst$' $chk | Out-Null
$got = Join-Path $chk 'shortcut.lst'
if ((Get-Item $got).Length -ne (Get-Item $Lst).Length) { throw 'round-trip size mismatch, aborting' }
node (Join-Path $lib 'shortcut_build.js') parse $got 2

Write-Output ''
Write-Output '=== push both channels (zip entry + loose file) ==='
& $adb -s $dev push $new $devZip 2>&1 | Select-Object -Last 1
& $adb -s $dev push $Lst $devLst 2>&1 | Select-Object -Last 1
Sh $adb $dev ('ls -l ' + $devZip + ' ' + $devLst)

Write-Output ''
Write-Output 'DONE. On the phone: TouchPal > user-words / backup&restore > "restore user words from SD card".'
Write-Output 'Then, on the PINYIN keyboard, type a wubi code (e.g. aaad) -> candidate "工期" appears.'
Write-Output ('Verify anytime with:  powershell -File ' + (Join-Path $PSScriptRoot 'readback.ps1'))
