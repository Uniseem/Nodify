# Nodify 开发交接

交接日期：2026-09-09。仓库：[Uniseem/Nodify](https://github.com/Uniseem/Nodify)。工作区：`D:\panel`。

**当前是未冻结的 `0.3.0` 开发版本。主要管理流程已有实现和实测证据，但尚未完成妙妙屋 X 文档的全部功能，也未完成最新版本的全部发行验收。** 本文供下一位开发者接手，不是正式发布公告。

本文写入前，最近一次功能工作是 Tunnel 发布向导及完整应用路由修复。随后只调查了高级编辑器 WASM 缺失问题，尚未实现修复；没有 WASM 构建任务需要继续等待。

## 1. 目标与阅读顺序

目标是对照[妙妙屋 X 文档](https://miaomiaowux.com/docs/)完善服务器管理功能，并用 HeroUI 改善中文、移动端和深浅色交互。保留 Nodify 品牌，以及 NestJS、React、SQLite、Redis/Valkey 技术栈。

接手时按以下顺序阅读：

1. 本文：当前结论、缺口、接手顺序和环境约束。
2. [FEATURE-PARITY.md](FEATURE-PARITY.md)：逐领域功能对照及各轮实现细节。前面的最新记录优先于后面的历史快照。
3. [deploy/README.md](deploy/README.md)：实际构建、安装、运行、备份与恢复命令。
4. [deploy/VPS-ACCEPTANCE.md](deploy/VPS-ACCEPTANCE.md)：源码摘要、镜像、测试日志和证据边界。
5. [IMPLEMENTATION.md](IMPLEMENTATION.md)：最初五阶段方案的历史交付记录，其中较早的测试数和待办不是当前状态。

验收主线仍是：安装主控 → 接入服务器 → 配置协议和证书 → 发布节点 → 分配套餐 → 客户端订阅 → 统计用量 → 备份恢复。

## 2. 已实现并有验证的功能

“已实现”仅表示下面所述行为存在且有对应证据；不代表所在文档领域的全部选项均已完成。

| 领域 | 当前已实现 | 证据与限制 |
| --- | --- | --- |
| 构建基础 | 根目录统一 setup、contracts、typecheck、build、release；共享契约从本仓库编译；自建主控/Agent Docker；版本清单和 SHA256 | 最新三应用类型检查、Linux 构建通过；最新裸机包尚未冻结 |
| 部署工具 | 主控 API、任务处理、调度和 Valkey；Agent 独立监督进程；安装、升级、回退、重启、卸载保留数据、日志命令 | `0.1.0/0.2.0` 在 Debian 12 amd64 完成 Docker/systemd 生命周期；不能外推为最新 `0.3.0` 全生命周期已通过 |
| 服务器与认证 | 一次性注册令牌、认证登记、会话、凭据轮换/撤销；服务器指标；单台和批量操作 | 令牌、跨服务器隔离、任务重复/重放和实际握手已测 |
| Agent 通信 | WSS、HTTPS 长轮询、显式 HTTPS 直连；auto 按 WS → 已配置直连 → 拉取回退，并恢复优先 WS | 真实 TLS Agent 故障恢复；计量重报去重；PTY 跨通道保留环境 |
| 任务和终端 | 任务 ID、截止时间、状态、日志、鉴权 SSE；持久化本地任务、租约和中断恢复；交互 PTY | 真实 Bash、中文、Ctrl+C、尺寸调整、失联关闭、进程回收；终端输入和输出加密 |
| 配置与发布 | 每服务器草稿；显式共享模板；入站、出站、路由、DNS、日志、策略和 JSON 编辑；版本历史、校验、发布、确认和回退 | 未覆盖 JSON 字段保留；草稿不提前改变已应用配置；失败保留原版本 |
| 六类协议 | VLESS、VMess、Trojan、Shadowsocks、Hysteria2、AnyTLS；AnyTLS 独立 sing-box、独立凭据和统计 | 实际内核和受控下载；AnyTLS 独立计量、禁用、到期、超额断流；不代表所有 GUI 客户端/传输组合 |
| 高级网络配置 | WS/XHTTP Host、心跳、ALPN、XHTTP 模式、Vision/REALITY 参数；WireGuard 多 peer；路由和均衡；DNS/Hosts、连接策略和观测 | TLS WS/XHTTP、WireGuard 用户空间 TCP/UDP、UDP DNS、leastPing 故障切换已实测；完整矩阵仍有缺口 |
| 网站和转发 | TCP/UDP 目标转发；Nginx 静态、反向代理、WS、多域名、证书、日志；草稿/历史；文件浏览、文本编辑、上传下载、重命名、文件/空目录删除 | 真实 Nginx 发布和回退、路径约束、并发修改保护；单文件目前上限 1 MiB |
| 节点和订阅 | 节点生成、启停、名称/排序/标签、URI/二维码；Mihomo、sing-box、URI 输出；外部 URI/Mihomo 来源及更新失败保留 | 能力过滤、来源大小/超时/重定向限制；外部节点只做订阅分发，不统计真实用量或撤销外部凭据 |
| 模板和订阅文件 | 命名模板、代理组、独立规则集；文件授权子集、模板绑定/继承、短链、展示额度、服务器/来源统计选择；V3 筛选和部分中转转换 | 实际 Mihomo/sing-box 配置及部分中转连接；仍有格式、资源和完整中转矩阵缺口 |
| 用户与套餐 | 每用户一个有效套餐；权益快照；显式批量同步；创建、禁用、续期、换套餐、流量重置、订阅撤销和 HWID 管理 | 到期/超额停止受管订阅及协议访问；HWID 是订阅设备约束，不等于全部协议在线设备限制 |
| 流量与概览 | 协议/网卡分离；会话序号去重、落盘确认、离线补报；大整数字符串；方向、倍率；UTC 日账本、接口选择、周期/校准、首页容量和 30 日趋势 | 真实用户用量与跨通道重报已测；未知数据不充当零；跨服务链路归因尚未解决 |
| 证书 | 手动上传、Cloudflare/阿里云/DNSPod ACME 接口、续期、加密存储、引用服务下发 | 手动证书与服务使用已测；三家真实 DNS 签发/续期尚缺授权资源验收 |
| 备份与恢复 | 加密一致性 SQLite 快照及密钥材料；手动/定时/保留；WebDAV/S3；离线校验、预备份、停写恢复和失败回退 | MinIO S3、Nginx WebDAV 认证回读/解密/保留和进程中断已测；并非所有云服务商及容量场景 |
| Tunnel 发布 | HeroUI 向导、离线 CLI、面板/订阅独立域名、版本冲突保护、Docker/systemd 配置及固定版本下载校验 | 官方 cloudflared 配置校验和完整镜像匿名订阅通过；公网 Tunnel 没有接通验收 |
| 界面 | 中文主导航、概览、服务器、节点订阅、用户套餐、证书、备份和设置；HeroUI 表单、错误保留、任务状态、深浅色和移动布局 | 多轮真实接口/SQLite 浏览器操作；仍有兼容层、局部样式和旧高级页面缺口 |

## 3. 未完成：先修复的具体问题

### P0：高级配置编辑器的 WASM 未打包

已确认 `apps/frontend/dist/assets/wasm_exec.js` 和 `main.wasm` 不存在。页面仍引用它们，旧高级配置编辑器不能算可用。新 Nodify 配置页面可用，不构成旧页面已修复的证据。

接手位置：

- 源码和补丁：`tools/xray-monaco-editor/go/`，包括 `main.go`、`go.mod`、`xray-wasm.patch`、`scrape-docs.py`。
- `xray-version.txt` 为 `v26.7.28`，已查得对应 Xray commit 为 `5ca6f4b7d4dc20a881d4330e498892697627ec0c`，与现有协议内核构建一致。
- `Makefile` 目前使用浮动的 geodata release、Go master runtime 和文档 main；不能直接当作已固定版本的生产构建。
- `tools/build.mjs` 尚未接入这套构建，Docker/native 打包也没有这些产物。
- 加载入口：`apps/frontend/src/pages/dashboard/config-profiles/connectors/config-profile-by-uuid.page.connector.tsx`。失败和超时状态需补齐，不能一直显示加载或误报校验可用。
- 校验入口：`apps/frontend/src/features/dashboard/config-profiles/config-validation/config-validation.feature.tsx`。

建议完成顺序：固定依赖和资源摘要 → 从仓库 Go 源码构建 WASM → 使用同一 Go 工具链的 `wasm_exec.js` → 接入根构建和发行清单 → 实际浏览器加载、错误重试、合法/非法配置校验 → 完整镜像检查资源和编辑操作。

现有 Go 校验代码会替换证书文件并移除浏览器不能读取的外部 geodata 规则。必须明确这是浏览器侧有限校验，不能替代 Agent 对真实证书、文件、端口和内核配置的发布校验；原始配置也不能因此被改写或丢字段。最后一轮仅完成调查，没有提交一份假定已工作的 WASM 构建。

### P1：最新版本的发行和外部验收

| 未完成事项 | 所需工作/资源 | 完成标准 |
| --- | --- | --- |
| `0.3.0` 冻结发布 | 合并最新源码后重新生成主控/Agent Docker 和裸机包、清单、校验值；建立自有 HTTPS 下载渠道 | 同一版本产物对应同一源码；全新安装、重启、升级、回退和恢复通过 |
| 多平台 | Debian 13、Ubuntu 22.04/24.04、arm64 测试环境 | 逐平台真实服务生命周期和协议检查，不能仅凭交叉编译 |
| GUI 客户端 | Clash Verge、v2rayN/v2rayNG、Shadowrocket 等实际应用 | 导入、连接、更新、禁用/到期/超额行为；记录客户端版本及组合 |
| Cloudflare Tunnel | 实际面板/订阅域名、Tunnel UUID、VPS 凭据文件路径 | DNS、远端连接状态、匿名订阅更新、Agent 连接和域名隔离实测；仍需远程管理 Token 模式及生命周期 |
| DNS ACME | Cloudflare、阿里云、DNSPod 的实际授权域名和最小权限凭据 | 申请/通配符、续期、失败保留、引用服务重新下发 |
| 长时间与容量 | 大量节点/用户、长时间掉线、磁盘不足、备份并发等环境 | 无重复扣量/执行，资源上限合理，失败可恢复 |

凭据由接手者在部署环境配置，不应写入本仓库、交接文档或普通任务日志。当前未取得可用于公网 Tunnel/DNS 签发的资源。

## 4. 未完成：功能差异

| 领域 | 剩余内容 |
| --- | --- |
| 网站 | 大文件分块、目录重命名/递归管理、更多代理专用选项、完整公网访问验证 |
| 协议/出站 | Snell；WARP 注册、账户/许可、双栈管理；完整协议/传输/安全层/客户端版本能力表 |
| 路由/DNS/系统 | 更多可视化条件和规则资源；突发观测/leastLoad 实流量；DoH/DoQ 等完整 DNS 场景和全部策略行为 |
| 流量 | 精确日界分摊、任意账期/时区、节点/入站维度、保留策略、跨受管服务中转的归因去重、配额同步窗口评估 |
| 订阅 | 更多客户端格式和规则资源复用，完整中转/UDP/GUI 矩阵，全部模板交互 |
| 测速/限速 | 当前只有基础 TCP 延迟；吞吐测速和真实带宽限速未实现 |
| 共享/内嵌核心 | 跨面板服务器共享、联邦鉴权/任务代理、主控内嵌协议进程未实现；共享配置模板不能代替它们 |
| 外置探针 | 独立探针服务、公开接口契约及部署尚未实现；Agent 自带指标不能代替它 |
| 扩展集成 | MCP、Telegram 机器人、Turnstile 的完整 Nodify 接入及真实验收尚未完成；保留上游入口不等于接入完成 |
| 系统与前端 | 自定义 CSS 管理、全部系统选项、Nodify 教程/FAQ；深色 Select、旧品牌残留、兼容层和旧高级页面继续整理 |
| 用户模型 | 当前仅一个有效套餐，没有普通用户账户和支付；多套餐等会改变权益、订阅和计量模型，须按后续明确范围设计 |

最初计划排除了部分扩展功能，后续目标扩大为文档功能对齐。不要把早期排除项误记为已经完成，也不要把“一页表单”当作完整接入。旧数据库、旧 Agent 和旧订阅链接兼容从未作为本轮验收目标，禁止直接迁移正在使用的旧库。

## 5. 最新验证与产物

| 检查 | 最新已核对结果 | 证据 |
| --- | --- | --- |
| Windows 类型检查 | 三应用通过 | `.local-tmp/tunnel-routes-typecheck.log` |
| Windows 测试 | 99 项中 80 通过、19 跳过；设置了已有离线 CLI 路径，其他可选 Linux 资源未设置 | `.local-tmp/tunnel-routes-windows-full.log` |
| Linux 类型/构建/测试 | 三应用通过；99/99 通过，0 跳过 | VPS `linux-tunnel-routes-full.log` |
| 完整主控镜像 | 真正注册管理员、JWT/匿名私有页、主应用 JS、订阅信息、域名版本冲突、WS 连接/隔离、环境地址恢复通过 | VPS `linux-tunnel-production-routes.log` |
| cloudflared/离线 CLI | 官方二进制和镜像配置校验；两种输出；已有目录拒绝覆盖 | 同上及 `linux-tunnel-cli-overwrite.log` |
| 环境保护 | 测试容器/网络清理，端口释放；原服务、原数据及冻结包校验一致 | VPS `tunnel-cleanup-check.log` |

最新主控候选镜像：`nodify-acceptance/panel:0.3.0-tunnel-routes`，索引摘要 `sha256:7d9fe41c1d1336383e8876f5a3ac9073d862f6c0c9d58ebba25459840446b624`。

包含最新 Agent 自动回退的候选镜像：`nodify-acceptance/agent:0.3.0-auto`。这些标签目前在验收 VPS，**没有发布到公共镜像仓库**。历史裸机 `0.3.0-pty` 候选也不包含之后所有更新，不能用它替代最新源码发行。

最终功能增量归档：`fixtures/tunnel-delta-routes.tar.gz`，65 文件，SHA256 `535356842d1b2f877950c261ef658a156d0363544dacd86ff256eb2722ff1658`。它是叠加到已有源码快照的增量，不是可独立构建的完整仓库。接手以本次 Git 提交的完整源码为准。

99 个测试不等于全部功能验收。许多 UI 测试使用真实服务和隔离 SQLite，但绕过管理员守卫；管理员鉴权证据来自完整镜像。内核 CLI 的受控下载不等于所有目标 GUI 客户端、公网网络和发行版通过。

## 6. 环境与文件

VPS：`185.99.135.224`，Debian 12 / amd64。验收根目录：`/opt/nodify-acceptance-20260908-01`。本机已有 SSH 别名 `testvps`；它只是当前机器配置，不是仓库提供的通用登录方式。

| 位置 | 用途 |
| --- | --- |
| VPS `source-0.3.0-tunnel-routes/` | 最新主控候选的源码快照 |
| VPS `fixtures/` | 各轮增量、验收脚本、说明归档；有些脚本只能运行一次，接手须先阅读 |
| VPS `engines/`、`cert/`、`source-cert/` | 内核与隔离测试证书；不用于正式服务，不提交 Git |
| VPS `release-final-verified/`、`release-0.2.0-final/`、其他既有 release 目录 | 历史冻结/候选产物，保持原文件和 SHA256，不覆盖 |
| 本机 `.local-tmp/` | 临时脚本、UI 夹具和日志，已忽略，不随源码推送 |
| 本机 `releases/`、应用 `dist/`、`node_modules/` | 构建产物和依赖，已忽略，不随源码推送 |

最近一次清理记录中，原 Nginx/Xray/mmw-agent 的 PID 分别为 `710164/824454/808506`，均 active；原 Nodify current 指向 `0.1.0`，服务 inactive。接手重新检查实时状态，不把这些 PID 当作永久保证。不得为继续验收接管或重启上述原服务。

测试结束时没有本轮容器、测试网络或 13501/34987 监听遗留；本机 13489/13490 的 UI 夹具也已关闭。测试资料保留，独立 QA 目录可能含一次性测试密码和密钥，不能整目录上传 GitHub。

## 7. 代码入口和关键约束

| 路径 | 内容 |
| --- | --- |
| `packages/nodify-contract/` | 新功能的 Zod 契约、能力、配置编译和订阅转换 |
| `apps/backend/src/modules/nodify/` | 新 API、服务器/权益、配置、任务、证书/备份、订阅、流量和终端服务 |
| `apps/backend/prisma/schema.prisma` 与 `migrations/` | SQLite 模型和有序迁移 |
| `apps/node/agent/` | 主动 Agent、通道、协议进程、统计、网站文件、终端和监督进程 |
| `tools/pty/` | Linux PTY 辅助程序和子进程回收 |
| `apps/frontend/src/pages/dashboard/nodify/` | 主要 HeroUI 页面、编辑器和私有订阅页 |
| `apps/frontend/src/shared/heroui-compat/` | 原组件接口的兼容层；新页面优先直接使用 HeroUI |
| `tools/build.mjs`、`tools/release.mjs`、`deploy/` | 构建、包清单、Docker、裸机部署和离线恢复 |
| `tests/` | 集成、业务、真实协议及配置测试 |

不能破坏的约束：

- Agent 和管理员分开鉴权；Agent 只能读取/确认自身任务。长操作通过任务通道。
- “已保存”“已下发”“Agent 已确认”是不同状态。配置 JSON 未覆盖字段必须保留。
- 私钥、DNS 凭据、敏感任务/终端内容加密；普通列表、SSE 和日志不得回显。
- 流量字节按十进制字符串传输、BigInt 计算；批次落盘后确认；倍率只影响后续增量；用户额度只来自协议统计。
- 套餐模板与权益快照分离。HWID、外部节点和展示流量的能力边界必须在页面保持清楚。
- 恢复要停写、校验、预备份和失败回退，不能替换仍在使用的 SQLite 文件。
- 最新完整镜像已修复旧 SSH 网关误拒绝 Agent Upgrade，以及旧订阅模块占用 `/api/sub`。保留 `/api/legacy-sub` 路由分离，并保留 `tests/publication.test.mjs` 的模块共存回归。

## 8. 接手执行顺序

1. 核对 Git 分支、工作区、根版本和上述证据，按 P0 修复 WASM，先不改动已有 VPS 服务。
2. 安装依赖并运行检查：

   ```sh
   npm run setup
   npm run typecheck
   npm test
   npm run build
   ```

   Node 要求见根 `package.json`，当前为 `>=24.18.0`；实测 Node 24。Go 1.26 用于现有内核/PTY 构建。构建需要访问依赖和字体源，当前不是完全离线构建。普通测试中的可选用例可能跳过，必须检查最终统计。

3. 在独立 Linux 环境补真实用例，按测试文件设置 `NODIFY_TEST_XRAY`、`NODIFY_TEST_SINGBOX`、`NODIFY_TEST_MIHOMO`、`NODIFY_TEST_CERT_DIR`、`NODIFY_TEST_NGINX`、`NODIFY_TEST_PTY`、`NODIFY_TEST_CLOUDFLARED`、`NODIFY_TEST_TUNNEL_CLI` 等。完整历史环境参数见 VPS `fixtures/tunnel-routes-full-vps.sh` 和 `tunnel-routes-full-checks.sh`；阅读后使用新目录/日志执行，避免覆盖证据。测试证书、来源 HTTPS 和地理数据用例还需要对应专项参数。
4. 从完整源码构建实际主控/Agent 镜像，验证两个模块共存、匿名订阅、认证 Agent、真实下载计量和恢复。接口夹具通过后仍要跑完整应用，上一轮正是在完整镜像中发现路由冲突。
5. 按 P1 冻结统一版本产物并完成 Linux 生命周期，再补外部服务和 GUI 客户端。各轮同步更新功能对照和验收记录。
6. 最后逐项审核全部文档领域。缺少资源、只做过配置预览或只有局部测试的项目，均继续标注未完成，不把整体目标标记完成。

本次交接提交保存已有源码、测试、部署脚本和文档，不包含本机/远端数据库、凭据、依赖目录、临时日志或发行二进制。
