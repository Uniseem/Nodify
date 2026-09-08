# VPS 验收记录

日期：2026-09-08–09。目标：`185.99.135.224`，Debian 12 / amd64，Docker 29.7.2。源码来自本地工作区，未上传本机数据库、环境变量文件或私钥。

## Cloudflare Tunnel 发布、独立域名与完整应用接线

- 最终源码增量 `fixtures/tunnel-delta-routes.tar.gz` 共 65 文件，SHA256 `535356842d1b2f877950c261ef658a156d0363544dacd86ff256eb2722ff1658`。覆盖本轮发布设置、离线 CLI、共享契约，以及旧 SSH/订阅模块的接线修复；65 文件与工作区逐一核对。最终说明文档另存 `tunnel-acceptance-notes.tar.gz`，不覆盖已有源码、日志和冻结发布包。
- `linux-tunnel-routes-full.log`：最终三应用类型检查、构建和 **99/99 测试全部通过，无跳过**，含真实 Xray、sing-box、Mihomo、Nginx、PTY、TLS 来源下载和 cloudflared。Windows `tunnel-routes-typecheck.log` 三应用通过，`tunnel-routes-windows-full.log` **80 项通过、19 项需 Linux**。此前 `linux-tunnel-full.log` 98/98 与 `linux-tunnel-gateway3-full.log` 99/99 保留为对应旧快照证据。
- 最终镜像 `nodify-acceptance/panel:0.3.0-tunnel-routes` 从独立 `source-0.3.0-tunnel-routes` 目录构建；`linux-tunnel-routes-image.log` 成功，镜像索引摘要 `sha256:7d9fe41c1d1336383e8876f5a3ac9073d862f6c0c9d58ebba25459840446b624`。主控以独立 Valkey、临时 SQLite、回环端口 13501 启动，未挂载原有数据。
- `linux-tunnel-production-routes.log`：真实首次管理员注册/JWT；未登录管理接口 401；设置版本冲突 409；匿名私有页、主应用 JS、订阅 info 成功；无效令牌 401；生成的成员链接使用订阅域名，Agent 安装命令使用面板域名；恢复环境地址成功。订阅域名拒绝管理 HTTP、Agent 与高级 SSH WebSocket；面板域名下已注册 Agent 的 WebSocket 返回 101。
- 完整镜像曾暴露两项独立服务夹具未覆盖的冲突：旧 SSH 网关拒绝了 Agent 的 Upgrade 路径；旧订阅响应中间件占用 `/api/sub` 并返回 403。已修复前者的路由分工，并将旧订阅契约/控制器/中间件迁至 `/api/legacy-sub`。回归测试共同加载旧控制器及其真实中间件路由、新订阅控制器和两个 WebSocket 网关；最终镜像再次验证真实请求。
- 官方 cloudflared 2026.8.3 Linux amd64 二进制 SHA256 `f29324fe934d1e100617484c78deef803c4dc2cd351d645bbde42e96b4fccc5e` 已校验，实际执行两种配置的 `ingress validate` 与路径匹配。官方 Docker 镜像摘要 `sha256:51c9cefcb4569df44e1ad403ab1d3d8065aa8e84339bcfc6aee75502e1140339`，以只读、无网络容器成功校验生成配置；Compose 合并校验通过。此处没有启动公网 Tunnel。
- 使用最终主控镜像的 `dist/tunnel-config.js`，在无网络容器生成 Docker/裸机文件，与 API 生成的配置逐字节相同；安装和验证脚本通过 Bash 语法检查，已有输出目录被拒绝覆盖。`linux-tunnel-cli-overwrite.log` 保存预期拒绝。未安装专属 Tunnel systemd 服务，未重建本轮裸机发行包，因此不能将 CLI 验证计作其安装、升级或回退验收。
- HeroUI 使用真实控制器与临时 SQLite 验证：非法域名、双部署模式预览、保存、并发冲突保留、重新载入、恢复环境地址及断网保留输入。桌面 1300/1300、手机 345/345 无页面横向溢出；命令框局部滚动。深浅色均检查，深色 Select 仍有样式待整理。页面始终显示公网状态未验证；该 UI 夹具绕过登录守卫，JWT 证据来自上述完整镜像。
- 保留中间失败证据：初次脚本漏套餐必填字段；一次脚本误读取旧源码归档；SSH 空 URL 的类型错误随后修复。镜像测试还确认旧高级编辑器的 `wasm_exec.js` 缺失，本地构建亦缺 `main.wasm`，尚未修复；私有页主应用资源通过不等于该高级编辑器通过。失败记录包括 `linux-tunnel-production.log`、`linux-tunnel-production-final.log`、`linux-tunnel-production-final2.log`，均未作为通过结果。Windows 首次构建被临时 QA 进程持有 Prisma DLL 阻止，关闭该进程后构建通过。
- `tunnel-cleanup-check.log`：所有本轮临时容器和网络已移除，13501/34987 监听释放；原 Nginx/Xray/mmw-agent 仍 active，PID 保持 710164/824454/808506。原 Nodify current 仍为 0.1.0、原单位未启动，原数据/环境文件与冻结 0.1.0/0.2.0 归档 SHA256 一致。本机临时页面入口、13489/13490 进程及浏览器标签已关闭。源码、日志、隔离 QA 配置和候选镜像留作证据。

本轮仍为未冻结 0.3.0。未提供可用面板/订阅域名与 Cloudflare Tunnel 凭据，公网 DNS、远端 Healthy、实际客户端经 Tunnel 更新、其他架构及完整服务生命周期均未验收；整体目标仍未完成。

## Agent 自动连接回退

- 源码归档 `fixtures/direct-delta-full-auto.tar.gz` 共 49 文件，SHA256 `eb596836cb95ff2b78d698ec06d10049fa0672d203e81162d87f9223495a55ad`，基于前一轮 direct 源码更新。`linux-auto-full.log` 全套 **94/94，无跳过**；此前专项 `linux-auto-core1.log` 为 5/5，最终增加直接请求超时及迟到确认测试。
- 真实 Nest HTTPS 主控和 Linux Agent 首先使用 WSS，在已计量的 VLESS 流量入库后破坏 WebSocket 连接、丢弃确认；相同会话/序号经直连重报，额度没有再次扣减。下载内容 65,536 字节，关闭并重启 Agent 后再次向持久化队列放入实际批次，仍去重。
- 同一真实 PTY 会话内停用、重新启用主控直连，再恢复 WebSocket，观察 direct → pull → direct → ws 的已认证心跳；Shell 环境变量保持，跨通道重排任务只向文件写入一个字节。所有 TLS 校验开启，仅测试进程及其 Agent 显式信任测试 CA。显式 direct 路径仍只有首次注册向主控发起 HTTP 请求。
- 本机 `auto-full-windows.log` 76 项通过、18 项跳过，未设置此前的可选内核路径；这些跳过项全部在 VPS 实际执行。`auto-typecheck.log`、`auto-build.log` 三应用类型和构建成功。实际浏览器测试连接隔离 VPS API/Agent，看到直连待用、直连、拉取和恢复 WebSocket；选择复制“仅拉取”后运行中的 Agent 仍显示 auto，避免复制即应用的假状态。手机 CSS 宽度 345/345，桌面 1309/1309，深浅色已检查。夹具调用真实控制器和服务，但绕过管理员 JWT，不作为生产管理员鉴权验收。
- VPS 三应用类型检查、构建及 `bash -n deploy/install.sh` 全部通过。独立源码目录 `source-0.3.0-auto` 由上一轮 direct 快照加本轮已核对的 49 文件构成，不覆盖旧候选目录。构建 `nodify-acceptance/agent:0.3.0-auto`，镜像索引 SHA256 `cbc52db96273f2f78bf110ae06065249f1152ae433a0c83906bc6b9cf05a707f`；主控 `nodify-acceptance/panel:0.3.0-auto`，索引 SHA256 `1fa97d78a180924dc9468f9c8f5ed18e3aefcc253371a5f52619fa1f9c81e097`。日志为 `linux-auto-agent-image.log` / `linux-auto-panel-image.log`，没有推送公开仓库；镜像文档来自构建快照，最终记录另存。
- `linux-auto-image-check.log` 实际运行新镜像中的 tini、独立监督进程及 Agent；容器禁止外网，出站 WebSocket 不可用时经自身 HTTPS 接口交付任务，验证两次任务确认只执行一次、错误直连凭据 401，日志无凭据。此项使用测试凭据和响应驱动器；端到端真实主控/协议/终端由上述完整测试覆盖。
- `auto-cleanup-check.log` 确认专项、全套、UI 和镜像测试容器已移除，13491/34987 已释放。原 nginx / xray / mmw-agent 的 PID 仍为 710164 / 824454 / 808506，数据及环境文件 SHA256 一致，原 Nodify 0.1.0 current 和 inactive 状态不变，冻结 0.1.0 / 0.2.0 包校验全部通过。本机 13489/13490 已关闭，浏览器 40 已关闭并重置视口，临时前端入口已删除。
- 自动模式的裸机首次安装会保存显式提供的直连配置，原环境文件不会被覆盖。此次没有重装 VPS 原有 systemd 服务，不能据此认定 0.3.0 最新包完成安装、升级与恢复生命周期；版本仍未冻结。

## 主控主动访问 Agent 的 HTTPS 直连

- 对照 [远程服务器连接模式](https://miaomiaowux.com/docs/remote-servers/)，增加显式 direct。该阶段 auto 为 WebSocket → HTTPS 拉取，其后新增自动直连回退见上节。首次注册依然由 Agent 访问主控；后续由主控访问 Agent HTTPS 接口获取/回复统一通道消息。
- 完整回归源码 `fixtures/direct-delta-full.tar.gz` 为 49 文件，SHA256 `9876dd27ca8d22aef53706a46b6bee7c7b1bc3d35c707965fb03fb6e425a8865`。在隔离 R7 构建容器中覆盖执行 `linux-direct-full.log`，**92/92，无跳过**；三应用类型检查、构建及安装脚本 Bash 语法检查通过。包括此前入站传输、模板规则、PTY 以及本轮直连代码。
- `tests/agent-direct.test.mjs` 四项覆盖共享 HTTPS/凭据校验、密文保存/普通接口不回显、留空保留、版本冲突、真实 TLS 请求、错误凭据、不可信证书、请求 ID 重传、主控调度租约和跨服务器身份。实际 Linux Agent 注册后主控只收到一次 enroll HTTP 请求；管理、凭据轮换、重复任务和 PTY 全部通过直连，重放任务只向文件写入一个字节。
- 同一实际 Agent 经任务通道发布 VLESS，Xray 客户端下载 **65,536 字节**，协议用户计量入账；关闭并重启 Agent，在其持久化队列重放已确认批次，队列清空而用户额度没有再次扣减。测试为隔离回环目的地显式允许 `127.0.0.1/32`，没有改变生产默认出站限制。服务器凭据撤销会原子禁用主控直连，过期/变更的连接不会继续发送缓存任务响应。
- 初次 core 夹具缺少 openssl，未算通过；补齐测试工具后 core2 **4/4**。增加实流量路径后 core3 缺少 sing-box 路径，core4 没有显式允许回环目的地，均超时失败；修正测试夹具后 `linux-direct-core5.log` **4/4**，随后执行上述完整回归。生产 TLS 验证和出站默认限制未关闭。
- UI 在浏览器通过 SSH 转发访问真实控制器、隔离 SQLite 和 VPS Agent，验证启用、认证状态、地址/凭据错误保留、错误端口及恢复、留空保留凭据、外部并发更新后拒绝旧版本、失败保存保留输入、网络恢复不覆盖草稿。最终补充“正在载入”和“无法刷新连接状态”，避免错误显示正在保存或沿用在线提示。实际文档宽度手机 **345/345**、桌面 **1309/1309**，无横向溢出；浏览器缩放使实际 CSS 宽度与请求视口不同。UI 夹具绕过管理员登录守卫，不能替代新接口的正式登录流程验收。
- 最终 `fixtures/direct-delta-final.tar.gz` SHA256 `0e8ace2723a06127ebef45cd614869aa070aa0c20893446cf67dee8acffa2f74`，49 文件与工作区逐项一致；与 full 归档相比仅 `apps/frontend/src/pages/dashboard/nodify/agent-connection.tsx` 的状态提示修正不同。Windows 最终 **85 项通过、7 项需 Linux**，日志 `direct-full-tests-final.log`；最终类型/构建日志 `direct-typecheck-final.log`、`direct-build-final.log` 均通过。浏览器 39 已关闭、视口重置，前端临时入口及 13489/13490 本地进程已清理，VPS UI 容器已停止。
- 从新的 `source-0.3.0-direct` 构建最终源码，日志 `linux-direct-agent-image.log`、`linux-direct-panel-image.log` 均成功。Agent 镜像 `nodify-acceptance/agent:0.3.0-direct` 的索引摘要为 `sha256:7766d0ce8dce139ff9358b6eb2992dd6ddaa68260c176147e4a5d96a6c62c783`；主控镜像 `nodify-acceptance/panel:0.3.0-direct` 为 `sha256:b29cd539061f8fc3ab6cc248bcf1a09400aac75fda036d94de716921864c0406`。镜像未发布到公共仓库。
- `linux-direct-image-check-final.log` 在无外部网络的 Agent 镜像内启动真实 supervisor 与 Agent，用隔离 TLS 控制端验证预登记身份、直连接口、错误凭据拒绝和任务两次回执只执行一次。首次检查夹具括号错误导致语法失败，修正夹具后执行成功；产品源码未因此更改。此项不是新候选的完整主控部署、裸机安装、升级、回退或恢复验收，相关生命周期仍待更新；当前版本继续保持未冻结。
- `direct-cleanup-check.log` 确认本轮临时容器全部移除，13491/34987 监听释放。原 Nginx/Xray/mmw-agent 保持 active，PID 710164/824454/808506 不变；原 Nodify 数据/环境文件、current 指针及冻结 0.1.0/0.2.0 归档校验一致。49 个最终源码文件在镜像构建后再次核对未变，文档补记另存于 `fixtures/direct-acceptance-notes.tar.gz`，不修改已构建候选产物。

## 交互终端与进程回收

- 在隔离目录 `/opt/nodify-acceptance-20260908-01` 验收。最终 40 文件源码归档 `fixtures/terminal-delta-final.tar.gz` SHA256 为 `6d4481474997693c0b008a910907bed07138169052a51008dcc5ecc08596c173`，逐文件与工作区核对一致；包含此前模板规则选择和入站传输改进。在 R7 构建容器中覆盖后，`linux-terminals-final.log` **88/88，无跳过**，三应用类型检查和构建通过。
- `tests/terminal.test.mjs` 验证一次性开启、输入/输出序号去重、跨服务器隔离、匿名 Agent 拒绝、加密持久化、普通任务不泄露内容、输出限额和过期清理。真实 Agent 分别经 WSS 和 HTTP 备用端点启动 Bash PTY，验证环境/目录保留、中文、窗口缩放、Ctrl+C、关闭会话及 SIGTERM/SIGKILL 后回收。最终断言要求子进程 `/proc/<pid>` 消失。
- 前期 chain1 夹具与已有地址冲突；chain2 清理逻辑误把被信号终止的 Agent 当成尚未退出，等待第二次 exit 导致超时。修正后 chain3 专项 3/3。首次全套安装因误改 xterm 版本导致 peer 依赖冲突，恢复仓库原版本；full2 干净 npm ci、88/88、类型和构建通过。随后浏览器测试发现后台任务留下僵尸进程，增加 Go subreaper 和镜像 tini，才执行上述 final 回归。未执行的 full3 归档不计作证据。
- `nodify-pty/1` 由 Go 1.26.5、creack/pty 1.1.24 构建；测试用 amd64 二进制 `fixtures/nodify-pty-reaped` SHA256 为 `64b43bdee6a68ee9b8734d080097a6c32b461622d32f73d0c1dd0a01045ce5ef`。arm64 仅交叉编译成功，SHA256 `1fd52dc2f7f9c3c1709e166bfd0a84d9d622ea875a9b1715e83be791d5a0f46a`，没有执行验收。
- 浏览器通过 SSH 转发访问真实控制器、SQLite 和 VPS Agent。UI 夹具绕过管理员登录守卫，不能代替正式登录鉴权验收。验证开关、环境/目录保留、中文、Ctrl+C、移动输入、窗口尺寸 27×177 / 27×50、390/390 手机宽度。短暂断连后排队命令仅写入一个字节；持续断连后显示页面失联、输入禁用，恢复不自动重启。最终源码过长 UTF-8 输入保留并提示，连接状态不误报。最终 helper + init 容器的后台 PID 118 在租约到期后消失。
- Agent 镜像 `nodify-acceptance/agent:0.3.0-pty` 从新的 `source-0.3.0-pty` 构建，日志 `linux-terminal-agent-image.log`。镜像索引摘要 `sha256:6fe5e0b38da1c801bc03ac2140367906ce0cc763402f0fa075e7bd0a8f839dc7`；实际入口为 tini → Node → Agent supervisor。`linux-terminal-agent-package-check.log` 验证镜像内 helper 自动发现、真实 Bash、尺寸和子进程回收，PID 1 为 tini。
- 新裸机候选输出到 `release-0.3.0-pty-candidate`，没有覆盖旧目录。主控归档 SHA256 `829ffd1e53d47cada122cb9290f21feb54c4fc39a8f08d52d377611d049fa4c7`，Agent 归档 `711bd55e309513b1c1ff65ebe10a9c55adb24b095d6473fcc732249dd722e28e`。`linux-terminal-native-package.log` 构建成功；`linux-terminal-native-check.log` 两包归档及完整文件清单验证通过。首次夹具末尾 CRLF 导致 Node 模块路径多一个回车，修正夹具后 `linux-terminal-native-check-resumed.log` 用包内 Node/helper 在宿主系统完成真实 PTY 和进程回收。此项直接执行包内程序，没有安装或接管 systemd 服务；候选包文档来自构建快照，最终验收补记另存。
- 本机最终全套 **82 项通过、6 项需 Linux**，日志 `.local-tmp/terminal-full-tests-final.log`；类型和三应用构建成功，日志 `terminal-typecheck-final.log`、`terminal-build-final.log`。临时浏览器 38 已关闭、视口重置，前端测试入口已删除，13489/13490 本地进程及 VPS UI 容器已停止。本轮为未冻结 0.3.0 候选；不能将此前 R7 生命周期结果直接计为这次 PTY 发行包的完整升级/回退验收。
- `terminal-cleanup-check.log` 确认本轮三个临时容器、13491/34987 监听已释放；原 Nginx/Xray/mmw-agent 仍 active，PID 为 710164/824454/808506。原 Nodify current 仍指向 0.1.0、服务未启动，原数据/环境文件及冻结 0.1.0/0.2.0 归档 SHA256 全部一致。候选包、测试源码与日志保留用于后续验收。

测试目录：`/opt/nodify-acceptance-20260908-01`。测试使用独立 Docker 网络、数据卷、管理员、成员及自签名测试证书。证书校验保持开启。该证书和生成的用户均不用于正式服务。

## 入站传输与 URI 导入后续验收

- 在 `nodify-acceptance/build:0.3.0-r7` 的一次性容器内覆盖源码，包含上一轮模板规则选择与本轮传输配置。首轮 20 文件 `fixtures/inbound-transport-delta.tar.gz` SHA256 为 `2473cfdf5976da5165e6a1efed5a4d8ff6fa5b417739a8eac04330c063b62d6a`；`linux-inbound-transports.log` 全套 **85/85，无跳过**，三应用类型检查和构建通过。
- 追加 method 别名断言的 20 文件归档 `inbound-transport-delta-final.tar.gz` SHA256 为 `9ff36daaaa88e224d5e8d13a8c635e318b8073e510100b9d34ae32dc8e0c2698`，`linux-inbound-transports-final.log` 专项 **3/3**。随后审查发现 URI 导入仍把 XHTTP 模式写在顶层，修复后使用新的 22 文件归档，不覆盖上述证据。
- 最终 `fixtures/inbound-transport-delta-import.tar.gz` SHA256 为 `02bbf4c053eca63285b55d0df47f0ad0d2fdbfc4133f24b8ccd5636f4f88e4de`，22 个文件与工作区逐文件核对一致。`linux-inbound-transports-import.log` 再次全套 **85/85，无跳过**，最终三应用类型检查与构建全部通过；外部 URI 导入保留 Host、ALPN 和嵌套模式，错误 ALPN 结构被拒绝。原来源测试中顶层 mode 的错误断言同时修正。
- 真正运行 Xray 26.7.28 服务端、sing-box 1.14.0 和 Mihomo 1.19.30 客户端。VLESS/VMess/Trojan 的 TLS WS 使用不同的 SNI 和 Host；VLESS TLS XHTTP 覆盖 auto、packet-up、stream-up、stream-one。共 **14 次 × 77,824 字节** 下载内容完全一致，Xray 用户统计覆盖实际下行。Mihomo 路径先将生成的 URI 重新导入，再使用该配置连接，防止只验证内部对象。测试 CA 显式信任，未跳过证书验证；错误 Host、证书域名及 packet-up 服务端搭配 stream-one 客户端均失败。
- SQLite 验证保存不提前更新订阅、Agent 确认后生效、失败保持原配置、重试后更新且节点 UUID 不变；Mihomo 不兼容的 VMess XHTTP 被过滤并给出原因，sing-box 无节点时继续拒绝访问。编译器固定受管 network 对应的 method，保留草稿中的未知参数。
- HeroUI 浏览器验收使用本地真实配置服务、测试证书与隔离 SQLite，覆盖 Host/ALPN 错误、心跳编辑、JSON 字段保留、WS/XHTTP 切换、模式选择、保存与清空可选参数。文档尺寸桌面 **1270/1270**、手机 **380/380**。自动化工具的空字符串 fill 未触发状态更新，改用全选/退格后核对 JSON 与数据库，确认真实删除成功；未把最初未更新的操作算作通过。界面夹具直接调用服务，不能代替生产鉴权或公网 GUI 客户端导入验收。
- Windows 最终 `inbound-transport-import-full-tests.log` **81 项通过、4 项在 VPS 验证**，`inbound-transport-import-typecheck.log` 和 `inbound-transport-import-build.log` 三应用全部通过。本轮未重建冻结发行包，尚不能作为最新版 Docker/systemd 安装与升级验收；完整目标仍未完成。

- 三轮临时测试容器均已自动移除，34987 监听释放。原 Nginx/Xray/mmw-agent PID 仍为 710164/824454/808506。本机临时 13489/13490 监听、浏览器 36/37 标签及前端测试入口已关闭，视口覆盖重置。冻结发行归档未写入。

## 模板规则集选择后续验收

- 基于已验证的 `nodify-acceptance/build:0.3.0-r7`，在一次性容器内覆盖本轮 14 个源码/测试文件；未修改该镜像、冻结归档或原主控数据库。迁移新增 `NodifySubscriptionTemplate.ruleMode` 与 `NodifySubscriptionTemplateRule`，原模板默认附加全部启用规则。
- 首轮增量归档 `fixtures/template-binding-delta.tar.gz` 的 SHA256 为 `6c2c3b6b3340d7ea26c9d6f026074acd0007680f6b1546eef43eb235c6caac52`。`linux-template-bindings.log` **82/82，无跳过**，三应用类型检查与构建通过。实际 Mihomo 1.19.30 与 sing-box 1.14.0 分别验证文件全部规则、跟随模板规则；模板场景刻意设置排在前面的未选中拒绝规则，确认不会进入订阅。DIRECT、PROXY、REJECT、停掉代理后的行为及真实 GeoIP 资源均有断言。
- SQLite 集成验证模板关联事务与版本冲突、删除引用保护、停用/全局排序、主订阅与文件覆盖、默认模板切换、URI 不附加规则、到期拒绝；向新数据库恢复加密包后，模板关联、文件继承和实际订阅输出保持一致。校验同时拒绝错误的 sing-box 规则数组结构，避免预览或订阅生成时崩溃。
- Windows 全套 `template-binding-full-tests.log`：78 项通过，4 项在 VPS 验证。浏览器直接访问本机隔离 SQLite 和实际控制器的测试入口；验证保存再编辑、复制保留、并发冲突保留名称/选择、刷新可选规则不覆盖草稿、文件跟随与覆盖并保存。最初 iframe 操作出现定位超时，改用直接页面重新验证持久化后的流程，未将失败尝试算作成功。
- 预览曾出现页面横向溢出，改用可滚动换行的代码块。浏览器视口能力请求 390/1280 宽度，实际报告文档分别为 **345/345、1154/1154**；模板预览、冲突提示及文件规则编辑无横向溢出。不将工具请求尺寸冒充实际 CSS 视口。
- 随后仅修改两个前端管理器的 15 秒超时和中文断连提示；通过真实 HTTP 连接不响应的本地夹具验证超时解除忙碌、保留列表，并在恢复响应后成功重试。此 UI 夹具不代表生产鉴权或公网客户端验收。
- 最终增量 `fixtures/template-binding-delta-ui-final.tar.gz` SHA256 为 `ff577dbe8c383d37212b431ccaced89500e7f6081da57d399836fdf782b0e996`；逐文件比较确认与首轮只相差上述两个前端文件，后端、契约、迁移及测试相同，14 个文件均与当前源码一致。`linux-template-bindings-ui-final.log` 最终三应用类型检查及构建通过；Windows `template-binding-typecheck-complete.log`、`template-binding-build-complete.log` 同样通过。本轮尚未重新生成冻结发行包。
- 两轮临时容器均已自动移除、34987 监听已释放，原 Nginx/Xray/mmw-agent PID 仍为 710164/824454/808506。浏览器测试标签 34/35 已关闭，临时视口覆盖已重置，本机 13489/13490 测试进程和前端测试入口已清理。

## R5 Linux 发布验收与真实远程存储（连接恢复后）

以下记录取代下方历史段落中的“SSH 中断、尚未部署、待清理”当前状态描述；历史测试边界仍保留。

- SSH 已恢复，未推断中断原因，也未重启宿主机。先执行 `acceptance-030-r2/cleanup.log` 对应清理，原数据及环境文件逐项 SHA256 匹配，旧 0.1.0/0.2.0 发行包保持不变。
- R5 完整源码归档含 5,210 个文件，21,637,657 字节，SHA256 `7d62923821fd3a3d34da445ecf1822784f3eb45982d3584826e5cec73755bfce`；未夹带本机数据或私钥。VPS `source-0.3.0-r5` 构建 `nodify-acceptance/{build,panel,agent}:0.3.0-r5` 和 `release-0.3.0-r5-verified`，四个构建目标全部成功。`acceptance-030-r5/release-verification.log` 核验两个归档及所有 manifest 文件，内置 Node v24.20.0。
- Linux 全套 **78/78，无跳过**，包括 WireGuard TCP/UDP 真实内核、远程备份 HTTPS 负例及此前所有协议/规则/网站用例；日志 `linux-030-r5-tests.log`。类型检查首次因容器内 Node 约 1 GiB 堆限制 OOM，调整为容器 3 GiB、Node 堆 2 GiB 后通过，日志 `linux-030-r5-typecheck-final.log`，未修改源码绕过检查。
- `acceptance-030-r5/docker-lifecycle.log`：全新 Docker 主控、管理员、Agent 握手、六协议每项 262,144 字节下载；凭据轮换、重启、网站、失败配置回退、AnyTLS 禁用/超额撤权、套餐快照和显式同步、认证 SSE、HTTPS 备用通道；向新数据卷恢复加密包后验证管理员、Agent、证书解密下发、订阅、用量和新增配置/账本/设置连续性。损坏包拒绝覆盖，覆盖恢复先创建当前备份。
- `bare-lifecycle.log`：主控和 Agent 实际 0.2.0 → 0.3.0 升级、重启、0.2.0 回退；主控管理员/数据库结构、Agent 认证及真实任务均验证。卸载保留数据后重装、全新 0.3.0 部署和同版本重装通过；同版本不同 manifest 在停止主控前拒绝。
- `bare-restore.log`：systemd 停写离线恢复、恢复前备份、健康检查和恢复管理员登录通过。另构造加密与完整性均有效但缺少启动所需表的备份，启动失败后自动恢复预备份，主控健康与管理员登录再次通过。夹具 trap 在移动原目录前安装，结束后原安装/数据/环境文件恢复。
- `agent-upgrade.log`：独立监督进程安装并认证校验通过的 0.3.0 包，错误 SHA256 拒绝并重连；写入持久化升级日志后强制杀死 Agent 容器，再启动时恢复上一版本并上报失败任务。真实版本改变另由上述 systemd 0.2.0 → 0.3.0 用例覆盖。
- `docker-upgrade.log`：独立实例完成 0.2.0 → 0.3.0 → 0.2.0；管理员、服务器和新设置经重启保留，停写快照回退恢复旧表结构及数据。这是运维命令协调流程，不代表存在自动 Docker 回退按钮。
- 真实存储验收使用新的隔离 MinIO 实例和 Nginx 1.26.3 WebDAV 实例，没有操作 VPS 原有存储。MinIO 固定摘要 `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`，mc 固定摘要 `sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727`。无宿主端口，独立网络/卷、测试证书与凭据，HTTPS 校验开启。首次 mc 参数错误经夹具清理后修正，再执行日志 `storage-acceptance-resumed.log`，无产品源码绕过。
- 真实 Nodify 服务和 SQLite 分别执行两次定时备份：加密上传、认证读回、SHA256/长度核验、解密数据库、保留 1 份并确认旧远端 404；重启两个存储服务后再次下载及解密通过，列表接口不返回秘密。`storage/results/summary.json` 保存非秘密摘要。此证据覆盖 MinIO S3 兼容与 Nginx WebDAV，不覆盖 AWS、R2 等具体云服务商。专项容器及网络已清理，私有验收卷和密文证据保留。
- R5 实际生产页面经 HTTPS 校验代理完成管理员登录，390px 登录文档无横向溢出，前端/主控版本均 0.3.0。真实用户高级页暴露 `/api/internal-squads/` SQLite 500，因此没有冻结 R5。旧标签 28 已由后续浏览器清单确认为不存在；R5 问题复现标签 30 已关闭。
- `acceptance-030-r5/cleanup.log`：R5 主流程临时容器和网络已停止/移除，原服务 PID Nginx/Xray/mmw-agent **710164/824454/808506** 未变，原安装目录、数据和环境文件 SHA256 以及旧发行包 SHA256 全部匹配。独立 Docker 升级专项随后通过并在 finally 中清理自己的容器/网络；证据卷保留。

### R6 查询与导航复核（已完成，恢复计量边界另修）

- 修正内部组列表/详情和配置档案嵌套入站查询的 `selectAll()`，SQLite JSON 聚合使用明确列选择；同时让 JSON 排除字段识别 snake_case SQL 列名和 camelCase 聚合键，避免改变原始配置字段。新增 SQLite 实际仓库测试覆盖列表/详情、空关联、计数和未知 JSON 字段。
- 手机、桌面和页面内主入口共享同一导航列表，手机补齐服务器/节点/套餐/证书/备份等入口。语言选择改为 HeroUI Dropdown，退出改为有名称的 HeroUI Button，清除相关嵌套按钮；旧高级面板设置入口仍保留。
- Windows 全套 **75 项通过、4 项需 Linux**，类型检查和三应用构建通过；日志 `sqlite-navigation-tests.log`、`sqlite-navigation-typecheck.log`、`sqlite-navigation-build.log`。R6 源码归档 5,212 文件，21,639,049 字节，SHA256 `d36aadf11f2551886c152f651e0c1cc99ea26de71797639396831534a5db0584`。R5 生命周期证据不自动等于 R6 最新代码通过，后续结果继续单独记录。
- R6 `linux-030-r6-tests.log` 全套 **79/79，无跳过**，新 SQLite 仓库用例和所有实际内核/HTTPS/任务用例通过。
- 四个构建目标、Linux 三应用类型检查、两包 SHA256 及逐文件验证通过。包摘要：主控 `baaaaf48a395f8b30d57b2762d08f950f4e68923514057672ab70956d9103514`，Agent `b16dd895e932ea409562f9e587d7ea40b700863a73845c19976ce6720843db5b`，仅标记候选。
- 新实例六协议下载通过；网站检查发现夹具目录 0700/文件 0600 导致非特权 Nginx worker 读取失败。只修正公开夹具为 0755/0644，从失败步骤续跑，日志 `docker-lifecycle-resumed.log`；配置失败回退、套餐撤权、SSE/备用通道、加密恢复及恢复后六协议下载通过。`legacy-read.log` 通过正式管理员登录验证内部组/档案列表与详情及用户/主机/节点等接口。
- 实际页面完成登录、语言中英文切换、手机菜单进入服务器/套餐/备份、旧高级用户页显示真实成员、主题及退出登录。390px 容器内服务器和备份文档 380/380，1280px 容器内文档 1270/1270；服务器页无嵌套按钮、跳转后无残留导航弹窗。高级旧页面仍有其他兼容控件，未宣称全面清理。首次 iframe 在服务恢复切换期间未加载，稳定后新页面通过；没有绕过鉴权或关闭 HTTPS 校验。
- **额外发现：**第二次从旧快照恢复后，有一个备份后下发的计费策略不在数据库内，Agent 的一批真实用量收到 `400 Unknown traffic policy` 并一直保留。原先脚本只验证已有账本及后续连接，未检查所有离线批次清空。因此 R5/R6 的通过记录不能视为完整恢复计量连续性通过，0.3.0 仍不冻结。
- `cleanup.log` 已清理 R6 临时服务和网络，原数据及旧发行包校验一致。Agent 数据卷连同该待补报批次保留为问题证据；本机测试标签 31–33、代理 13488 和 SSH 转发 13487 已关闭。

### R7 恢复后计费策略凭据（Linux 与实际恢复补报通过）

- 新下发的配置携带主控 AES-GCM 认证加密的计费凭据，绑定服务器、策略 ID、签发时间和当时的用户计量方向/倍率/额度代次，不含协议密码。Agent 与原始会话、序号、采集时间一起持久化、补报。
- 恢复后找不到原操作时，主控验证凭据及绑定，在同一流量事务内保存加密的策略证据、账本和额度增量后确认。已有数据库策略仍为权威来源；不同服务器/策略、篡改或其他类型密文拒绝。没有可验证凭据的旧未知批次继续保留，不猜测倍率，也不丢弃数据。
- 收紧重复批次处理：其他持久化唯一约束异常不能冒充“该批次已接收”。SQLite 实际唯一约束故障回归验证不错误确认、事务回滚后可重试。
- 新增加密备份到新实例的实际 SQLite 恢复测试，覆盖快照后策略、密钥恢复、凭据拒绝、历史倍率、重复上报、服务实例重建及重置代次不重复扣费。Agent 重启补报用例增加凭据保留断言。Windows 全套 76 项通过、4 项在 Linux 验证，类型检查和三应用构建通过；专项最终 5/5（`traffic-policy-tests-final.log`）。早期专项因夹具未显式发布用户策略而失败，修正夹具后通过，初始日志保留。
- R7 源码 5,214 文件、21,644,532 字节，SHA256 `e31042de8a6a64fd31f3337223b3418337c13ea38fd2dbdb72da1365829b6696`，目录 `source-0.3.0-r7`。`nodify-acceptance/{build,panel,agent}:0.3.0-r7` 与 `release-0.3.0-r7-verified` 四个目标成功；`linux-030-r7-tests.log` **80/80，无跳过**，`linux-030-r7-typecheck.log` 三应用通过。
- `acceptance-030-r7/release-verification.log`：两包及逐文件 manifest 校验通过，Node v24.20.0。候选包 SHA256：主控 `0ff8b1446fa9b28cd72244b2c9636ca2925eebca557f90f0c065b011fc1c8ac3`，Agent `9b20270fc0574310e7ab1f483a201cd4b8612fe841f74f8ead4e0c3223b33ca3`。**0.3.0 仍未冻结为最终交付版本**。
- `docker-lifecycle.log`：新实例、管理员、Agent、六协议每项 262,144 字节成功。公开夹具文件的创建模式仍被 umask 收紧为 0600，网站读取返回 403；补齐创建后的显式 chmod 0644，未修改应用权限策略。`docker-lifecycle-resumed.log` 从该步骤继续，网站、配置回退、套餐撤权、SSE/HTTPS 备用通道、加密恢复、恢复后六协议和配置/账本/设置检查均通过。
- 本次增加确定性恢复场景：先向新卷恢复并发布新策略，再停止主控，通过仍在工作的 AnyTLS 完成 **262,144 字节真实下载**。直接读取 Agent 队列，确认至少一批具有计费凭据，且其策略 ID 在备份数据库中不存在。再次离线恢复同一旧备份后，检查该会话/序号在 `NodifyTrafficBatch` **恰好一条**、恢复的策略证据已持久化、所有协议待补报队列清空。随后鉴权心跳确认 `pendingTrafficBatches=0`、`trafficError` 为空，服务器已连接。无需丢弃批次、改写流量或关闭认证。
- 上述修复保证尚在 Agent 队列中的批次可验证、入账和去重。备份之后已经被旧主控确认并移出 Agent 队列的历史数据，仍需较近备份或原主控数据恢复；没有承诺恢复到比备份更新的完整数据库状态。
- `acceptance-030-r7/cleanup.log` 确认 R7 临时容器、网络和监听已清理，测试数据卷、候选包和日志保留。原 Nginx/Xray/mmw-agent 仍为 PID 710164/824454/808506，原数据、环境文件及 0.1.0/0.2.0 发行包逐项 SHA256 一致。


## 历史：WireGuard 本地专项（当时尚未部署）

- 再次 SSH 仍在 banner exchange 阶段超时，未修改 VPS 上的原服务。Windows 新增 WireGuard 出站表单和共享校验，使用真实 Xray 26.7.28 的用户空间实现完成 VLESS → WireGuard → 隔离 TCP/UDP 服务与用户统计检查。3 项专项通过，完整回归 74 项通过、4 项需 Linux；日志 `wireguard-tests.log`、`wireguard-full-tests-final.log`。
- 接收端使用 freedom redirect 将 `10.66.0.1` 测试目标映射到回环服务，避免内核拒绝直接传入回环目标。下载 344,064 字节、UDP 回传 1,024 字节；不依赖 WARP、公网 WireGuard、系统 TUN 或修改宿主路由。这些范围尚需单独验收。
- 本地 UI 在实际草稿服务与隔离数据库中核对版本 3 的 MTU、peer 顺序、双栈网段和未知字段；确认/取消移除使用 HeroUI 弹窗。手机文档 380/380、桌面 1270/1270。早期原生确认框导致标签 28 的 CDP 操作超时，未将该次检查算作通过；后续标签 29 完成验证并关闭。标签 28 的主动关闭也超时，未确认其清理状态。13485/13486 服务及两个临时前端入口已清理。
- 三应用构建、类型检查日志为 `wireguard-build-final.log`、`wireguard-typecheck-final.log`。后续使用含 R4 改动的 `release-030-r5-source.tar.gz`，先清理 VPS 的 R2 临时环境，再完成 Linux、裸机及 Agent 升级生命周期。正式发行包未冻结。

## 连接中断期间的本地备份改进（尚未部署）

再次连接仍报 SSH banner exchange 超时；本机未安装 Docker/WSL，未以本地检查替代 Linux 生命周期。继续完成远程备份上传后回读校验、共享契约和 HeroUI 存储表单。新增 6 项真实 HTTPS WebDAV/S3 协议夹具测试全部通过，全套 Windows 71 项通过、4 项需 Linux；这些新用例尚未在 VPS 执行，也没有宣称使用真实云存储服务商。三应用类型检查、构建及本地数据库 UI 检查日志位于 `remote-backup-*.log`。表单在隔离数据库中验证，生产鉴权未覆盖；13483/13484 和临时前端入口已清理。

最新源码包含 R3 入口修复及上述备份改进，应使用 `release-030-r4-source.tar.gz` 继续 Linux 构建，旧 R3 归档保留。VPS 上 R2 主流程临时容器仍需先清理；后续裸机安装、升级、回退、恢复、Agent 独立升级与中断测试及最终冻结未完成。

## 0.3.0 候选发布与完整入口检查（同日，未冻结）

- 首版源码目录 source-0.3.0、镜像 nodify-acceptance/{build,panel,agent}:0.3.0、归档 release-0.3.0-verified。首版 Linux 69/69 和 Windows 65 项通过；Docker 全流程通过，但真实登录发现外层仍显示上游品牌/版本，因此未冻结为最终发行包。
- R2 使用 source-0.3.0-r2、nodify-acceptance/{build,panel,agent}:0.3.0-r2、release-0.3.0-r2-verified，应用版本仍为 0.3.0。全套 Linux 69/69 无跳过，日志 linux-030-r2-tests.log；Linux 类型检查 linux-030-r2-typecheck.log。Windows R2 构建、类型检查和 65+4 项记录在本地 release-030-r2-*.log。
- acceptance-030-r2/docker-lifecycle.log：全新主控和 Agent、六协议每项 262144 字节实际下载；凭据轮换、重启、Nginx、无效配置回退、AnyTLS 撤权与恢复、认证 SSE、HTTPS 备用通道。新 DNS/策略先保存草稿再发布并等 Agent 确认；实际网卡和协议账本、月周期、幂等校准、首页设置经正式管理员 API 写入。恢复到新卷后确认这些字段、审计记录和实际生效版本保留，六协议再次下载；损坏备份拒绝覆盖，覆盖恢复创建预备份。
- acceptance-030-r2/docker-upgrade.log：独立临时网络/数据卷中的 0.2.0 → 0.3.0 → 0.2.0 实测通过。保留旧管理员及服务器记录，确认新增表出现、新设置经重启保留；停止写入、执行 SQLite 检查点及快照回退，旧表结构和旧管理员恢复。脚本 fixtures/docker-upgrade-030-r2.mjs 的 finally 已移除该专项容器及网络，数据卷保留为验收证据。
- R2 裸机包已逐文件核验，日志 acceptance-030-r2/release-verification.log，内置 Node 24.20.0。尚未执行本轮 systemd 生命周期与 Agent 升级监督测试；准备脚本位于 fixtures/*030-r2*，不能把脚本存在写成测试通过。
- 浏览器经本机 SSH/HTTPS 校验代理访问正式 R2 页面，完成真实管理员登录，并读到前端 0.3.0 / 主控 0.3.0。此入口没有绕过后台鉴权。390px iframe 登录文档实际 380px、scrollWidth 410px，发现溢出；手机兼容侧栏也未正确折叠及生成路由链接。
- 本地 R3 已修复登录宽度、连接中/错误/重试、HeroUI 手机导航及真正的路由链接；通过 Vite 当前源码接真实 VPS API 再验证，登录宽度 390/390，关闭菜单不再有旧侧栏，菜单链接成功进入用户管理路由。网络中断后未声称该高级页数据加载成功。未登录新来源下实际显示中文连接失败与重试按钮。R3 三应用生产构建及类型检查通过，Windows 全套 65 项通过、4 项需 Linux；本地日志 release-030-r3-build.log、release-030-r3-typecheck.log、release-030-r3-tests.log。本机 13479/13480/13482 和本轮浏览器页已关闭。R3 尚未上传和构建 Linux 产物，不等于修复已进入 VPS 安装包。
- 首版临时服务由 acceptance-030/cleanup.log 确认清理；此前原 Nodify 数据和环境文件逐项 SHA256 通过，冻结 0.1.0/0.2.0 包校验仍通过。最后成功检查原 Nginx/Xray/mmw-agent PID 为 710164/824454/808506。R2 流程完成后 SSH 出现 banner exchange 超时，HTTP 探测也无响应；没有推断故障原因、重启整机或修改原服务。R2 主流程的临时容器/网络仍待恢复连接后用 fixtures/cleanup-030-r2.sh 清理。
- 下一步以本地 release-030-r3-source.tar.gz 为最新候选，完成 Linux 构建与部署，执行最终裸机生命周期及 Agent 独立升级，核验并冻结最终 SHA256 清单。两套已有 0.3.0 候选和更早冻结归档均保留；没有将候选的包名或已通过的模块测试当作全项目交付完成。

## 结构化 DNS 与 Hosts 回归（同日）

- `dns-source/` 挂载后端、Agent、Prisma、契约及测试到 `nodify-acceptance/build:0.2.0`，契约依赖复用 `system-source/packages/nodify-contract/node_modules`。脚本 `dns-vps.sh`，日志 `linux-dns-tests.log`；最终全套 **69/69，通过，无跳过**，容器自动移除，34987 端口关闭。
- 新增两项 DNS 用例：混合地址/对象编辑、别名/未知字段保留、Hosts 安全改名及校验；真实 Xray 通过 SOCKS 将域名交给内置 DNS，再经两个隔离 UDP 上游解析并访问回环 HTTP。逐项检查 Hosts 别名不上游、域名优先匹配、过滤后回退、skipFallback、命中禁用回退、finalQuery 截断及单服务器禁用缓存。该证据没有使用外部 DNS 或改写 `/etc/resolv.conf`；没有覆盖全部 DoH/DoQ、ECS、并行及过期缓存模式。
- Windows 全套 **65 项通过，4 项在 VPS 实测**，日志 `dns-full-tests.log`。三应用生产构建和类型检查日志 `dns-build-final.log`、`dns-typecheck-final.log`。首轮本地测试已执行解析断言，但子进程清理只判断 exitCode 导致等待已发出的退出事件；修复为同时判断 signalCode、先订阅退出再终止后，用例和全套均正常结束。没有重启或终止其他应用进程。
- 加密恢复断言验证版本中的混合 DNS 列表、Hosts IPv4/IPv6 数组、回退设置及高级未知字段。配置仍通过已有草稿/发布/确认逻辑；新表单不会修改主机系统 DNS，也不改变用户统计 API。
- 本地浏览器使用真实配置服务与独立 SQLite 验证多行逐字输入、端口错误修正、排序、重名拒绝、Hosts 改名、未完成条目保护、删除取消/确认，并通过读取保存版本核对配置。390px iframe 内实际文档 380px，展开高级表单无横向溢出；1280px 浅色桌面检查通过。该测试入口绕过生产鉴权。临时 13471/13472、四个前端验收文件及浏览器页均清理。
- 本轮源码归档 `dns-source-final.tar`，解包到 `dns-source/`，发行归档不变。原 Nginx、Xray、mmw-agent 保持 active，PID 710164、824454、808506 未变。新源码仍需新版本的安装、升级、回退与恢复生命周期验收。

## Xray 系统策略与连接观测回归（同日）

- `system-source/` 中后端、Agent、Prisma、契约及测试挂载到 `nodify-acceptance/build:0.2.0`。契约依赖复用上一轮 `overview-source/packages/nodify-contract/node_modules`；脚本 `system-vps.sh`，日志 `linux-system-tests.log`。最终全套 **67/67，通过，无跳过**。
- 新增 `tests/xray-system.test.mjs` 四项测试：共享契约与未知字段保留；真实 Xray 两种观测和策略加载；SQLite 草稿/确认/失败保留；真实后台观测故障切换。后者用隔离容器中的两个本地 HTTP CONNECT 出口，分别设置健康响应延迟，经真实 Xray VLESS 和 SOCKS 链路下载，验证 A → B → 直连备用 → A；真实 StatsService 用户下行与出站下行均增长。目的地址全部为测试进程的回环服务，不改原有代理配置。
- 统计保护测试在输入中关闭用户/入站统计并试图改变 API，验证发布产物仍强制开启所需统计且只绑定回环。额外出站统计开关保留，但 Agent 用户配额采集仍只查询用户计数，未把诊断计数再次收费。后台实际切换通过不代表全部突发观测调度、leastLoad、UDP 或超时组合完成验收。
- Windows 全套 **63 项通过，4 项在 VPS 实测**，日志 `system-full-tests-final.log`；三应用构建及类型检查日志 `system-build-final.log`、`system-typecheck-final.log`。开发中修复过测试夹具对初始已应用版本和加密任务返回值的错误假设；最终测试读取真实持久化状态与任务载荷。出站断言通过独立 Xray CLI 查询，未修改只查询用户计数的生产 Agent。
- 浏览器使用本地真实配置服务及独立 SQLite，验证新增等级未追加时阻止保存、数值/时长/采样校验、错误聚焦及编辑清除、后台/突发切换、等级删除取消与确认、保存后未知策略和高级 DNS 保留。固定 390/1280px iframe 文档宽度为 380/1270px，无横向溢出，深色手机/浅色桌面可读。该入口绕过生产鉴权，没有据此宣称公网管理员端到端验收。临时 13461/13462 进程、四个前端入口文件及浏览器页已清理。
- 源码和记录归档 `system-source-final.tar`，解包到 `system-source/`。冻结 `0.2.0` 发行归档保持原样；原 Nginx、Xray、mmw-agent active，PID 710164、824454、808506 未变。新源码仍须随新版本完成安装、升级与回退验证。

## 首页容量和趋势回归（同日）

- 使用 `overview-source/` 中后端、Agent、Prisma、契约及测试，基于 `nodify-acceptance/build:0.2.0` 依赖重新生成 Prisma；契约依赖复用 `accounting-source/packages/nodify-contract/node_modules`。脚本 `overview-vps.sh`，日志 `linux-overview-tests.log`；全套 **63/63，通过，无跳过**。测试完成后容器自动删除，34987 端口关闭。
- 新增首页 SQLite 集成覆盖有限额/不限量/未知容量、逐项剩余及超额、校准只影响当前用量、外部双向快照不进趋势、到期和失败标记、禁用来源排除、设置版本冲突、网卡先合并再取最大方向、真实零与缺失日期、空选择及 40 位以上十进制汇总。备份恢复继续验证首页全局设置、服务器统计范围与校准同时保留。
- Windows 全套 **59 项通过，4 项在 VPS 实测**，日志 `overview-full-tests.log`；三应用生产构建与类型检查日志 `overview-build-final.log`、`overview-typecheck-final.log`。本轮测试仍包括既有真实 Xray、sing-box、Mihomo、Nginx 和网络计量回归，没有用模拟成功替代生产操作。
- 本地浏览器用真实控制器、独立 SQLite 验证双页面冲突保留、重新载入最新设置、筛选空状态、来源链接、外部到期提示和断连保存失败聚焦。内置视口覆盖未改变实际尺寸，改用 390/1280px 固定 iframe；内部文档为 380/1270px，无横向溢出，卡片分别单列/四列。此回环入口绕过生产鉴权；没有宣称完整公网管理员流程或手机客户端实机验证。临时 13451/13452 进程、四个前端验收文件和浏览器页已清理。
- 源码和文档归档 `overview-source-final.tar`，解包到 `overview-source/`。这是在既有 0.2.0 构建环境上的源码回归，未覆盖冻结发行包，也不等于新版本安装、升级、回退已验收。原 Nginx、Xray、mmw-agent 保持 active，PID 710164、824454、808506 未变。

## 服务器周期与校准回归（同日）

- `accounting-source/` 挂载本轮后端、Agent、Prisma、契约及测试，基于 `nodify-acceptance/build:0.2.0` 的依赖环境重新生成 Prisma 客户端；契约依赖由既有 `network-source/packages/nodify-contract/node_modules` 复制。全套 **61/61，通过，无跳过**；日志 `linux-accounting-tests.log`，复现脚本 `accounting-vps.sh`。原六协议连接、独立 AnyTLS 计量/撤权、网卡计数、Nginx、HTTPS 来源和恢复继续通过。
- 新迁移 `20260908110000_traffic_accounting`。测试验证 UTC 月周期的短月/闰年/跨年与边界时刻；旧周期迟到批次不污染新周期。最大值模式先扣除上/下行基线，再求较大值，测试特意覆盖重置后主方向反转。校准及手工基线不改变用户配额或原始账本。
- 同一请求 ID 重试只产生一条记录，修改请求内容后重用 ID 被拒绝；旧周期、旧设置和旧对账版本不能提交。注入 SQLite 审计插入失败，验证用量修改和版本一起回滚。历史 54 条记录分为 50/4 两页，游标无遗漏或重复，其他服务器不能复用该游标。
- 容量变化保留调整，数据源/接口/方向/重置日变化建立新口径并保留旧记录。周期切换由读取时的 UTC 时间确定，不靠定时任务修改累计。无样本时手工设定零用量有明确标记，清除后恢复未知。加密备份恢复确认校准值、基线记录及审计请求/前后快照保留。
- Windows 全套 **57 项通过、4 项在 VPS 实测**，日志 `accounting-full-tests-final.log`。浏览器使用本地实际控制器和独立 SQLite，验证月周期 200 字节与原始累计 2,200 字节区分、双页并发 600→500 校准、500→0 归零、0→200 清除、四条审计记录、31 日取月末、输入保留及窄屏布局。断连提交保留原因并聚焦中文错误；此夹具绕过生产管理员鉴权，不能代替公网完整操作验收。
- 校准以当时已经收到的计数为基准，同周期后续离线补报仍会增加已知用量。当前使用 UTC 月账期及日账本边界，不做跨日采集插值；部分历史、计数器中断和时钟回退需结合页面提示判断。未宣称自动对齐云厂商账单，也未实现任意时区/账期、大规模并发或历史保留清理。
- 三应用生产构建和类型检查通过，日志 `accounting-build-final.log`、`accounting-typecheck-final.log`。源码覆盖层及文档归档为 `accounting-source-final.tar`，解包到 `accounting-source/`；其余源码及依赖使用 `source-0.2.0` / `nodify-acceptance/build:0.2.0` 与上述契约依赖。临时容器、34987 端口、本地 13441/13442 API/前端和浏览器测试页均关闭。
- 原 Nginx、Xray、mmw-agent 保持 active，PID 为 710164、824454、808506。冻结 `0.2.0` 和 `0.1.0` 发行归档保持不变；本轮为新增源码回归，后续发行仍需新版本安装、升级、回退和恢复生命周期验收。

## 系统网卡账本回归（同日）

- 使用 `network-source/` 中后端、Agent、Prisma、契约及测试，基于 `nodify-acceptance/build:0.2.0` 依赖环境重新生成 Prisma 客户端。全套 **58/58，通过，无跳过**；日志 `linux-network-tests.log`，脚本 `network-vps.sh`。首次运行因新挂载目录缺少契约 `node_modules/zod` 失败；复制既有 `daily-source/packages/nodify-contract/node_modules` 的已验证依赖后重新执行全套通过，没有修改校验或跳过用例。
- 新增 Linux 用例向隔离 Docker 容器的默认网关发送 32 个 1,024 字节 UDP 数据报，从真实 `/proc/net/dev` 读取所经接口计数并验证 TX 增量至少包含这些数据。目标为测试网络的宿主网关，未向外部站点发包；这验证内核采集路径，不是所有网卡驱动、虚拟化平台或宿主机重启的实测。
- 实际 Agent 子进程读取原持久化网络批次，首次响应故意返回错误确认序号，第二次仍上报相同会话、序号和采集时间；匹配确认后才移除。真实 HTTP 与 WebSocket 使用同一批次验证跨通道去重，未认证请求被拒绝。协议流量确认也增加序号匹配检查。
- SQLite 验证网卡与协议/用户额度隔离、单接口筛选、跨日归档标记、缺失接口提示、管理员文件汇总及用户历史不混入网卡流量。破坏既有日账本数值会导致事务回滚，批次、累计及配额不前进；修复后重报成功。加密备份恢复确认接口选择、网卡累计、日账本和去重记录。
- Windows 全套 **54 项通过，4 项在 VPS 实测**；日志 `network-full-tests-final.log`。浏览器通过本地真实控制器及独立 SQLite 验证空选择拒绝、eth0/多接口保存、管理员 6,000 字节网卡汇总与用户 300 字节协议用量独立、每日基线/跨日提示、窄屏无横向溢出、断连保留和错误聚焦。API 夹具绕过生产管理员鉴权，测试值通过实际计量服务写入，不能据此宣称公网认证和客户端 GUI 已验收。
- 新迁移 `20260908100000_network_traffic`。首次采集及 boot ID/ifindex/计数器/时钟变化建立新基线；不估算缺口前的流量。跨日间隔全部归入采集结束日并提示，未实现精确日界分摊。接口选择可以包含虚拟接口，管理员需避免网桥成员或隧道上下层重复选择；当前没有网络拓扑自动归因。
- 三应用生产构建和类型检查通过，日志 `network-build-final.log`、`network-typecheck-final.log`。模块源码覆盖层与文档归档为 `network-source-final.tar` 并解包到 `network-source/`，其余源码/依赖沿用 `source-0.2.0` 与上述已验证依赖。临时容器、34987 端口、本地 13431/13432 API/前端及浏览器页均关闭；原 Nginx、Xray、mmw-agent 仍 active，PID 为 710164、824454、808506。
- 本次为源码回归，冻结 `0.2.0` 和 `0.1.0` 发行包未覆盖。网卡账本新增代码仍需纳入后续版本的安装、升级、回退验收；服务器周期与校准、大规模并发、保留清理及整机断电仍需继续完成或实测。

## 协议日账本回归（同日）

- `daily-source/` 挂载本轮后端、Agent、Prisma、契约和测试，基于 `nodify-acceptance/build:0.2.0` 重新生成 Prisma 客户端并使用全新隔离 SQLite。全套 **54/54，通过，无跳过**；日志 `linux-daily-tests.log`，复现脚本 `daily-vps.sh`。六协议、AnyTLS 计量/撤权、真实 Nginx、HTTPS 来源及备份恢复继续通过。
- 真实 Agent 子进程读取持久化待确认批次，首次上报返回 503，重报保留原会话、序号和采集时间；确认后清空待确认记录。SQLite 验证离线日期、时钟回退、重复批次、冻结倍率、重置后旧周期补报，以及缺少原用户策略的流量。故意破坏日账本数值导致提交失败时，用户配额、服务器累计和批次确认一起回滚；修复后重试可完整入账。
- 新迁移 `20260908090000_daily_traffic` 保存原始上传/下载、原策略计费 `rated`、实际配额入账 `charged`，以及无策略和未入账原始量；均为十进制字符串。旧周期补报可能有计费金额而没有当前配额入账，界面分别显示。加密备份恢复用例确认账本及报告数保留。
- Windows 全套 **51 项通过、3 项在 VPS 实测**，日志 `daily-full-tests-final.log`。HeroUI 本地独立 SQLite/实际控制器夹具检查服务器及用户筛选、7 天快捷日期、无上报与真实零值、390px 视口、断连后保留结果并聚焦错误。夹具以真实计量方法写入受控测试数据，绕过生产管理员鉴权，不能代替公网认证及客户端 GUI 验收。
- 日期按 UTC；缺少采集时间或时钟异常则按接收日期归档并标记。无记录日期不是零，收到报告也不代表整天覆盖。查询限连续 1–90 天及 50,000 行。当前只含启用日账本后收到的协议用户增量，不回填以前累计；网卡账本、服务器周期/校准、节点或入站维度、跨服务归因和大规模性能仍待实现或验收。
- 三应用生产构建和类型检查通过，日志 `daily-build-final.log`、`daily-typecheck-final.log`。`daily-source-final.tar` 解包至 `daily-source/`，内容为本轮模块及测试源码覆盖层，依赖和其余源码基线为 `source-0.2.0` / `nodify-acceptance/build:0.2.0`，不是独立发行安装包。
- 临时容器、34987 端口、本地 13421/13422 API/前端和浏览器测试页均已关闭。原 Nginx、Xray、mmw-agent 保持 active，PID 分别为 710164、824454、808506。冻结的 `release-0.2.0-final`、`release-0.2.0-verified` 和 `0.1.0` 归档保持不变。本轮源码回归不等于新版本发行包的安装、升级、回退验收。

## 服务器协议累计与上游流量回归（同日）

- `traffic-source/` 挂载当前后端、Agent、Prisma、契约及测试，基于 `nodify-acceptance/build:0.2.0` 重新生成 Prisma 客户端，全套 **50/50，通过，无跳过**。日志 `linux-traffic-tests.log`，脚本 `traffic-vps.sh`。这仍是源码回归，不是新发行包的生命周期验收。
- HTTPS 来源夹具经真实网络返回大整数流量头；验证畸形头拒绝、下载失败保留快照、成功无头清空旧流量信息。原证书校验、15 秒截止、重定向拒绝、5 MiB 限制继续通过。临时 34987 端口仅在测试期间使用。
- 新 SQLite 回归覆盖服务器协议累计与批次原子去重、旧权益代次仅进入服务器累计、用户配额重置隔离、服务器模式与设置版本、文件服务器选择、外部标签与方向、未知/过期标记及私有页不混入管理员数据。原加密恢复用例验证服务器原始累计保留。
- Windows 全套 47 项通过、3 项在 VPS 实测；追加 `traffic-restore-final.log` 验证加密恢复中的文件服务器选择及外部流量、方向、有效状态。三应用构建和类型检查通过，日志 `traffic-build.log`、`traffic-typecheck-final.log`。
- HeroUI 使用本地实际控制器和独立 SQLite，操作服务器最大值模式与容量、文件服务器/标签选择、上游上传方向、展开明细和无上报服务器。不完整汇总在折叠标题提示，390px 手机视口无横向溢出。此 UI 夹具绕过生产管理员鉴权；上游测试快照直接写入隔离数据库，真实流量头获取由上述 HTTPS 用例验证。
- 仅统计该功能启用后收到的协议用户原始增量，缺历史不补零；服务器方向重新计算当前展示，用户历史计费规则保持原采集值。尚无网卡日账本、重置周期/校准、趋势或跨服务归因。展示容量不是服务器限速或自动断流。
- 新迁移 `20260908080000_traffic_display` 与完整源码保存在 `traffic-source/`。临时测试容器、UI/API 和浏览器页已关闭；原 Nginx、Xray、mmw-agent 仍 active，PID 710164、824454、808506。冻结的 0.2.0/0.1.0 发行归档未覆盖。

## 订阅别名与展示额度回归（同日）

- 使用 `nodify-acceptance/build:0.2.0` 的依赖环境，挂载 `aliases-source/` 中最新后端、Agent、契约、Prisma 和测试；重新生成 Prisma 客户端并从迁移创建独立 SQLite。完整测试 **48/48，通过，无跳过**，日志 `linux-aliases-tests.log`，复现脚本 `aliases-vps.sh`。
- 新增两个独立用例覆盖别名加密、大小写与格式、冲突回滚、旧版本拒绝、主撤销不能靠编辑恢复、重置/更换/删除后的不可复用、展示覆盖不放宽真实配额、十进制大整数、HWID 共用和节点授权交集。原加密备份恢复用例增加别名关联解密和展示值一致检查。
- 原客户端规则回归改为通过别名解析独立文件，真实 Mihomo 1.19.30 和 sing-box 1.14.0 继续完成 DIRECT/PROXY/REJECT 与停掉代理后的行为验证。该测试调用生产订阅渲染器，不是客户端 GUI 从公网 HTTPS 短链导入验收。
- Windows 完整测试 45 项通过，另外 3 项在 VPS 实测。HeroUI 的本地独立 SQLite/控制器夹具覆盖随机生成、短别名校验、保存、私有页展示与真实链接、重置后旧入口拒绝、旧别名冲突保留、清空覆盖、断连保留及 390px 视口。夹具只绑定回环地址，绕过生产管理员鉴权，仅用于交互检查。
- 本轮新增 `20260908070000_subscription_aliases` 迁移。仅更换别名不会轮换原随机令牌，管理员须用“重置链接”撤销全部旧文件入口；既有已导入协议凭据仍由用户管理撤销。显示限额不会改变真实配额或服务器统计。
- 源码和文档保留在 `aliases-source/`。测试容器、临时 UI/API 已关闭；原 Nginx、Xray、mmw-agent 保持原进程。冻结的 0.2.0 和 0.1.0 发布归档未覆盖，本次是源码回归，后续发布需新版本构建及生命周期验收。

## 网站文件与多域名回归（同日）

- 在 `nodify-acceptance/build:0.2.0` 中挂载本轮 `website-files-source/` 的实际后端、Agent、契约和测试源码，完整测试 **46/46，通过，无跳过**。日志 `linux-website-files-tests.log`，复现脚本 `website-files-vps.sh`。这是新源码回归，不能据此宣称冻结安装包包含新功能。
- 真实 Nginx 覆盖静态文件更新后即时访问、CSS Content-Type、不同网站主域名/别名的 Host 路由、域名冲突拒绝；原 TLS、代理、WebSocket、失败恢复和删除重放继续通过。Host 断言使用 Node HTTP 客户端，避免 fetch 覆盖自定义 Host 导致测试访问默认站点。
- 文件测试覆盖真实字节读写、并发编辑冲突、同名不覆盖、重命名、非空目录拒绝、路径越界/链接拒绝、部署版本过期及分页。真实 Agent 子进程在第一次结果提交返回 503 后重报相同内容，收到确认后删除持久化日志中的内容。后端 SQLite 检查文件任务与发布互斥、内容加密及通用结果脱敏。
- 追加 Linux `umask 0077` 下的新目录 0755、新文件 0644，以及覆盖保留属主/权限的检查，文件专项 **4/4** 通过，日志 `website-files-permissions-vps.log`。这不代表外部特权进程并发替换路径或整机断电的所有情况已验收。
- Windows 完整测试 43 项通过、3 项在 VPS 实测；三应用构建及类型检查通过。HeroUI 使用独立 SQLite、实际控制器和本地文件执行器验证编辑与实际落盘、外部修改拒绝覆盖、手机目录导航/新建文件、多域名草稿和断连保留。390×844 视口无横向溢出；连接失败提示中文并聚焦。UI 夹具绕过生产管理员鉴权，仅用于交互检查，未替代生产认证或公网链路验收。
- 文件管理限单文件 1 MiB、每页 200 项及每目录 10,000 项；不提供大文件分块、目录重命名或递归删除。文件内容只由独立管理员结果接口返回，普通任务列表不携带内容。
- 本轮源码及文档保留在 `website-files-source/`；`release-0.2.0-final`、`release-0.2.0-verified` 及原 `0.1.0` 归档未覆盖。临时页面、前端/API 和测试容器已关闭，原 Nginx、Xray、mmw-agent 保留。

## 0.2.0 发布产物与生命周期（同日）

- 新源码目录 `source-0.2.0` 从 Windows 工作区完整导出，特殊字符文件名使用 UTF-8 保留。`deploy/Dockerfile` 构建主控、Agent、测试环境和裸机包，未复用旧应用编译产物。镜像为 `nodify-acceptance/{build,panel,agent}:0.2.0`，内置 Node `24.20.0`。Windows 构建及三应用类型检查通过。
- 新构建全套 **42/42，通过，无跳过**，日志 `linux-020-tests.log`，脚本 `fixtures/test-020.sh`。本轮加入应用版本不匹配的加密备份拒绝测试，确认原数据库字节保持不变。
- `acceptance-020/docker-lifecycle.log`：新数据库初始化、管理员注册、页面品牌、认证 Agent、套餐成员、六协议分别下载 262144 字节；配置校验失败保留已应用版本；AnyTLS 禁用、超额和真实时钟到期断流，重新启用、重置或续期后恢复；套餐快照隔离、鉴权 SSE、禁用 WSS 后 HTTPS 长轮询继续执行任务。
- Docker 加密备份恢复到新卷后，管理员登录、Agent 重连、证书解密下发、订阅与计量连续性通过；六协议再次下载成功。损坏备份拒绝覆盖，已有实例恢复先生成加密预备份。
- `acceptance-020/bare-lifecycle.log`：真实 `0.1.0 → 0.2.0 → 0.1.0` 主控与 Agent 升级、重启及回退，升级前后管理员登录；卸载保留数据后重装；新版主控全新部署；同版本不同清单拒绝且服务保持运行。脚本末尾新建同地址服务器返回 409，原目录由退出清理恢复；随后使用原服务器重签一次性令牌，`agent-fresh-final.log` 独立完成全新 Agent 的 `0.2.0` 版本握手、任务和重启。
- `acceptance-020/bare-restore.log`：systemd 恢复停写、预备份、恢复和启动检查通过。另构造校验有效但缺少启动依赖表的备份，启动失败后自动恢复预备份，原管理员继续登录。
- `acceptance-020/agent-upgrade.log`：Docker 内独立监督进程安装并认证本轮 `0.2.0` 裸机 Agent 包；错误 SHA256 拒绝，强制终止升级后重新启动会恢复上一安装并报告失败任务。真实不同应用版本升级见上述 systemd 记录。
- 安装器现在支持卸载后保留数据重装，以及已停止的同版本重装；同版本不同清单拒绝。构建版本写入成功构建记录，发布器拒绝使用其他版本的旧构建。备份应用版本来自统一版本常量，跨版本恢复拒绝覆盖。
- 运行时验收包保留在 `release-0.2.0-verified`。最终安装包位于 `release-0.2.0-final`，由已通过测试的构建环境使用标准发布器生成，仅更新包内部署说明；运行文件与已测包逐项比对，包内清单和压缩包 SHA256 重新验证。最终校验文件为仓库 [VPS-0.2.0-SHA256SUMS](VPS-0.2.0-SHA256SUMS)。原 `release-final-verified` 与 [VPS-SHA256SUMS](VPS-SHA256SUMS) 仍属于 `0.1.0`，保留不覆盖。
- `acceptance-020/final-package-verification.log` 确认最终包仅部署 README 与生命周期测试包不同，运行文件和内核完全相同。`cleanup.log` 确认临时容器、网络和 systemd 服务已关闭，原 Nodify 目录、数据和环境文件恢复；原 Nginx、Xray、mmw-agent 仍 active，PID 分别为 710164、824454、808506。旧 `0.1.0` 归档校验仍通过，所有测试数据与日志保留。
- 本轮没有完成公网 GUI 客户端、真实 DNS ACME、WebDAV/S3、其他发行版或 arm64 验收；不能用这次 Debian 12 / amd64 内核下载测试替代这些项目。

## 最新回归：持久化本地任务（同日）

- 全套 **42/42，通过，无跳过**，日志 `/opt/nodify-acceptance-20260908-01/linux-local-jobs-followup.log`；复现脚本 `fixtures/local-jobs-run.sh`。使用独立容器 `nodify-local-jobs-followup`，挂载当前后台、Agent、契约、测试及 Prisma 迁移。基于原构建环境执行回归，尚未更新冻结发布镜像与安装归档。
- 新增六项测试：真实子进程写完备份后遭 SIGKILL，恢复时复用相同字节；两个执行者的租约抢占及旧提交阻断；中断 ACME 不自动重发、管理员重试幂等、终止状态不被覆盖；定时任务持久化与未完成文件恢复；证书保存阶段恢复且不重复已有下发任务；临时文件清理保留活动任务和无关内容。
- 配置和网站下发写入也受本地任务租约保护，检查点与 Agent 任务在同一 SQLite 事务保存。证书恢复测试使用本地有效证书和真实持久化记录，没有访问真实 DNS 提供商，不构成 ACME 签发验收。定时备份使用 local 目标，WebDAV/S3 远端服务仍待验证。
- 原六协议受控下载、AnyTLS 计量及撤权、Nginx、HTTPS 来源、模板中转、订阅权益和加密恢复继续通过。Windows 完整测试 39 项通过、3 项在 VPS 实测；三应用构建和类型检查通过。
- HeroUI 任务页连接实际控制器及独立 SQLite，检查失败重试、真实执行状态转为成功、重试关联、断连时保留记录及错误聚焦。390×844 手机视口 scrollWidth 为 380，无横向溢出。
- 临时容器、前端/API 和浏览器页均已关闭。原 Nginx、Xray、mmw-agent active，PID 710164、824454、808506 保持不变。上一轮 SSH banner 超时已恢复，V3 最终 UI 与本轮源码、文档同步完成；冻结 `release-final-verified` 和 `VPS-SHA256SUMS` 未变。

## 最新回归：V3 模板（同日）

- 完整测试 **36/36，通过，无跳过**，日志 `/opt/nodify-acceptance-20260908-01/linux-v3-followup.log`，复现脚本 `fixtures/v3-run.sh`。隔离容器 `nodify-v3-followup` 复用已验证构建环境并挂载当前源代码，不能将此结果称为最新发布镜像的生命周期验收。
- 新增真实 Mihomo 1.19.30 测试直接读取 SQLite 用户的订阅输出，验证受管 VLESS 落地节点与 HTTP provider 落地节点分别通过独立 VLESS 入口连接。停止入口进程后两个中转组连接均失败，切换原节点仍成功；验证 SS 协议别名、协议排除、客户端不区分大小写正则、空协议筛选与空正则筛选返回 REJECT。用户到期后生成集合与节点均不再输出。
- 契约测试覆盖未知协议、缺失中转目标、组引用和 provider 中转引用形成的循环、独立缓存路径、输入未被修改、动态集合范围固定。六协议受控下载、AnyTLS 独立计量和撤权、SQLite 备份恢复、真实 Nginx 与 HTTPS 来源测试继续通过。
- Windows 本轮 **33 项通过、3 项跳过**；Mihomo 中转、Nginx、HTTPS 来源三项均已在 VPS 实测。三应用构建及类型检查通过。HeroUI 使用独立 SQLite 与实际控制器检查重命名、删除引用保护、循环报错保留、预览节点集合、保存回读及 390×844 手机视口无横向溢出。
- 测试结束后容器自动移除，34987 端口关闭；本地临时前端/API 与页面已关闭。原 Nginx、Xray、mmw-agent 仍 active，PID 710164、824454、808506 未变。
- 此轮没有验证全部中转协议/UDP 链路、两个受管计费服务之间的链路去重或公网 GUI 客户端。用于 36 项测试的后端、契约与测试源码已同步。收尾曾遇到 SSH banner exchange 超时；该连接及最后的 UI/文档同步已在后续本地任务回归中恢复完成。`release-final-verified` 与 `VPS-SHA256SUMS` 仍冻结在此前生命周期验收版本。

## 已通过

- 在 Linux 从源码构建前端、后端、原有 NestJS 节点和新 Agent；构建主控/Agent Docker 镜像及 amd64 裸机产物。
- 全新 SQLite 初始化、管理员注册、Nodify 页面与版本接口；服务器注册、认证心跳、凭据轮换、Docker Agent 重启。
- 发布 VLESS、VMess、Trojan、Shadowsocks、Hysteria2、AnyTLS，分配套餐并生成真实 sing-box 订阅。
- VPS 上的 sing-box 客户端逐协议下载 262,144 字节；面板记录六次传输共 1,574,652 字节（包含 HTTP 数据），上传 516、下载 1,574,136。客户端与服务端都是真实内核进程。
- 无效内核配置被拒绝，原版本仍能下载；AnyTLS 禁用、超额及真实时钟到期后无法连接，重新启用、恢复额度及续期后能重连。
- 套餐模板修改不改变已分配快照；显式同步生效，流量重置可重新使用。断开 Agent 与主控的全部通道后，Agent 仍执行缓存的到期撤权。
- 拒绝 WebSocket 的情况下，HTTPS 备用通道完成真实任务。SSE 需要管理员认证，并返回任务最终状态。
- Agent 管理的 Nginx 成功发布静态网站；手动证书加密入库并下发使用。
- 独立监督进程执行固定包升级；错误 SHA256 被拒绝；在持久化升级记录之后强制杀死容器，重启后恢复旧版本并报告失败。升级使用当前 `0.1.0` 的真实发布包，验证机制，不代表另一个正式版本已经发布。
- 下载加密备份并恢复至新 Docker 数据卷：管理员登录、Agent 重连、证书解密/下发、订阅及流量连续性均通过；恢复后六协议再次完成下载。
- 停止写入进程后覆盖恢复，会先生成加密备份；损坏密文被拒绝，恢复前后数据库 SHA256 保持一致。
- 主控和 Agent 的 systemd 安装、重启、升级及回退通过。升级使用仅修改发布版本号的 `0.1.1` 验收夹具，回退至 `0.1.0`；主控升级前创建数据库快照。裸机 Agent 的 80 端口发布被已有 Nginx 拒绝，原服务未被接管。
- systemd 离线恢复成功创建预备份、通过启动健康检查，并能使用恢复后的管理员登录。
- 对完整性校验通过、但缺少启动必需表的故障备份，systemd 恢复后的健康检查失败，自动恢复预备份，原管理员重新登录成功。
- 最终 Linux 完整测试集 13/13 通过，没有跳过真实内核测试；Windows 为 12 项通过、真实内核项另在 Linux 执行，类型检查通过。

## 实测中修复的问题

1. SQLite 可空 JSON 列造成 Prisma 读取失败：初始化迁移采用 TEXT 存储可空 JSON，并验证 SQL NULL 往返。
2. Agent 安装模块缺少 CQRS 导入，导致完整 Nest 应用无法启动。
3. 默认 HTML 标题仍是上游名称；新任务 SSE 请求缺少管理员客户端标识头。
4. 失败草稿的重试退避延迟了用户撤权：仅对相同配置和用户策略退避。
5. 恢复工具将其他容器留下的 PID 误认为当前主控：运行记录增加主机/容器标识。
6. 裸机包中的依赖链接指向构建目录：逐项复制为实体文件，规范发布文件权限，重新生成校验清单；安装器继续严格校验。
7. 裸机种子初始化先于自带 Valkey：调整启动顺序并限制初始化超时。
8. 健康检查固定端口且缺少生产反向代理头：读取配置端口，支持安装时设置 `NODIFY_APP_PORT`，并验证 Nodify 应用及版本。
9. 通过 `current` 符号链接调用恢复 CLI 时未执行恢复：比较解析后的真实文件路径，并增加符号链接调用的实际恢复测试。

## 验收边界

- 本机 Windows 直连 VPS 公网协议端口时，TLS 建连前被重置；同期 VPS 抓包未观察到该 TLS 连接。未把 VPS 内部成功下载表述为公网链路通过，尚需另一条外部网络复测。
- 实际客户端为 sing-box。Clash Verge/Mihomo、v2rayN/NG、Shadowrocket 的各自应用导入和连接仍待测试。
- 未覆盖 arm64、Debian 13、Ubuntu 22.04/24.04；未执行真实 DNS ACME 签发/续期及远端 WebDAV/S3 存储验收。
- 原有 Nginx、Xray、mmw-agent 保持运行，未接管它们。已有进程的 PID 分别为 710164、824454、808506。
- 3000 端口在验收期间被另一个服务占用，裸机主控改用 3300，未停止该服务。

完整方案的剩余实现边界见 [IMPLEMENTATION.md](../IMPLEMENTATION.md)。

## 产物与收尾

- 最终 amd64 包位于 VPS 的 `/opt/nodify-acceptance-20260908-01/release-final-verified/`；解压后逐文件校验和外层归档 SHA256 均通过。校验清单同时保存在本仓库 [VPS-SHA256SUMS](VPS-SHA256SUMS)。
- `nodify-panel`、`nodify-agent` 的 systemd 服务已卸载；四个测试 Docker 容器均已停止，测试协议端口已关闭。
- 保留测试源码、日志、备份、数据卷、最终镜像与发布包。systemd 卸载保留 `/etc/nodify`、`/var/lib/nodify-*` 和 `/opt/nodify-*` 中的测试数据与版本文件。临时解包目录和重复构建产物已清理。
- 收尾再次确认：原 Nginx、Xray、mmw-agent 均为 active，PID 与验收前一致。

## 后续路由编辑器回归（同日）

- 新增出站/路由/均衡引用校验、共享模板入站 ID 映射、DNS 结构保留测试。实际 Xray 分别校验随机、轮询、最低延迟、最低负载配置。
- Windows 与 VPS 完整测试均为 **18/18，通过，无跳过**；六类协议各下载 65,536 字节，AnyTLS 独立用户计量及撤权再次通过。
- VPS 使用已有构建镜像及只读源码挂载，在独立临时容器中运行；宿主机源码目录没有开发依赖，不能直接调用测试加载器。测试容器安装 curl 后运行实际客户端测试，无宿主机端口发布，执行完自动移除。
- 日志：`/opt/nodify-acceptance-20260908-01/linux-routing-followup.log`。此前主控/Agent 测试服务保持停止，未接管现有服务。
- 本轮前端通过本地生产构建、类型检查、浏览器桌面/手机交互检查；VPS 本次复跑的是后端、契约及真实内核测试。`release-final-verified` 中的包及 `VPS-SHA256SUMS` 仍对应上一次生命周期验收产物，**尚未包含本轮编辑器改动**。

## 入站编辑回归（同日）

- 追加 AnyTLS 嵌套路由引用保护、REALITY 密钥/shortId 校验；SQLite 测试覆盖编辑前后节点身份不变、Agent 确认前端口不变、确认后的名称/端口更新以及启停同步。
- 完整测试 **20/20，通过，无跳过**；六协议真实下载及原有恢复/计量/任务测试再次通过。
- 日志：`/opt/nodify-acceptance-20260908-01/linux-inbound-followup.log`。使用独立、自动移除的测试容器，不发布宿主机端口。
- 入站与出站的新前端源文件已同步到 VPS 测试源码目录；本地生产构建和手机交互检查通过，发布归档仍保留原验收版本。

## 网站管理回归（同日）

- 新增网站草稿及历史迁移、任务确认状态、删除重放保护和证书续期重发。SQLite 回归覆盖失败保留、草稿/已应用域名冲突、超时解锁、历史回退、删除确认和 Agent 丢失状态后的已应用版本重发。
- 完整测试 **22/22，通过，无跳过**，日志：`/opt/nodify-acceptance-20260908-01/linux-website-followup.log`。
- 追加真实 Nginx HTTPS 与中断恢复测试，专项 **2/2，通过，无跳过**，日志：`/opt/nodify-acceptance-20260908-01/linux-website-tls-followup.log`。覆盖静态、反向代理、131,072 字节请求体、WebSocket、按站点日志、TLS 证书校验、带路径/查询参数的 308 跳转、错误证书保留、启动失败回退、发布中断后的持久化版本恢复和删除后的旧任务重放拒绝。
- 验证修复：Nginx 非特权 worker 的临时目录访问权限；HTTPS 跳转使用配置域名；Agent 启动时以持久化网站记录重建 Nginx 配置，删除后的标记不会触发空 Nginx 启动。
- 测试在自动移除的隔离容器中安装 Nginx，不发布宿主机端口、不修改宿主机 Nginx。最终确认原 Nginx、Xray、mmw-agent 仍 active，PID 分别为 710164、824454、808506。
- Windows 三应用构建和类型检查通过；本地 21 项测试通过，Nginx 项在 Linux 实测。HeroUI 页面通过真实隔离 SQLite 的草稿/历史/排队/删除/错误及手机布局检查，没有模拟 Agent 成功；前端到 VPS 的公网完整流程仍未据此验收。
- 最新网站源码已同步至测试源码目录。原 `release-final-verified` 归档和 `VPS-SHA256SUMS` 保持冻结，尚未纳入网站及后续编辑器改动，不能作为当前源码的完整发布包。

## 自定义规则回归（同日）

- 新增规则集迁移和管理员接口、版本冲突保护、排序、预览及订阅输出集成。完整测试 **25/25，通过，无跳过**，日志：`/opt/nodify-acceptance-20260908-01/linux-rules-followup.log`。
- 在隔离容器中使用 sing-box 1.14.0 与 Mihomo 1.19.30，直接读取真实 SQLite 用户的订阅输出。两个客户端均通过 DIRECT、PROXY、REJECT 访问测试；停止真实 VLESS 服务端后，DIRECT 继续成功、PROXY 失败。GEOIP 使用真实网络资源下载并完成客户端加载，证书校验保持开启。
- Mihomo 来自官方固定版本 `v1.19.30` 的 `mihomo-linux-amd64-compatible-v1.19.30.gz`。SHA256 与官方发布元数据匹配：`db214c7a2517e63c150d123178d16d102e03a241ccdae4e5e07ffbe9cf56c6f9`；保存在测试 `engines/`，未安装或替换宿主机服务。
- 测试容器需要挂载本仓库 `tools/` 和 `deploy/`，并安装系统 CA、curl、Nginx。早期缺失挂载导致部署回归失败，缺少 CA 导致 GEOIP TLS 验证失败；补齐后全套通过，没有关闭 TLS 校验或跳过失败项。
- SQLite 验证自定义规则优先于模板、启停与删除改变输出、旧版本写入/删除拒绝、无节点及到期状态拒绝访问。加密备份恢复验证规则集内容保持一致。
- HeroUI 页面在本地独立 SQLite 上验证，覆盖错误提示、未追加输入保护、排序、编辑保留、并发冲突、确认删除和手机视口。浏览器验收不等于完整公网客户端 GUI 导入验收；Clash Verge、v2rayN/NG、Shadowrocket 仍待各自应用验证。
- 测试容器自动移除，未发布宿主机端口。最新源码已同步，原有 Nginx/Xray/mmw-agent 保持运行。冻结发布归档及校验清单仍对应原生命周期验收版本。

## 外部来源回归（同日）

- 完整测试 **28/28，通过，无跳过**。日志：`/opt/nodify-acceptance-20260908-01/linux-sources-followup.log`。六协议下载、独立 AnyTLS 计量与撤权、规则客户端、Nginx 和备份恢复同时回归通过。
- 来源使用隔离容器的真实 HTTPS 服务，临时发布 `185.99.135.224:34987`，只有生成的测试节点。专用测试 CA 仅由测试进程通过 `NODE_EXTRA_CA_CERTS` 信任；未关闭 TLS 验证，替换为不可信证书后请求被拒绝。另验证 15 秒截止、302 不跟随、超出 5 MiB 失败以及错误内容保留已有节点。
- SQLite 覆盖重复同步拒绝、旧版本编辑拒绝、过期任务不能覆盖新配置、上游重命名保留节点设置、标签授权、来源/节点禁用、手动和定时更新。加密恢复验证来源 URL 可解密且节点覆盖和标签保持一致。
- HeroUI 验收 API 只绑定 VPS 回环地址，通过 SSH 隧道连接本地前端，使用真实服务方法及独立 SQLite；此测试入口未绕过生产管理员接口的鉴权。检查成功/失败状态、重命名保留、禁用、分页筛选、编辑、删除和手机布局。该路径不代表公网客户端 GUI 导入或公网协议握手已通过。
- 测试容器与临时前端/隧道均已停止。确认原 Nginx、Xray、mmw-agent active，PID 仍为 710164、824454、808506。源码已同步到测试目录，冻结发布归档及 `VPS-SHA256SUMS` 尚未更新。

## 命名模板回归（同日）

- 最新命名模板、默认选择和共享展开逻辑进入实际订阅输出，全套 **30/30，通过，无跳过**，日志：`/opt/nodify-acceptance-20260908-01/linux-templates-followup.log`。
- 真实 Mihomo 1.19.30 加载 select / url-test / fallback / load-balance 组、动态包含与名称过滤配置，订阅中的两级代理组参与 DIRECT/PROXY/REJECT 访问回归。sing-box 1.14.0 同时加载独立模板内容；没有据此宣称所有自动组故障切换、V3 扩展或 GUI 客户端均通过。
- SQLite 覆盖旧版本写入/默认切换拒绝、禁止删除当前默认、切回原设置、模板更新影响订阅、到期拒绝和删除；备份恢复验证模板文档与默认选择保持一致。无效结构、循环代理组、缺失代理集合均被拒绝；缺失普通规则策略在生成时替换为 REJECT。
- 此轮浏览器交互使用 Windows 独立 SQLite 和真实控制器方法；检查导入/编辑/预览/默认选择、冲突保留、错误定位、手机布局和断连保留。临时入口不属于生产部署，也不代表公网客户端验收。三应用构建与类型检查通过；Windows 28 项通过，另两项在 VPS 执行。
- 测试仍采用独立自动移除容器，HTTPS 来源仅在测试期间发布专用端口；原服务继续保留。当前源码已同步到 VPS 测试目录，冻结的发布归档和校验清单尚未重建。

## 独立订阅文件回归（同日）

- 完整测试 **34/34，通过，无跳过**，日志：`/opt/nodify-acceptance-20260908-01/linux-files-followup.log`。测试容器新增本地 `subscription-files.ts` 契约挂载，并应用文件及规则关联迁移。
- Mihomo 1.19.30 与 sing-box 1.14.0 的真实分流测试改为使用独立文件令牌生成配置，验证文件绑定的模板进入客户端，DIRECT/PROXY/REJECT 和代理停止后的行为仍正确。原六协议下载、AnyTLS 计量/撤权、Agent 通道和 Nginx 测试继续通过。
- SQLite 验证文件不超出所属用户套餐中的受管/外部来源节点，外部标签须先由套餐授权；空选择、文件停用/到期、用户到期/超额不输出可用节点。主订阅撤销使旧文件令牌失效，编辑不能绕过；显式轮换重新关联当前主权益，旧文件令牌仍被拒绝。
- 多个文件共享同一用户 HWID 限额。规则和模板引用通过数据库约束保护；加密恢复后文件模板 ID、规则关联、私有令牌解密均保持正确。
- Windows 32 项通过，真实 Nginx 和 HTTPS 来源测试由 VPS 执行；三应用构建及类型检查通过。浏览器使用本地独立 SQLite 和实际控制器完成绑定、私有页、重置失效、停用、版本冲突、手机布局和断连保留检查，不能据此宣称公网 GUI 导入已通过。
- 临时测试入口与进程已关闭，源码同步到 VPS 测试目录。现有服务及冻结发布归档保持原状态；新增功能尚未打入原发布包。
