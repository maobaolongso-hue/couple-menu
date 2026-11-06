# 把「情侣电子菜单」推到 GitHub

目标仓库：<https://github.com/HunYiSage/dsh-purge>

⚠️ 先说清楚：那个仓库是你自己的 **DeepSeek Harness 破甲** 项目（19.6k star、默认分支 `master`）。
如果把菜单直接推到根目录，`master` 上的内容会被顶掉。所以这里默认推到**新分支 `couple-menu`**，
`master` 一点不动；也可以改成**新建一个独立仓库**。

## 一、准备 Token（1 分钟）

GitHub 不允许匿名推送，必须带凭据。任选一种：

**经典 Token（最简单）**

1. 打开 <https://github.com/settings/tokens/new>
2. Note 填 `couple-menu-push`，Expiration 选 7 天
3. 勾选 **`repo`**（整块勾上）
4. `Generate token` → 复制那串 `ghp_...`（只显示一次）

**Fine-grained Token**

1. <https://github.com/settings/personal-access-tokens/new>
2. Repository access → 选 `dsh-purge`
3. Permissions → `Contents: Read and write`（要改 Pages 再加 `Pages: Read and write`）
4. 生成并复制

## 二、跑脚本

在项目目录里打开 PowerShell：

```powershell
cd "C:\Users\暴龙\Documents\deepseek-harness\default-workspace\情侣电子菜单"

# 默认：推到 dsh-purge 的新分支 couple-menu，master 不动
.\push.ps1 -Token "ghp_你的token"

# 或者：新建一个独立仓库 couple-menu（推荐，干净）
.\push.ps1 -Token "ghp_你的token" -Mode newrepo -RepoName couple-menu

# 或者：推到别的分支名
.\push.ps1 -Token "ghp_你的token" -Branch menu-200
```

脚本会做：找 git → 初始化仓库 → 提交 → 推送 → 打印后续 Pages 步骤。
Token 只在这条命令里用一次，不写进 `.git/config`、不落盘。

## 三、开 Pages（拿到能发微信的链接）

推到分支后：

1. 打开 <https://github.com/HunYiSage/dsh-purge/settings/pages>
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `couple-menu`，目录 `/ (root)` → `Save`
4. 等 1–2 分钟，地址是：
   `https://hunyisage.github.io/dsh-purge/`
5. 发微信时加版本参数防缓存：`.../dsh-purge/?v=200`

如果选了 `-Mode newrepo`，Pages 路径是 `https://hunyisage.github.io/couple-menu/`。

## 四、以后更新

```powershell
cd "C:\Users\暴龙\Documents\deepseek-harness\default-workspace\情侣电子菜单"
git add -A
git commit -m "menu: 更新到 v5 / 200 道菜"
.\push.ps1 -Token "ghp_你的token"
```

或者干脆拖 [情侣电子菜单.zip](情侣电子菜单.zip) 到 <https://app.netlify.com/drop>，
不碰 GitHub、不用 Token、30 秒出链接。
