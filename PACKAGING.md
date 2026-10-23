# Harbor SSH 0.4 安装与升级

## 当前交付

`release/` 包含当前 Mac 架构的 DMG、ZIP、SHA256SUMS 和 manifest.json。本机产物为 arm64，应用声明最低 macOS 13。已执行本机安装启动与升级测试；Intel、其他 macOS 版本及另一台 Mac 尚未验证。

当前没有可用的 Developer ID 证书，产物采用 ad-hoc 本地签名，未公证。`codesign --verify` 成功仅代表包内签名完整性，不代表通过下载分发的 Gatekeeper 检查。正式分发前需要 Apple Developer ID 签名、公证和独立机器验收。参见 [Electron 官方代码签名说明](https://www.electronjs.org/docs/latest/tutorial/code-signing)。

## 安装

1. 正常退出正在运行的 Harbor SSH 开发版或旧版，确保传输结束。
2. 校验 `SHA256SUMS`，打开 DMG，将 Harbor SSH.app 拖入 Applications。
3. 从 Applications 启动。ZIP 也可解压后复制到 Applications；升级时替换应用包。

应用不会自动下载升级，也不会在启动时自动重连服务器。不要同时运行两个版本写同一个数据目录。

## 备份与凭据兼容

正常退出后备份完整的 `~/Library/Application Support/Harbor SSH`，并保留原系统 Keychain。SQLite 中身份为 AES-256-GCM 密文；`vault-key.bin` 只是系统保护后的数据密钥。两者及相应 Keychain 缺一不可。备份不是跨机器导出格式。

已用真实 0.3.0 编译产物在独立配置中保存虚构密码、加密私钥和 passphrase，正常退出后启动从 DMG 安装的 0.4，验证可直接复用；数据库中的身份密文与 `vault-key.bin` 哈希均不变。无须导出秘密或重新封装数据密钥。

当前应用继续使用相同显示名称与系统保护路径。后续若改变应用身份、签名或 Electron 版本，必须重做兼容检查。本机验收不能替代其他签名身份、其他机器的测试。密钥不可用时保留原数据，不生成替代密钥；请先恢复原 Keychain 访问及原密钥文件，再「重试解锁身份库」。系统保护行为见 [Electron safeStorage 文档](https://www.electronjs.org/docs/latest/api/safe-storage)。

## 数据库版本与回退

0.4 继续使用 schema v3。v1/v2 首次打开前分别创建 `harbor.sqlite.v1-backup.sqlite`、`harbor.sqlite.v2-backup.sqlite`，不覆盖已有备份；结构迁移采用事务，失败回滚。遇到未来版本数据库直接拒绝写入。

回退前先退出应用并备份当前完整目录。使用独立 `HARBOR_DATA_DIR` 恢复旧版本数据库和对应的受保护密钥文件，并保留原开发运行时。不要让旧版直接写新版目录，不承诺新版新增配置能降级保留。

## 构建

```bash
npm ci
npm run package:mac
cd release
shasum -a 256 -c SHA256SUMS
```

需要 macOS、Xcode Command Line Tools；普通运行不需要 Node。构建脚本自动生成图标、裁剪开发依赖、ASAR 打包并解包原生 addon，检查 SQLite 架构，验证签名和 DMG，生成 ZIP 和校验和。测试配置、源码、脚本、截图不进入安装包。

可用证书存在时，设置 `HARBOR_SIGN_IDENTITY` 后运行相同打包命令。脚本会启用 hardened runtime 与 JIT entitlement；**此分支尚未用真实 Developer ID 验证**，也不会自动公证。需另行提交 Apple 公证、staple 并在隔离机器验证。manifest 明确记录 `notarized: false`。

## 可重复升级验收

`npm run test:upgrade` 会重新打包，然后使用真实旧编译目录 `test-artifacts/baseline-0.3.0`，或 `HARBOR_PREVIOUS_APP` 指定的 0.3.0 应用。基线不能用新版改版本号伪造，测试缺少基线会失败。测试创建独立配置、虚构 SSH 凭据和本地服务器，挂载真实 DMG、安装到临时 Applications，并从该包启动。

测试覆盖真实 0.3 数据保留、凭据复用、替换安装后重启、构造 v1/v2 数据库迁移、活动主机编辑及转发连接保持。实际包、原生 Keychain、数据库和 SSH 认证均执行真实代码。测试显式设置 Electron executablePath，跳过 Playwright 默认注入模拟 Keychain 的 loader；并断言该开关未启用。结果见 `test-artifacts/batch4-result.json`。
