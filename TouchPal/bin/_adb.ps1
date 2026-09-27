# TouchPal\bin\_adb.ps1 -- shared helpers: locate adb.exe, pick a device, run shell.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI.
# Dot-source it from the other scripts:  . (Join-Path $PSScriptRoot '_adb.ps1')

function Find-Adb {
  # 1) already on PATH
  $cmd = Get-Command adb -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cands = @()
  # 2) SDK env vars
  foreach ($v in 'ANDROID_HOME','ANDROID_SDK_ROOT') {
    $val = (Get-Item -LiteralPath "Env:$v" -ErrorAction SilentlyContinue).Value
    if ($val) { $cands += (Join-Path $val 'platform-tools\adb.exe') }
  }
  # 3) local.properties sdk.dir (repo root = two levels above bin\)
  $lp = Join-Path $PSScriptRoot '..\..\local.properties'
  if (Test-Path $lp) {
    $raw = Get-Content $lp -Raw
    if ($raw -match '(?m)^\s*sdk\.dir=(.+)$') {
      $dir = $matches[1].Trim()
      $dir = $dir -replace '\\\\', '\'      # properties double-escape backslashes
      $dir = $dir -replace '\\:', ':'       # a colon may appear escaped
      $cands += (Join-Path $dir 'platform-tools\adb.exe')
    }
  }
  # 4) common default install locations
  if ($env:LOCALAPPDATA) { $cands += (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe') }
  $cands += "$env:ProgramFiles\Android\Android Studio\jbr\..\..\Sdk\platform-tools\adb.exe"
  foreach ($p in $cands) {
    if ($p -and (Test-Path -LiteralPath $p)) { return (Resolve-Path -LiteralPath $p).Path }
  }
  throw 'adb.exe not found. Add Android platform-tools to PATH, or set ANDROID_HOME, or keep sdk.dir in local.properties.'
}

function Resolve-Device {
  param([string]$Adb, [string]$Preferred)
  $txt = & $Adb devices 2>&1 | Out-String
  $serials = @()
  foreach ($ln in ($txt -split "`r?`n")) {
    if ($ln -match '^(\S+)\s+device\b') { $serials += $matches[1] }
  }
  if ($Preferred) {
    if ($serials -contains $Preferred) { return $Preferred }
    throw "device '$Preferred' is not online. Online: $($serials -join ', ')"
  }
  if ($serials.Count -eq 0) { throw 'no Android device online (check USB debugging / adb devices).' }
  if ($serials.Count -gt 1) { throw "multiple devices online, pass -Device <serial>. Found: $($serials -join ', ')" }
  return $serials[0]
}

# Sh <adb> <dev> <shell-cmd>  -> trimmed stdout+stderr as one string
function Sh {
  param([string]$Adb, [string]$Dev, [string]$Cmd)
  return ((& $Adb -s $Dev shell $Cmd 2>&1 | Out-String).Trim())
}
