# 工作区布局

新安装首次启动时选择布局；可跳过，默认经典工作台。设置 → 工作区布局可随时切换。
已有外观设置的用户迁移为经典工作台，不重复强制引导。

- 经典工作台：可折叠的主机分组侧栏、会话标签、终端。
- 主机管理：分组筛选和搜索、主机表格、详情面板，底部会话标签返回终端。
- 专注终端：默认收起侧栏，使用切换主机入口或 Cmd/Ctrl+K 搜索；仍可展开侧栏。
- 搜索中使用上下箭头与 Enter；已有连接优先复用。
- 终端配色、语言在设置中独立选择；布局和配色分别保存。

## 生命周期约束

所有 SessionPane 始终位于同一个 terminal-panel 内，以 tab.id 为 key。
切换布局只改变 CSS、侧栏显示与 active 状态。不得给终端祖先添加 layout key，
不得把 SessionPane 放入各布局的条件分支，不得在布局变化时修改 generation、
关闭 SSH 或重置终端。隐藏期间继续订阅输出并确认数据；重新显示后由
ResizeObserver 更新本地终端及远端 PTY 尺寸。SessionTools 同样保持挂载。

外观保存在 harbor.appearance，含 layout、layoutChosen、sidebarCollapsed、themeId。
首次选择后保存；旧格式保留主题与侧栏设置，补入 classic。损坏配置回到安全默认值。
存储不可用时仍可使用当次会话，但无法保证重启记忆。

## 验证

npm run test:layouts：本地真实 SSH 测试服务器，两个会话、终端 DOM 身份、
已有输出、持续输入、三个布局、窗口尺寸、快捷搜索、主题、语言、重启和旧配置迁移。
npm run test:appearance：四种窗口尺寸、PTY resize、六种主题。
npm run test:i18n：中英文界面、原生菜单、表单与会话状态保持。
npm test：存储、认证、身份库及安全边界。

测试使用独立临时 profile 和本地 SSH fixture，不连接用户服务器。
