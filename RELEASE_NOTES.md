# Muse Multi-Agent v0.1.0-alpha.1

面向 Muse Cyrene 使用场景的非官方电脑端实验项目。感谢原 Muse 作者 Mozi 及贡献者。本项目与上游 Muse、DeepSeek 无官方隶属或背书关系。

这是需要 Node.js 24 的源码预发布版，不是独立 EXE。解压源码包后运行 npm start，或 Windows 双击 start-muse.cmd；打开 http://127.0.0.1:3210/，自行配置 DeepSeek Key。基础应用无需安装 npm 依赖。

包含角色卡导入、单角色聊天、流式回复与停止、消息版本和分支、搜索收藏、本地记忆、备份恢复及设置。DSH 插件为可选实验附件，安装方法见 plugin/README.md；基础聊天不要求 DSH。

尚未提供手机实时同步、多角色群聊。真实 DeepSeek 工具往返与全新 DSH 安装仍待验收。自动记忆全量测试曾出现一次等待超时，复查通过但根因未确认，详见 docs/VALIDATION.md。不要把 Alpha 当作稳定版或直接暴露到公网。

代码采用 GPL-3.0-or-later，附 LICENSE、NOTICE、来源和第三方材料。附件不包含 API Key、个人角色/聊天/记忆、语音模型、音色或 DSH 运行库。

建议上传附件：Muse-Multi-Agent-0.1.0-alpha.1-source.zip、dsh-plugin-muse-multi-agent-0.3.3-alpha.1.tgz、SHA256SUMS.txt。本文件是可复制的发行说明草稿，不表示已经创建 GitHub Release。
