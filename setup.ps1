# Installe la marketplace locale my-mods et le mod side-dashboard pour toutes les sessions.
# Usage : powershell -ExecutionPolicy Bypass -File .\setup.ps1
param(
  [string]$Root = $PSScriptRoot,
  [switch]$DisableMlflow
)

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Error "La commande 'claude' est introuvable. Installe d'abord Claude Code."
  exit 1
}

claude plugin marketplace add $Root
claude plugin install side-dashboard@my-mods --scope user

# Thème « Claude orange » : Claude Code ne lit les thèmes que dans ~/.claude/themes
# (ceux fournis par un plugin n'apparaissent pas dans /theme sur cette version).
$themes = Join-Path (Join-Path $HOME ".claude") "themes"
New-Item -ItemType Directory -Force $themes | Out-Null
Copy-Item (Join-Path $Root "themes\claude-orange.json") $themes -Force
Write-Host "Thème installé. Choisis-le avec /theme (« Claude orange »), ou règle `"theme`": `"custom:claude-orange`" dans settings.json."

# Optionnel : le hook mlflow échoue sous Windows sans vrai `python3` (voir README.md).
if ($DisableMlflow) {
  claude plugin disable mlflow@claude-plugins-official
}

claude plugin list
Write-Host "Redémarre Claude Code pour charger le mod."
