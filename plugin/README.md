# Muse DSH 插件（可选实验组件）

本插件以 GPL-3.0-or-later 提供，见本目录 LICENSE、NOTICE。调用的 DSH 包仍按自己的许可提供；本包不包含 DSH 或 React 代码。已验证宿主基线：DSH 0.2.0-rc.2。其他版本需重新验证接口。

## 安装

先安装 Node.js 24 和 DSH，并启动一次 DSH 以生成 desktop profile。启动 Muse 主服务（默认 3210）。在 Muse 源码根目录执行：

```powershell
npm pack ./plugin --pack-destination .
```

生成 dsh-plugin-muse-multi-agent-0.3.3-alpha.1.tgz。若 DSH 提供本地插件安装入口，可使用其支持的流程安装该包。以下为已验证 desktop profile 布局的手动安装步骤；路径不存在时停止，不要猜测其他 profile：

```powershell
$musePackage = (Resolve-Path './dsh-plugin-muse-multi-agent-0.3.3-alpha.1.tgz').Path
$dshProfile = Join-Path $env:USERPROFILE '.dsh/profiles/desktop'
$dshPnpm = Join-Path $env:USERPROFILE '.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs'
if (!(Test-Path $dshPnpm) -or !(Test-Path (Join-Path $dshProfile 'package.json'))) { throw 'DSH 布局不匹配，请使用对应版本的安装方式' }
$backupDir = Join-Path $dshProfile ('muse-before-install-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory $backupDir | Out-Null
Copy-Item (Join-Path $dshProfile 'package.json') $backupDir
if (Test-Path (Join-Path $dshProfile 'pnpm-lock.yaml')) { Copy-Item (Join-Path $dshProfile 'pnpm-lock.yaml') $backupDir }
Push-Location $dshProfile
try {
  node $dshPnpm add --offline --ignore-scripts $musePackage
  if ($LASTEXITCODE -ne 0) { throw '安装失败，不要继续修改 profile' }
  node -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dsh??={};p.dsh.profile??={};p.dsh.profile.bundles??=[];if(!Array.isArray(p.dsh.profile.bundles))throw Error('bundles 格式不匹配');if(!p.dsh.profile.bundles.includes('dsh-plugin-muse-multi-agent'))p.dsh.profile.bundles.push('dsh-plugin-muse-multi-agent');fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"
  if ($LASTEXITCODE -ne 0) { throw '启用失败，请检查备份和 profile' }
} finally { Pop-Location }
```

离线安装失败时不要清空 profile；保存报错并根据当前 DSH 版本处理依赖。保存未发送文字、等待任务结束后自行退出并重启 DSH。不要通过强制结束进程安装插件。

## 使用与权限

侧栏 Muse Multi-Agent 打开内嵌页面。顶部设备配对生成两分钟有效码，在 Muse 设置 → DSH 配对与工具授权粘贴；选择角色、已打开且空闲的 DSH 会话，再勾选工具保存。默认无权限；重启需重新配对。建议先用 read 读取自建测试文件。

工具受绑定会话工作区和审批控制。审批需在 DSH 处理，不能假设所有插件都能执行。退出内嵌面板会卸载网页，可能中断生成；停止或撤销不回滚已完成操作。工具结果未知时先核对，避免重复执行。工具记录可在 Muse 设置里查看。

## 卸载

退出 DSH 后，从 profile package.json 的 dsh.profile.bundles 中只移除 dsh-plugin-muse-multi-agent；再在该 profile 用上述 DSH pnpm 执行 remove dsh-plugin-muse-multi-agent，并重启。保留其他 bundle。不要在安装其他插件后直接覆盖整份旧 profile 备份。卸载插件不删除 Muse 的 data/。

此版本的许可/文档打包已验证；运行实现延续已验证的 0.3.2。尚未在另一台全新电脑重新验收宿主安装，也未完成真实 DeepSeek 工具往返测试。
