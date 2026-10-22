# 参与开发

使用 Node.js 24+，无需安装 npm 依赖。运行 npm test 和 npm run verify:install；验证使用临时资料和模拟供应商，勿使用真实聊天作测试。

提交 PR 时说明问题、行为变化及验证。涉及记忆、备份、QQ 或同步的变更应覆盖失败恢复和数据边界。保持 src、web 与 test 一起更新，发布导出白名单位于 scripts/prepare-release.mjs。

不提交 data、memory、账号、日志、截图或外部组件运行库。按 GPL-3.0-or-later 提供贡献，保留来源和第三方声明。
