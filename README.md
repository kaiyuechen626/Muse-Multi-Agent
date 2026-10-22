# Muse Multi-Agent

**面向 Muse Cyrene 使用场景的非官方电脑端实验项目。**

版本：0.3.0-lan.2（配套局域网同步预发布版）。与原 Muse 作者、DeepSeek 均无官方隶属或背书关系。感谢 [Muse](https://github.com/Zer0Qing/Muse) 作者 Mozi 及贡献者；关联手机项目为 [Muse Cyrene](https://github.com/kaiyuechen626/Muse-Cyrene)。本项目采用 GPL-3.0-or-later，保留适用原作者声明，详见 LICENSE、NOTICE 和 [来源记录](docs/PROVENANCE.md)。

[本版发行附件](https://github.com/kaiyuechen626/Muse-Multi-Agent/releases/tag/desktop-v0.3.0-lan.2) · [配套手机版本](https://github.com/kaiyuechen626/Muse-Cyrene/releases/tag/cyrene-v0.3.0-lan.2)

## 开始使用

1. 安装 [Node.js 24](https://nodejs.org/)，运行 `node --version` 确认主版本至少为 24。
2. 将源码压缩包解压到自己可写的目录，不要直接在压缩包内启动。
3. Windows 双击 `start-muse.cmd`，或在项目目录运行 `npm start`。基础服务没有 npm 外部依赖，无需 `npm install`。
4. 打开 http://127.0.0.1:3210/ 。保留服务窗口，关闭窗口即停止服务。
5. 在设置中填写自己的 DeepSeek API Key，先测试连接，再创建角色开始聊天。

DSH 不是基础聊天的前提。不要复制原开发者的 data 或 node_modules。源码包不含密钥、个人数据、模型、音色或 DSH 运行库。

如果端口占用，可在 PowerShell 中先执行 `$env:PORT='3211'` 再 `npm start`，并打开相应端口；DSH 插件目前固定连接 3210，使用 DSH 时须使用默认端口。

## 功能

- 角色创建、编辑、回收站，Muse / SillyTavern JSON、PNG 卡片及 Muse 角色包导入。
- 单角色聊天、流式回复和停止、消息编辑、回复版本、分支、搜索、收藏。
- 本地角色记忆、自动提取、人工编辑、质量检查、来源追溯与检索。
- 本地聊天及完整备份恢复、深色模式、发送快捷键和侧栏折叠。
- 可选的实验性 DSH 内嵌面板、设备配对、角色授权及工具记录。

## 数据与隐私

运行后自动生成 data/，角色、聊天、记忆分别保存。模型请求会把对话、角色设定和选中的记忆发送给 DeepSeek；自动记忆和摘要可能额外调用模型。密钥默认保存在进程内，可通过 DEEPSEEK_API_KEY 环境变量提供；Windows 可勾选 DPAPI 加密保存。更换 Windows 账户或电脑后应重新配置密钥。

更新前在设置中导出完整备份。需要恢复时，在新目录启动应用，使用设置中的完整恢复入口。浏览器草稿/偏好另存 localStorage，不属于服务端备份。个人备份不应上传 GitHub。

## DSH 可选接入

参见 [插件安装说明](plugin/README.md)。需自行安装兼容 DSH，本项目不分发其安装包或运行库。本机已验证真实 DeepSeek 选择工具、DSH 读取测试文件及结果回传。详见 [实验功能边界](docs/LIMITATIONS.md)。多角色群聊尚未实现。

## 手机与电脑同步

设置中选择“手机与电脑局域网同步”，支持扫码或 USB 首次配对，确认后同一局域网自动同步角色、文字聊天与记忆。遇到独立创建的同名 AI，会询问合并或分别保留；确认合并后汇总聊天与记忆，并保存原始备份及不同设定副本。需要支持此功能的 Muse Cyrene 手机版本。步骤、同步范围和后台限制见 [局域网同步说明](docs/LAN_SYNC.md)。

USB 首次配对需要 Android Platform Tools。将 `adb` 加入 PATH，或在启动前设置 `MUSE_ADB_PATH` 为自己的 adb 可执行文件路径；扫码配对不需要 ADB。手机和电脑需要在能互通的同一局域网，电脑服务保持运行。

## 开发和验证

- `npm test`：自动化测试，使用临时数据和模拟提供方，不需要真实 API Key。
- `npm run verify:install`：在临时空数据目录启动本包服务，核对网页、角色、备份恢复及重启持久化。
- `npm run release:source`：按白名单生成 dist/ 下的干净源码目录和逐文件 SHA-256 清单；不会复制私人数据、依赖或开发截图。

本机 Windows/Node 24 验证不代表所有设备通过。首次使用请先以测试角色验证。当前是源码预发布版，不是独立桌面安装器，也不适合直接暴露到公网。

## 许可证

本项目源代码以 GNU GPL 第 3 版或任何后续版本提供，不提供担保；可按许可证条件修改和再分发。第三方组件维持各自许可，见 [第三方说明](THIRD_PARTY_NOTICES.md)。发布时应保留 LICENSE、NOTICE、来源及第三方声明。打包其他运行库或资源时需更新相应分发材料。

