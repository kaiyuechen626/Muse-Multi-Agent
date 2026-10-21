# 来源与修改记录

日期：2026-10-21。发布主体使用 GitHub 账号 kaiyuechen626。定位：面向 Muse Cyrene 使用场景的非官方电脑端实验项目。

上游 Muse：https://github.com/Zer0Qing/Muse ，参考 Android 基线 v2.6.1 / d7ce76b9640e42afcb571fa3813c9bcf0779969c。版权署名 Mozi，GPL-3.0-or-later。Cyrene：https://github.com/kaiyuechen626/Muse-Cyrene 。电脑端不假称为上游官方发行，不把独立仓库等同于独立原创。

此电脑端在本地开发过程中以 Node.js 与浏览器界面实现。`src/characters.mjs`、`src/muse-package.mjs`、`src/bridge.mjs` 对接角色卡、角色导出包和备份字段；数据格式分析曾参考 Muse Cyrene Android 源码。`src/memory*.mjs`、`src/automatic-memory.mjs`、`src/chat-summary.mjs` 实现电脑端记忆和摘要；不宣称完整移植上游记忆系统。存储、界面、聊天、备份及 DSH 调用均随本包提供可编辑源码。

新增电脑端范围：角色管理与卡片导入、单角色聊天、回复停止及版本、聊天搜索分支和收藏、本地记忆管理及提取、备份恢复、Windows DPAPI、界面设置。`plugin/`、`src/dsh-connection.mjs`、`src/tool-completion.mjs`、`web/dsh-settings.js` 增加 DSH 嵌入、配对、逐角色授权、调度及审计。

许可整理没有逐行重建所有早期生成和参考过程，不据此主张所有代码均与上游无关。本项目代码按 GPL-3.0-or-later 提供，保留适用上游版权及历史 NOTICE；第三方材料保持各自许可。文件语言不同、接口调用或新建仓库本身均不构成权利来源证明。

发布包不携带上游 Android 源码树、图片、截图、语音、字体、模型或提取运行库。网页图形以代码和文字呈现，运行时用户导入资源不发布。原项目开发历史记录保留在本机，公开包采用专门编写的安装与限制说明。
