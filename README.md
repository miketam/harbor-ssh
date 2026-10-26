# Harbor SSH

简体中文 | [English](README.en.md)

Harbor SSH 是基于 Electron、React、TypeScript、ssh2 和 xterm.js 的本地 SSH 桌面客户端，提供多标签终端、加密身份库、SFTP 文件传输、本地端口转发和单跳跳板机。无需云端账号或 API Key。

当前源码版本为 **0.4.6**。主要开发与验证平台为 macOS；Windows 已提供构建脚本，仍需实机验收。应用在自己的目录存储数据，不读取、导入或修改其他 SSH 客户端的数据。

## 界面语言

顶部「语言」下拉框可切换 **简体中文 / English**，默认保留中文，重启后恢复选择。切换即时生效，不会断开 SSH 或清空终端；主机管理、身份库、认证、信任提示、SFTP、端口转发、菜单和应用错误提示均提供英文。

主机名称、分组、文件名、远程终端输出与服务器认证问题保持原文。系统文件选择器自带按钮由操作系统决定语言，应用提供的标题跟随所选语言。

开发验证：`npm run typecheck`、`npm test`、`npm run test:i18n`。翻译集中在 `locales/en.ts`，中文原文作为键，参数使用 `{0}`、`{1}` 占位；增加文案时同步补齐翻译。

## 界面预览

以下为本地测试环境的真实截图，使用示例账号和文件，界面显示 v0.4.1。截图展示中文界面；当前发行版本请以下载区为准。

**主机管理与 SSH 终端**：左侧选择主机，右侧操作终端，可切换主题。图中为 Dracula 主题。

![Harbor SSH 主机列表与 Dracula 主题终端](docs/images/terminal-dracula.png)

<details>
<summary>查看更多：加密身份库与 SFTP 文件管理</summary>

**加密身份库**：统一管理可复用的认证身份，列表显示保存状态，不展示密码明文。

![Harbor SSH 加密身份库及示例身份](docs/images/identity-vault.png)

**SFTP 文件管理**：连接后浏览远程目录、上传和下载文件，并查看传输状态。图中包含取消传输的测试记录。

![Harbor SSH SFTP 远程文件列表和传输状态](docs/images/sftp-files.png)

</details>

## 下载与安装

[最新 Release](https://github.com/miketam/harbor-ssh/releases/latest) · [v0.4.6 发布说明](https://github.com/miketam/harbor-ssh/releases/tag/v0.4.6) · [SHA256SUMS](https://github.com/miketam/harbor-ssh/releases/download/v0.4.6/SHA256SUMS)

下表为 v0.4.6 的固定下载链接；后续版本请查看最新 Release。

| 设备 | 推荐下载 | 备用下载 |
|---|---|---|
| 苹果 M 系列 Mac（Apple Silicon） | [arm64 DMG](https://github.com/miketam/harbor-ssh/releases/download/v0.4.6/harbor-ssh-0.4.6-mac-arm64.dmg) | [arm64 ZIP](https://github.com/miketam/harbor-ssh/releases/download/v0.4.6/harbor-ssh-0.4.6-mac-arm64.zip) |
| Intel Mac | [x64 DMG](https://github.com/miketam/harbor-ssh/releases/download/v0.4.6/harbor-ssh-0.4.6-mac-x64.dmg) | [x64 ZIP](https://github.com/miketam/harbor-ssh/releases/download/v0.4.6/harbor-ssh-0.4.6-mac-x64.zip) |
| Windows x64（Intel / AMD） | [EXE 安装程序](https://github.com/miketam/harbor-ssh/releases/download/v0.4.6/harbor-ssh-0.4.6-win-x64-setup.exe) | 暂无 Windows ARM64 原生安装包 |

Mac 可在苹果菜单的「关于本机」查看芯片：Apple M 系列选 arm64，Intel 处理器选 x64。Mac 包要求 macOS 13 或更新版本。Windows 可在「设置 → 系统 → 系统信息」查看系统类型。

- **Mac**：打开 DMG，将 Harbor SSH.app 拖到 Applications（应用程序），再从应用程序启动。ZIP 用户先解压，再将应用移入 Applications。
- **Windows**：运行 EXE，选择当前用户有写入权限的专用安装目录，再从开始菜单启动。详细升级和卸载行为见下文「Windows x64」。
- **升级**：退出旧版并备份应用数据，再安装新版。备份和兼容边界见 [PACKAGING.md](PACKAGING.md)。使用安装包无需安装 Node.js。

### 下载校验

同时下载 `SHA256SUMS`，计算所选安装包的 SHA-256，与其中同名文件的一行对照。

macOS（Intel 用户将文件名中的 arm64 改为 x64）：

```bash
shasum -a 256 harbor-ssh-0.4.6-mac-arm64.dmg
```

Windows PowerShell：

```powershell
Get-FileHash .\harbor-ssh-0.4.6-win-x64-setup.exe -Algorithm SHA256
```

摘要一致只确认文件与发布附件一致，不代表已经通过系统安全认证。

### macOS 安全提示

当前 Mac 包采用 ad-hoc 签名，未获得 Apple 公证，首次打开可能提示无法验证开发者。确认文件来自本仓库 Release、校验和一致且你愿意运行后：

1. 将应用移到 Applications，尝试打开一次并关闭提示。
2. 打开「系统设置 → 隐私与安全性」，找到 Harbor SSH 被阻止的提示。
3. 点击「仍要打开」，按系统要求认证并再次确认打开。

若提示「会损坏你的电脑」、检测到恶意软件或校验和不一致，请停止运行；若提示应用损坏，先重新下载并校验。没有「仍要打开」选项时，查看系统或组织管理限制。不要关闭 Gatekeeper 或 SIP，也不要批量清除下载文件的隔离标记。参见 [Apple 官方说明](https://support.apple.com/102445)。

### Windows 安全提示

当前 Windows 安装包未签名，可能显示未知发布者或「Windows 已保护你的电脑」。只有确认下载来源、校验和及文件名后，才在普通 SmartScreen 未识别应用提示中选择「更多信息 → 仍要运行」（如果系统提供该选项）。

若 Defender 报告恶意软件，或 Smart App Control / 组织策略禁止运行，请停止安装并联系管理员；不要关闭防病毒软件或全局安全防护。Smart App Control 不提供单个应用的绕过选项。参见 [Microsoft SmartScreen 说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)和 [Smart App Control FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)。

Windows 安装、卸载和运行仍待实机验收。Intel 包已在 Apple Silicon 兼容层通过 SSH/界面测试，仍待 Intel 真机验收。

## 从源码启动

下载项目源码并进入项目根目录后执行：

```bash
npm ci
npm run dev
```

新增主机，填写地址和用户名，选择认证方式后连接。首次连接前，请通过可信渠道核对服务器公钥指纹。

## 功能概览

- 主机分组、搜索与多标签终端。
- 密码、私钥和交互认证，支持保存加密身份。
- 首次连接确认指纹，指纹变化时阻断连接。
- 单跳跳板机、SFTP 上传下载及本地端口转发。
- 六种终端主题、可折叠主机栏和重启后恢复断开的标签。

## 启动

请先退出正在运行的旧版应用，再运行：

```bash
cd harbor-ssh
npm run dev
```

`dev` 先构建再启动，没有热更新服务器。已构建且源码没有变化时可直接 `npm start`。全新环境使用 `npm ci`，再执行 `npm run dev`。

环境：macOS、Node.js 22.12+（建议当前 LTS）、npm。依赖版本已由 lockfile 固定。SQLite addon 在 `postinstall` 中重建到 Electron 版本；无预编译文件时需要 Xcode Command Line Tools。普通使用不需要 Docker 或 API Key。

## 主机和连接

- 新增、编辑、删除、分组和搜索主机，支持 IP、域名、IPv6。顶部大标题区已移除，主机操作合并到标签工具栏。连接中也能修改主机信息，当前 SSH、文件传输和转发继续使用连接时的配置，下次连接才使用新配置；终端底部显示实际连接地址。
- 主机可关联一个可复用身份，或者使用临时密码 / 交互认证。连接时勾选「保存密码，下次连接复用」，会创建或更新加密身份并关联当前主机；下次及重启后连接无需重复输入。未勾选则保持临时使用。
- 首次连接确认 SHA-256 公钥指纹；指纹变化时阻断连接。核实后可在「已信任主机」中移除旧指纹。
- 双击主机或点击「新标签」打开新会话，最多 10 个标签和 10 个并发连接。同一主机可以开多个标签。
- 每个标签有独立工作进程、终端缓冲、认证问题和连接状态。关闭连接中的标签需要确认；关闭一个不会影响其他标签。
- xterm.js 交互终端支持 UTF-8、复制粘贴、PTY 窗口缩放。断开后保留当前内存中的输出，重连时清空。

## 界面与主题

- 终端顶部「收起主机栏 / 展开主机栏」可隐藏或恢复左侧栏，为终端腾出空间。收起或展开会同步调整终端和远程 PTY 尺寸，保留当前连接与输出。
- 顶部「主题」提供 Harbor 经典、One Dark、Dracula、Nord、Solarized 浅色和 GitHub 浅色。切换后立即应用于终端及右侧工作区，左侧主机栏与管理对话框保留原有纸色风格。
- 侧栏状态和主题保存在本机应用的 localStorage（仅界面偏好），重启后恢复；旧版没有配置时使用 Harbor 经典并展开侧栏。
- 开发验证：`npm run test:appearance`，使用独立配置与本地 SSH fixture，验证窗口尺寸、远程 PTY 缩放、主题切换及偏好恢复。

## 加密身份库

在左侧「加密身份库」新增密码、私钥或交互身份，再在主机编辑中选择身份。

- 身份名称、用户名、认证方式、密码、私钥、passphrase 整体使用 AES-256-GCM 加密，每次保存使用随机 12 字节 nonce。AAD 绑定格式版本及身份 id，阻止密文被换到另一身份。
- 随机 32 字节数据密钥通过 Electron 异步 `safeStorage` 加密，保护后的文件为 `vault-key.bin`。macOS 底层使用系统 Keychain；没有明文 localStorage 回退。
- 保存的秘密不会通过读取接口返回界面。编辑时明确选择「保留 / 替换 / 清除」，空占位符不会覆盖密码。身份列表只返回显示名称、用户名、方式和是否保存秘密的布尔值。
- 私钥支持粘贴或文件导入。文件最多 64 KiB，主进程读取，界面仅获得 5 分钟有效的导入 token；成功保存、到期或关窗后移除 token。
- 支持 OpenSSH Ed25519（含加密私钥）、传统 RSA PEM，以及 RSA/EC 的 PKCS#8 PEM（含加密）。PKCS#8 仅在连接内存中转换为 ssh2 支持的格式，身份库仍加密保存原始文件；不支持的类型会提示转换为 OpenSSH 格式。文件读取期间禁止提前保存。
- 可以保存 passphrase，也可以每次连接时输入。连接对话框复用已保存的密码/passphrase，不提供临时替换入口；修改已保存的凭据请在「加密身份库 → 编辑」中操作。未保存凭据时仍可在连接时输入，显式勾选保存后会更新加密身份。保存发生在认证前，认证失败时可在身份库修正；更新共享身份会影响引用它的其他主机。
- 交互认证支持多轮、多问题、按 echo 标记隐藏输入；可用于服务器密码、OTP 和公钥后的 MFA。回答不保存。
- 身份仍被主机引用时不能删除；修改正在使用的身份前，须先断开引用它的会话；主机元数据允许连接中编辑。切换认证方式会清除不再适用的秘密字段。

密钥保护不可用、保护文件损坏或丢失时，应用保留已有数据并报告身份库不可用；不会自动生成密钥覆盖旧库。恢复原文件和 Keychain 访问后，可点击「重试解锁身份库」。不依赖身份库的临时认证仍可使用。支持 macOS 和 Windows 系统密钥保护，Windows 尚待实机验收。

## SFTP 文件与本地转发

连接成功后，点击当前终端上方的「文件与转发」。操作复用此标签已验证的 SSH 连接，切换标签互不混用。

- **SFTP**：输入远程目录、进入子目录或返回上一级；使用系统文件对话框上传/下载普通文件。支持 Unicode 文件名、进度和取消，每个会话最多同时传输 3 个文件。
- 上传以独占方式创建目标，**同名文件不覆盖**。取消或传输失败时尝试删除本次创建的远端部分文件，不删除已有同名文件。若断网或服务端拒绝清理，可能残留部分文件，界面会提示。
- 下载先写入目标目录下的 `.harbor-<id>.part`（0600），成功后才替换选定目标；覆盖确认由系统保存对话框提供。失败或取消不覆盖已有目标。下载文件是用户选择的普通文件，不额外加密其内容。
- 当前不递归传输目录，不直接下载符号链接，不提供删除/重命名/远端编辑或断点续传。目录超过 10000 项会提示选择更小的子目录。
- **本地端口转发**：只绑定 `127.0.0.1`，本地端口填 `0` 自动选择空闲端口；远程目标地址/端口由目标 SSH 服务器访问。可查看和停止转发，每个会话最多 10 条。
- 手动断开、关闭标签、重载和正常退出会终止传输与转发。正常退出最多等待约 4.5 秒清理；强制结束、进程崩溃或断网可能留下部分文件。转发和传输不自动重建、不落盘恢复。

## 单跳跳板机

先保存一台可直接连接的主机，再在目标主机编辑窗口的「跳板机」中选择它。两台主机各用自己的身份，也各自校验和保存指纹；任一指纹变化都会阻断整条连接。

跳板机经 SSH `direct-tcpip` 连接目标，再在通道中完成目标服务器的 SSH 握手；没有本地 shell 命令拼接，也不把目标私钥交给跳板机。目标主机的地址由跳板机解析和访问。仅支持单跳，禁止自身引用和多跳链路；被引用的跳板机不能直接删除。主机配置修改在下次连接生效；修改被活动链路使用的身份，需先断开会话。

跳板机未保存的密码/passphrase 可在连接时临时输入，交互认证问题会显示对应主机名称。若希望保存跳板机密码，先直接连接它并勾选保存，或在身份库设置。

## 重启恢复与升级

工作区在标签新增、切换、关闭和主机选择时保存，只含标签 id、主机 id、标签顺序和当前选中项。重启会还原断开的标签，**需要手动重新连接**。不持久化终端输出、临时秘密或交互认证回答。尚未保存密码的身份仍会在连接时询问密码。

数据库由 v1/v2 事务迁移至 v3，原有主机、身份、指纹和标签保留。迁移前按原版本创建 `harbor.sqlite.v1-backup.sqlite` 或 `harbor.sqlite.v2-backup.sqlite`（不覆盖已有备份）；迁移失败不会部分修改表结构。v1 的用户名仍作为旧主机元数据保留，关联新身份后主机表不再重复保存该身份的用户名。不对 SQLite 历史空闲页做秘密擦除承诺。

macOS 数据目录为 `~/Library/Application Support/Harbor SSH`，开发版和安装版共享此路径，升级前须退出旧版。已使用真实 0.3.0 编译产物及原生系统 Keychain 验证升级，身份密文、受保护密钥文件、主机、指纹和标签均保留；无需重新输入已保存的秘密。此结论限本机和当前版本，其他签名身份及机器需重新验收。

目录包含：

- `harbor.sqlite`：主机、指纹、加密身份、非秘密工作区。
- `vault-key.bin`：由 safeStorage 保护的数据密钥，文件权限 0600。
- `harbor.sqlite.v1-backup.sqlite` / `harbor.sqlite.v2-backup.sqlite`：对应版本升级前备份。

主机名称、地址、端口、分组、旧式用户名、公钥指纹、跳板机关联和标签关联是明文元数据，身份内容是密文。只备份 SQLite 不足以恢复身份，还需要原 `vault-key.bin` 和相应系统 Keychain 访问；没有跨设备导出/恢复功能。回退旧版本应使用该版本升级前的备份和单独目录，不应让旧应用直接写入 v3 数据库。

## 安全边界

渲染进程启用 sandbox/contextIsolation、关闭 Node 集成；preload 仅开放固定接口。IPC 校验本地顶层 frame。身份读取不返回秘密；主机与工作区存储拒绝秘密字段。服务器指纹确认在认证前进行。响应按会话 id 和一次性请求 id 路由，旧请求不能覆盖新问题。重载或关闭界面会终止对应工作区的全部会话。

不加载远程 HTML；终端内容只交给 xterm。禁用 OSC 52 远程写剪贴板，不保存终端日志。临时输入、私钥及身份解密结果会进入客户端内存，JS 不能保证所有字符串副本都被清零。当前安装包只有 ad-hoc 本地签名；更新应用可能导致系统重新询问 Keychain 权限。正式 Developer ID 签名、公证及其他机器的 Gatekeeper 验证尚未执行。

## 验证

```bash
npm run package:mac          # 当前 Mac 架构 DMG、ZIP、签名验证、校验和
# Intel 交叉构建：HARBOR_MAC_ARCH=x64 npm run package:mac
npm run test:upgrade         # 重新打包并跑真实 0.3 基线到安装版升级验证
npm run typecheck
npm test                   # 存储、迁移、加密和 SSH 协议测试
npm run test:integration    # 第一批桌面功能回归
npm run test:batch2         # 实际 Keychain、身份库、多标签、交互认证、重启和密钥故障恢复
npm run test:openssh        # Docker 中真实 OpenSSH，密码/私钥/PAM 交互认证
npm run test:batch3         # Docker + 桌面：密码复用、PKCS#8、跳板、SFTP、取消、端口转发
```

测试使用独立的 `HARBOR_DATA_DIR` 和系统 `ssh-keygen` 生成的虚构凭据，不使用真实服务器账号。核心及第二批测试需要 PATH 中有 `ssh-keygen`（macOS 自带）。核心加密测试注入测试专用 key protector；桌面第二批测试使用真实 Electron safeStorage/Keychain，产品没有测试明文回退开关。

OpenSSH 测试拉取 `alpine:3.23`，临时安装 OpenSSH（第二批含 PAM），端口仅绑定 `127.0.0.1`，结束后删除容器。镜像和依赖可能留在 Docker 缓存中。测试结果和截图在 `test-artifacts/`，已被 gitignore 排除。本地历史验收报告不随源码发布；请在目标平台重新执行所需验证。

`HARBOR_DATA_DIR` 用于隔离测试配置，不是密钥绕过开关。正常使用不需设置它。

## 文件结构

- `electron/store.ts`：事务迁移、主机/指纹、身份密文和工作区。
- `electron/vault.ts`、`identities.ts`：系统保护的数据密钥、AES-GCM、秘密更新和身份解析。
- `electron/main.ts`：可信 IPC、导入 token、多会话生命周期、指纹与认证路由。
- `electron/ssh.ts`、`ssh-worker.ts`：私钥/密码/keyboard-interactive、单跳连接、独立 SSH 与 PTY。
- `electron/resources.ts`：SFTP 流式传输与取消、会话内本地转发、资源清理。
- `src/`：现有界面及身份管理、连接、认证问题、多标签终端组件。
- `shared.ts`：固定的 IPC 数据类型，不包含秘密读取接口。
- `tests/`、`scripts/`：协议 fixture、核心、桌面和真实 OpenSSH 测试。

设置中的「系统更新」会在启动时及运行期间每 6 小时检查 GitHub 最新稳定版，发现适用于本机的新版本时提醒，并可手动检查、打开发布页。下载与安装仍由用户操作；尚不包含后台自动下载安装。也尚不包含多跳、远程/动态端口转发、云端同步、硬件密钥、密钥轮换管理界面或 Developer ID 签名公证。

## Windows x64

安装程序：`release/harbor-ssh-0.4.6-win-x64-setup.exe`。运行后先在「选择安装位置」页浏览或输入安装目录，再点击安装；默认目录为 `%LOCALAPPDATA%\Programs\Harbor SSH`，按当前用户安装，从开始菜单启动。请选择当前用户有写入权限的专用文件夹；系统目录可能需要额外权限。

升级前退出旧版。0.4.2 起会记录安装目录，后续安装默认使用上次记录的位置；0.4.1 及更早版本没有该记录，若曾手动更改目录，升级时需重新选择。升级建议沿用原目录，改选其他目录不会自动清理旧应用文件。卸载只清理本安装包包含的文件及空目录，保留用户自行放入的其他文件，并保留 `%APPDATA%\Harbor SSH` 中的数据库和密钥文件。安装目录选项只影响程序文件，不改变数据目录。Windows 身份库使用系统密钥保护，不支持直接迁移 macOS Keychain 保护的身份库。

重新构建：安装 NSIS（Mac 可执行 `brew install makensis`，Windows 将 `makensis` 加入 PATH），执行 `npm ci`、`npm run package:win`。可用 `MAKENSIS` 指定编译器路径。脚本检查 Windows x64 SQLite 模块并输出独立 SHA-256 和 manifest，保留原有 Mac 安装包。

此包未签名；Windows 安装、升级、卸载、启动及 SSH/SFTP 和系统加密仍待实机验收。本 README 前文的 Keychain 和 Mac 路径说明适用于 macOS。

## 贡献

提交问题时请说明系统版本、应用版本、复现步骤和预期结果。日志与截图须先去除密码、私钥、令牌及内部服务器信息。提交代码前运行 `npm run typecheck` 和 `npm test`，涉及桌面交互或平台功能时补充相应验证。

测试使用虚构凭据；请勿替换为真实服务器账号。`test-artifacts/`、`release/`、依赖和构建目录不应提交到源码仓库。升级测试额外依赖旧版应用基线，参见 `scripts/batch4.cjs` 中的 `HARBOR_PREVIOUS_APP` 配置。

## 许可证

本项目自有代码采用 [MIT 许可证](LICENSE)，允许使用、修改、分发和商业使用，须保留版权与许可声明。

第三方依赖仍遵循各自许可证，完整运行时声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，本次依赖核对结果见 [DEPENDENCY_LICENSES.md](DEPENDENCY_LICENSES.md)。
