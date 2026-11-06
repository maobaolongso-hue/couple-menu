#requires -version 5.1
<#
.SYNOPSIS
  把「情侣电子菜单」推送到 GitHub。

.DESCRIPTION
  默认推到 HunYiSage/dsh-purge 的新分支 couple-menu（master 不动）。
  也可以 -Mode newrepo 新建一个独立仓库。

  需要 GitHub Token：https://github.com/settings/tokens/new 勾 repo。
  Token 只用于本次命令，不写入 .git/config。

.EXAMPLE
  .\push.ps1 -Token "ghp_xxx"

.EXAMPLE
  .\push.ps1 -Token "ghp_xxx" -Mode newrepo -RepoName couple-menu

.EXAMPLE
  .\push.ps1 -Token "ghp_xxx" -Repo "你的名字/别的仓库" -Branch menu-200
#>
param(
  [string]$Token = '',
  [string]$Repo = 'HunYiSage/dsh-purge',
  [string]$Branch = 'couple-menu',
  [ValidateSet('branch', 'newrepo')][string]$Mode = 'branch',
  [string]$RepoName = 'couple-menu',
  [string]$CommitName = 'HunYiSage',
  [string]$CommitEmail = 'HunYiSage@users.noreply.github.com',
  [string]$Message = 'feat: 情侣电子菜单（10 分类 200 道菜，含制作过程）'
)

$ErrorActionPreference = 'Stop'

if (-not $Token) {
  Write-Host ''
  Write-Host '  需要 GitHub Token（https://github.com/settings/tokens/new 勾 repo）' -ForegroundColor Yellow
  Write-Host '  粘贴后回车，输入过程不显示：' -ForegroundColor Yellow
  $sec = Read-Host -AsSecureString
  $Token = [System.Net.NetworkCredential]::new('', $sec).Password
}
if (-not $Token) { Write-Host '  没有提供 Token，退出' -ForegroundColor Red; exit 1 }
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Info($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "  ✓ $m" -ForegroundColor Green }
function Die($m) { Write-Host "  ✗ $m" -ForegroundColor Red; exit 1 }

# ── 1. 找 git ──
$Git = $null
foreach ($c in @(
    (Get-Command git -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    "$env:ProgramFiles\Git\cmd\git.exe",
    "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
    "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
  )) {
  if ($c -and (Test-Path $c)) { $Git = $c; break }
}
if (-not $Git) { Die "没找到 git。先装：winget install Git.Git -e --scope user，装完重开这个窗口" }
Ok "git: $Git"

# ── 2. 校验 token ──
Info '校验 Token…'
$headers = @{
  Authorization          = "Bearer $Token"
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'           = 'couple-menu-push'
}
try {
  $me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers -TimeoutSec 20
  Ok "已登录：$($me.login)"
} catch {
  Die "Token 无效或没有权限：$($_.Exception.Message)"
}

# ── 3. 可选：新建仓库 ──
if ($Mode -eq 'newrepo') {
  $full = "$($me.login)/$RepoName"
  Info "检查仓库 $full 是否存在…"
  $exists = $true
  try { Invoke-RestMethod -Uri "https://api.github.com/repos/$full" -Headers $headers -TimeoutSec 20 | Out-Null }
  catch { $exists = $false }

  if (-not $exists) {
    Info "创建仓库 $full …"
    $body = @{
      name        = $RepoName
      description = '情侣电子菜单 · 单文件网页版（200 道菜 + 制作过程）'
      private     = $false
      auto_init   = $false
    } | ConvertTo-Json
    try {
      $bytes = [Text.Encoding]::UTF8.GetBytes($body)
      Invoke-RestMethod -Uri 'https://api.github.com/user/repos' -Method Post -Headers $headers -Body $bytes -ContentType 'application/json' -TimeoutSec 30 | Out-Null
      Ok "仓库已创建：https://github.com/$full"
      Start-Sleep -Seconds 2
    } catch { Die "创建仓库失败：$($_.Exception.Message)" }
  } else {
    Ok "仓库已存在：https://github.com/$full"
  }
  $Repo = $full
  if ($Branch -eq 'couple-menu') { $Branch = 'main' }
}

# ── 4. 本地仓库 ──
if (-not (Test-Path (Join-Path $Root '.git'))) {
  Info '初始化本地仓库…'
  & $Git init -b main | Out-Null
}

# 忽略规则
@'
.git/
*.zip
test/edge-prof*/
.DS_Store
Thumbs.db
'@ | Set-Content -Path (Join-Path $Root '.gitignore') -Encoding UTF8

& $Git -c "user.name=$CommitName" -c "user.email=$CommitEmail" add -A
$staged = (& $Git diff --cached --name-only) | Where-Object { $_ }
if ($staged) {
  & $Git -c "user.name=$CommitName" -c "user.email=$CommitEmail" commit -m $Message | Out-Null
  Ok "已提交 $($staged.Count) 个文件"
} else {
  Info '没有新改动，直接推送现有提交'
}

# ── 5. 推送（token 只出现在这条命令里） ──
$remote = "https://x-access-token:$Token@github.com/$Repo.git"
Info "推送到 $Repo → 分支 $Branch …"
& $Git push $remote "HEAD:refs/heads/$Branch" --force
if ($LASTEXITCODE -ne 0) { Die '推送失败，看上面 git 的报错' }
Ok '推送完成'

# ── 6. 提示后续 ──
$owner, $name = $Repo.Split('/')
Write-Host ''
Write-Host '  接下来开 Pages（拿到能发微信的 https 链接）' -ForegroundColor Yellow
Write-Host "  1) 打开 https://github.com/$Repo/settings/pages"
Write-Host "  2) Source 选 Deploy from a branch"
Write-Host "  3) Branch 选 $Branch，目录 / (root)，Save"
Write-Host "  4) 等 1-2 分钟，地址是 https://$($owner.ToLower()).github.io/$name/"
Write-Host "  5) 发微信时加版本参数防缓存：https://$($owner.ToLower()).github.io/$name/?v=200"
Write-Host ''
Write-Host "  仓库分支：https://github.com/$Repo/tree/$Branch" -ForegroundColor DarkGray
