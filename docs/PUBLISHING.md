# GitHub 发布步骤

本目录可作为仓库根目录；发布附件在同级 release-assets 中。建议仓库名 `Muse-Multi-Agent`。构建脚本只生成本地产物，发布操作单独执行。

1. 在 GitHub 创建或选择自己的仓库。已有仓库应保留历史，在正常 clone 中审核并提交本目录的变更，不覆盖远端历史。
2. 提交前检查 git status、git diff 和忽略规则；不要复制原工作目录中的私密文件。保留 LICENSE、NOTICE 和第三方声明。
3. 运行本项目 README 中的验证命令。SHA-256 清单对应生成时的文件；修改文件后重新导出，勿使用旧摘要。
4. 推送审核后的提交，创建标签 `desktop-v0.3.0-chatrooms.1`，创建 GitHub Release 并勾选 Pre-release。
5. Release 正文使用 RELEASE_NOTES.md；附件使用 release-assets 中对应项目的文件和 SHA256SUMS.txt。APK 和源码 ZIP 作为 Release 附件，不提交到 Git。
6. 上传完成后从 GitHub 下载附件，核对哈希并按 README 试用。没有真实 API Key 也可运行源码验证；实际服务连接由使用者自行配置。

源码导出：npm run release:source。基础聊天不需要 npm install，.env.example 不会被应用自动加载；请设置进程环境变量或使用设置页。
