# Muse DSH 插件（可选实验组件）

本插件以 GPL-3.0-or-later 提供，见本目录 LICENSE、NOTICE。调用的 DSH 包仍按自己的许可提供；本包不包含 DSH 或 React 代码。已验证宿主基线：DSH 0.2.0-rc.2。其他版本需重新验证接口。

## 安装

先安装 Node.js 24 和 DSH，并启动一次 DSH 以生成 desktop profile。启动 Muse 主服务（默认 3210）。在 Muse 源码根目录执行：

```powershell
npm pack ./plugin --pack-destination .
```

生成 dsh-plugin-muse-multi-agent-0.3.6-alpha.1.tgz。若 DSH 提供本地插件安装入口，可使用其支持的流程安装该包。以下为已验证 desktop profile 布局的手动安装步骤；路径不存在时停止，不要猜测其他 profile：

```powershell
$musePackage = (Resolve-Path './dsh-plugin-muse-multi-agent-0.3.6-alpha.1.tgz').Path
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

侧栏 Muse Multi-Agent 打开内嵌页面。在 Muse 设置 → DSH 插件与工具点击“一键连接 DSH”；选择角色、已打开且空闲的 DSH 会话，再勾选工具保存。支持勾选全部或取消全部。顶部手动设备配对仍可备用。默认无权限；重启需重新配对。建议先用 read 读取自建测试文件。

工具受绑定会话工作区和审批控制。审批需在 DSH 处理，不能假设所有插件都能执行。退出内嵌面板会卸载网页，可能中断生成；停止或撤销不回滚已完成操作。工具结果未知时先核对，避免重复执行。工具记录可在 Muse 设置里查看。

## 卸载

### DSH 客户端壁纸适配

壁纸插件 `dsh-plugin-wallpaper-engine@1.3.3` 原本只提供背景界面和 HTTP 接口，没有模型工具。Muse 工具桥接不会自动把此类界面插件变成可调用工具。

本版本额外注册 `dsh_wallpaper_list`、`dsh_wallpaper_status`、`dsh_wallpaper_control`，并提供实时接收端。安装 Muse 插件后，在本项目源码根目录运行 `node scripts/install-wallpaper-adapter.mjs`，然后重启 DSH。脚本只适配已验证的壁纸插件 1.3.3，修改前在原文件旁保存带哈希的备份；结构或版本不匹配时停止。

在 Muse 设置中给角色授权以上三个工具，即可查询可用背景、切换/清除背景和调整遮罩、模糊、速度、音量、翻转与填充方式。工具通过壁纸插件自己的选择、渲染和保存逻辑执行，等待界面回执；当前隐藏和分级筛选仍生效。切换会关闭自动轮换。成功表示选择已应用并保存，媒体本身仍可能因解码或 GPU 问题无法播放。它只控制 DSH 背景。

壁纸插件升级或重新安装可能覆盖接收端补丁，需检查兼容性后重装适配。卸载 Muse 适配时可在退出 DSH 后用保存的原始 `client.js.muse-backup-<hash>` 恢复壁纸插件的 client.js，再卸载 Muse 插件。请核对备份来自未打补丁的版本，不要用中间版本的备份。

## 卸载 Muse 插件

## 自动接入现在与以后的工具

Muse 设置 → DSH 插件与工具可启用“自动使用此 DSH 会话的全部工具”。该模式跟随绑定会话的当前工具目录，新增工具和更新定义无需再逐项授权；插件卸载、工具隐藏或会话关闭后不能继续执行。聊天的每次模型往返都会重新读取目录。取消全部勾选并保存会撤销该角色权限。

自动模式继承 DSH 审批、工作区和沙箱，不替用户同意审批。只提供界面的插件没有模型接口时，仍需要像壁纸适配一样补充专门的工具定义。配对和角色授权仍仅在运行期有效，重启后需重新连接授权。

退出 DSH 后，从 profile package.json 的 dsh.profile.bundles 中只移除 dsh-plugin-muse-multi-agent；再在该 profile 用上述 DSH pnpm 执行 remove dsh-plugin-muse-multi-agent，并重启。保留其他 bundle。不要在安装其他插件后直接覆盖整份旧 profile 备份。卸载插件不删除 Muse 的 data/。

本机已验证真实 DeepSeek 选择 read、DSH 正式调度读取测试文件、审计记录和结果回传。一键配对的消息来源、窗口、请求标识和超时清理已自动测试；其他插件仍需按其权限和配置验收。尚未在另一台全新电脑重新验收宿主安装。


