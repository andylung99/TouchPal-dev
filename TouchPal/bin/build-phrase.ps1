# TouchPal\bin\build-phrase.ps1 -- (re)build a wubi-code -> phrase shortcut.lst from
# dict\wubi.txt (format: WORD CODE WEIGHT).  This is the customization / reverse-
# engineering entry point; the ready-to-use dictionary already ships as dict\full.lst.
#
#   4-key full codes only (safe: a full wubi code never collides with a pinyin syllable):
#       powershell -File TouchPal\bin\build-phrase.ps1 -Out dict\my4.lst
#   add graded 1/2/3-key simple codes (restores the single characters that 4-key
#   filtering drops -- wubi lists many single chars only as short 简码):
#       powershell -File TouchPal\bin\build-phrase.ps1 -Graded -Out dict\myfull.lst
#
# Inspect how big each tier is before deciding:  node lib\shortcut_build.js stats dict\wubi.txt
param(
  [string]$Wubi = (Join-Path $PSScriptRoot '..\dict\wubi.txt'),
  [string]$Out  = (Join-Path $PSScriptRoot '..\dict\full.custom.lst'),
  [switch]$Graded,
  [int]$SimpleMaxPerCode = 1     # cap fan-out on ambiguous 1/2/3-key codes
)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$sb   = Join-Path $PSScriptRoot '..\lib\shortcut_build.js'
$work = Join-Path $PSScriptRoot '..\work'
New-Item -ItemType Directory -Force -Path $work | Out-Null
if (-not (Test-Path -LiteralPath $Wubi)) { throw "missing source dictionary: $Wubi" }

Write-Output '=== source stats ==='
node $sb stats $Wubi

$b4 = Join-Path $work 'b4.lst'
node $sb build $Wubi $b4 --len=4 --sentCode=qqqqzy --sentWord=SENTINEL7X

if (-not $Graded) {
  Copy-Item -Force $b4 $Out
  Write-Output ''
  node $sb parse $Out 5
  Write-Output ("wrote " + $Out + "  (4-key full codes only)")
  exit 0
}

$b1 = Join-Path $work 'b1.lst'
$b2 = Join-Path $work 'b2.lst'
$b3 = Join-Path $work 'b3.lst'
node $sb build $Wubi $b3 --len=3 --maxPerCode=$SimpleMaxPerCode
node $sb build $Wubi $b2 --len=2 --maxPerCode=$SimpleMaxPerCode
node $sb build $Wubi $b1 --len=1 --maxPerCode=$SimpleMaxPerCode

Write-Output ''
Write-Output '=== merge (4-key first so the sentinel stays on top) ==='
node $sb merge $Out $b4 $b3 $b2 $b1
node $sb parse $Out 5
Write-Output ("wrote " + $Out)
