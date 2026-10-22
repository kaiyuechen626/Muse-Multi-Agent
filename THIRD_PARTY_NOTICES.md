# 第三方组件与分发范围

本表针对本电脑端源码包，不是 Android APK 或 DSH 安装包的依赖清单。

| 项目 | 本包中的关系 | 许可与说明 |
|---|---|---|
| Muse v2.6.1 / Muse Cyrene | 来源、功能及数据格式参考；保留署名并采用 GPL-3.0-or-later | 根目录 LICENSE、NOTICE；原 Muse NOTICE 作为历史参考保留 |
| Node.js 24 | 用户单独安装；核心服务仅调用内置模块 | 不随包分发；Node 本身及其组件以其发行版许可为准 |
| @deepseek-ai/dsh-tools 0.2.0-rc.2 | 可选插件从用户 DSH 宿主导入 defineTool | 本机包声明 MIT，保留 licenses/DSH-tools-MIT.txt；不打包其代码 |
| @deepseek-ai/cordis 4.0.4 | DSH 宿主依赖注入接口，开发验证使用 | 本机包声明 MIT，保留 licenses/Cordis-MIT.txt；不打包其代码 |
| React | DSH 客户端提供的 UI 运行时，插件调用 require('react') | 不分发 React 代码或固定其宿主版本；以用户 DSH 的组件许可为准 |
| DSH agents/tools/webServer/slots/layout | 调用用户安装的 DSH 接口 | 不包含 DSH 整体或其他插件，不把已核对包的许可推及所有组件 |
| DeepSeek API | 在线模型服务 | 用户自行配置密钥；服务条款、额度和费用不由 GPL 提供 |

本包不包含 ML Kit、Junrar、Android 原生库、语音模型、音色包或 DSH 提取运行库。用户导入的角色卡、头像、背景、聊天和记忆不随发布包分发，其权利不由本项目授予。

`licenses/Muse-v2.6.1-NOTICE.txt` 原样保留上游历史分类，不能据此断言其中各依赖均存在于电脑端，亦不把历史分类视为重新核验结论。今后如捆绑安装器、Node、DSH、字体或其他资源，应针对新增分发内容更新本清单与适用许可文件。

QR Code Generator for JavaScript 1.4.4, Copyright (c) 2009 Kazuhiko Arase, MIT license. Vendored in web/vendor/qrcode.js with its original notice; used to generate local pairing codes.

