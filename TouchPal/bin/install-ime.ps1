# TouchPal\bin\install-ime.ps1 -- install TouchPal IME from the bundled apk and make it
# the active input method.  Includes the "keyboard does not pop up (empty view, height 0)"
# fix: move aside the corrupted runtime resource dir so the app re-extracts its bundled
# resources (assets.zip -> TouchPalResources.tprc) on first launch and loads the built-in
# default skin.  ASCII-only source (see _adb.ps1).
#
#   powershell -File TouchPal\bin\install-ime.ps1              # full clean install (does the fix)
#   powershell -File TouchPal\bin\install-ime.ps1 -DryRun      # just show what would run
#   powershell -File TouchPal\bin\install-ime.ps1 -NoReset     # reinstall but keep /sdcard/TouchPalv5
#
# After this, run deploy.ps1 to push the wubi phrase dictionary.  NOTE: the default
# (-NoReset absent) moves /sdcard/TouchPalv5 to .bak and uninstalls -- if you already ran
# deploy.ps1, re-run deploy.ps1 afterwards (the Backup/ folder was moved aside).
param(
  [string]$Apk = (Join-Path $PSScriptRoot '..\apk\base.apk'),
  [string]$Device,
  [switch]$NoReset,
  [switch]$DryRun
)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot '_adb.ps1')

$adb = Find-Adb
$dev = Resolve-Device -Adb $adb -Preferred $Device
$pkg = 'com.cootek.smartinputv5'
$ime = $pkg + '/com.cootek.smartinput5.TouchPalIME'
$rdir = '/sdcard/TouchPalv5'

Write-Output ('adb    = ' + $adb)
Write-Output ('device = ' + $dev)
Write-Output ('apk    = ' + $Apk)
if (-not (Test-Path -LiteralPath $Apk)) { throw "missing apk: $Apk" }

function Step($label, [scriptblock]$body) {
  if ($DryRun) { Write-Output ('DRYRUN  ' + $label); return }
  Write-Output ('RUN     ' + $label)
  & $body
}

Write-Output ''
Write-Output '=== 0. current default IME ==='
Sh $adb $dev 'settings get secure default_input_method'

if (-not $NoReset) {
  Write-Output ''
  Write-Output '=== 1. move aside runtime resources (forces fresh tprc extraction) ==='
  Step ('mv ' + $rdir + ' -> ' + $rdir + '.bak') { Sh $adb $dev ('if [ -d ' + $rdir + ' ]; then mv ' + $rdir + ' ' + $rdir + '.bak; fi; ls -d ' + $rdir + '.bak 2>&1') }

  Write-Output ''
  Write-Output '=== 2. uninstall (clean) ==='
  Step ('uninstall ' + $pkg) { (& $adb -s $dev uninstall $pkg 2>&1 | Out-String).Trim() }
}

Write-Output ''
Write-Output '=== 3. install apk (grant all perms) ==='
Step ('install -r -g ' + (Split-Path $Apk -Leaf)) { (& $adb -s $dev install -r -g $Apk 2>&1 | Select-Object -Last 3) }

Write-Output ''
Write-Output '=== 4. enable + set as active IME ==='
Step ('pm enable ' + $pkg)      { Sh $adb $dev ('pm enable ' + $pkg) }
Step ('ime enable ' + $ime)     { Sh $adb $dev ('ime enable ' + $ime) }
Step ('ime set ' + $ime)        { Sh $adb $dev ('ime set ' + $ime) }

Write-Output ''
Write-Output '=== 5. verify ==='
if (-not $DryRun) {
  Sh $adb $dev ('dumpsys package ' + $pkg + ' | grep -E ''versionName|enabled|lastUpdateTime'' | head -6')
  Sh $adb $dev 'ime list -s'
  Write-Output ('default now = ' + (Sh $adb $dev 'settings get secure default_input_method'))
}

Write-Output ''
if ($DryRun) { Write-Output 'DRYRUN done (nothing executed).' }
else {
  Write-Output 'DONE. On first launch TouchPal shows "initializing" briefly, then the keyboard works.'
  Write-Output ('Next, push the wubi dictionary:  powershell -File ' + (Join-Path $PSScriptRoot 'deploy.ps1'))
}
