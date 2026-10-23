# 依赖许可证核对

核对日期：2026-10-23。范围：package-lock.json 的 183 个依赖记录（含开发及跨平台可选包）、本地运行时依赖许可证和打包脚本。结论：在保留第三方许可及版权声明的前提下，未发现阻止 Harbor SSH 自有代码采用 MIT 的依赖许可冲突。

## 运行时依赖

| 包 | 锁定版本 | 声明许可证 |
|---|---|---|
| @xterm/addon-fit | 0.11.0 | MIT |
| @xterm/xterm | 6.0.0 | MIT |
| asn1 | 0.2.6 | MIT |
| bcrypt-pbkdf | 1.0.2 | BSD-3-Clause |
| better-sqlite3 | 13.0.3 | MIT |
| buildcheck | 0.0.7 | MIT (local LICENSE) |
| cpu-features | 0.0.10 | MIT (local LICENSE) |
| nan | 2.30.0 | MIT |
| node-addon-api | 8.9.2 | MIT |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| safer-buffer | 2.1.2 | MIT |
| scheduler | 0.28.0 | MIT |
| ssh2 | 1.17.0 | MIT (local LICENSE) |
| tweetnacl | 0.14.5 | Unlicense |

ssh2、cpu-features、buildcheck 的锁文件缺少 license 字段，已读取本地 LICENSE 确认为 MIT。cpu-features 内附 cpu_features 使用 Apache-2.0，其全文一并收入第三方声明。bcrypt-pbkdf 包含多个来源的版权声明，以完整 LICENSE 为准。SQLite 的公共领域声明可在其源码中查阅，不能用包装库的 MIT 声明替代对内含组件的核对。

## 开发工具与分发义务

锁文件其余许可类型包含 ISC、BSD-2-Clause、Apache-2.0、BlueOak-1.0.0 和 MPL-2.0。12 个 MPL-2.0 记录为 Lightning CSS 及其平台包，属于开发依赖。当前打包使用 prune，并限制运行时内容；使用构建工具生成应用不等于把工具代码重新许可为 MIT。若未来分发或修改这些 MPL 文件，需按 MPL 保留通知并履行对应源码义务。

Electron 自身采用 MIT，并随运行时提供 Chromium 等组件的复合许可证声明。发布时须保留 Electron LICENSE 和 LICENSES.chromium.html，以及本项目 LICENSE、THIRD_PARTY_NOTICES.md；不得将全部依赖统称为 MIT。

本次未重新生成 DMG、ZIP 或 EXE，也未对安装包中每个原生组件逐一做来源审计。现有安装包不会自动获得新声明，发布前应重新打包并检查最终内容。依赖升级后须重新核对。本报告是当前依赖和文件的工程检查记录。

参考：[MIT](https://opensource.org/license/mit)、[MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)、[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)。
