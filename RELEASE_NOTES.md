# Muse Multi-Agent 0.3.0-chatrooms.1

发行标签：`desktop-v0.3.0-chatrooms.1`，勾选 Pre-release。安装与验证范围见下文。

本版汇总自局域网版本以来的功能：2–8 角色聊天室、每角色记忆目录与聊天检索、QQ 图片交互、离线留言补回和经过预览确认的空间动态发布。手机公开文字聊天室同步需配套 Muse Cyrene 0.3.0-chatrooms.1。

安装 Node.js 24+，解压源码后双击 start-muse.cmd，或运行 npm start；无需 npm install。浏览器打开 http://127.0.0.1:3210/，填写自己的 API Key。更新前导出完整备份，在新目录启动并导入。DSH 与 NapCat 均为可选外部组件。

源码不含 data、记忆资料、账号、密钥、DSH/NapCat 运行库、模型或音色。QQ 与 DSH 需在自己的环境配置。聊天室不调用 QQ/DSH，手机同步仅覆盖兼容的公开文字范围。详见 docs/CHAT_ROOMS.md、docs/QQ_CHANNEL.md、docs/LIMITATIONS.md。

本次验证见 docs/VALIDATION.md。发布附件建议为源码 ZIP 和 SHA256SUMS.txt；本版没有独立 EXE。

保留 GPL-3.0-or-later、LICENSE、NOTICE 和第三方声明。本项目为非官方修改项目。
