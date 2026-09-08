# Nodify 部署与操作

本目录针对全新 Nodify 实例。当前版本为 `0.3.0`；旧数据库、旧 Agent 和旧订阅链接不在兼容承诺范围内。安装、升级和卸载脚本不会自动清空已有数据。

## 构建

开发环境需要 Node.js 24.18 或更新的 24.x。推荐与镜像一致的 24.20。根目录命令：

```sh
npm run setup
npm run typecheck
npm test
npm run build
```

`setup` 使用各应用 lockfile 安装依赖，再编译本地契约；构建不会下载上游前端成品或上游节点镜像。前端产物位于 `apps/frontend/dist`，主控产物位于 `apps/backend/dist`，新 Agent 入口是 `apps/node/agent/supervisor.mjs`。保留的 NestJS 节点也会构建。

应用版本统一来自根目录 `package.json`。构建同步共享契约、Agent、恢复工具及两份 Compose 镜像标签的版本，并记录成功构建的版本；`npm run release` 拒绝打包版本不匹配的旧构建。加密备份只能用对应应用版本恢复。

基础镜像固定为 Node 24.20、Go 1.26；协议内核固定为 Xray 26.7.28 对应提交、sing-box 1.14.0，ACME 使用 lego 4.31.0。sing-box 编译包含 `with_v2ray_api,with_utls,with_quic`；没有统计编译标签的二进制不能代替它。

在 Linux 上生成包含 Node、协议内核及逐文件校验清单的裸机包：

```sh
docker buildx build --platform linux/amd64 -f deploy/Dockerfile \
  --target release-artifacts --output type=local,dest=releases-amd64 .
docker buildx build --platform linux/arm64 -f deploy/Dockerfile \
  --target release-artifacts --output type=local,dest=releases-arm64 .
```

多架构构建需要对应原生构建器或已配置的模拟器。每次输出主控包、Agent 包和 `SHA256SUMS`。也可在同架构 Linux 上完成根目录构建后，设置 `NODIFY_ENGINE_DIR`（包含 xray、sing-box、lego、valkey-server、nodify-pty）再执行 `npm run release`。PTY 辅助程序由 `tools/pty` 构建，固定 creack/pty 1.1.24，需 Go 1.26；Docker 构建已包含此步骤。不要把 Windows 的 node_modules 放入 Linux 发布包。

将同一架构的发布产物放到自有 HTTPS 固定版本目录。若同时托管两个架构，合并两份 `SHA256SUMS`，保留全部四个包的记录。`manifest.json` 写入应用版本、架构、内核版本和每个文件的 SHA256；安装器和 Agent 升级监督进程都会校验。

## Docker 主控

在仓库根目录准备 `.env`：

```sh
cp apps/backend/.env.sample .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

将生成值填入 `APP_SECRET`，设置 `NODIFY_PUBLIC_URL=https://你的主控域名`。若使用页面生成的裸机 Agent 安装命令，还需设置 `NODIFY_RELEASE_URL=https://你的文件域名/nodify/0.3.0`。

```sh
docker compose up -d --build
docker compose logs -f panel
```

Compose 启动本仓库主控和固定版本 Valkey 9.0.0，主控监督进程启动 API、任务处理和调度进程，首次启动执行迁移与种子数据初始化。API 只映射到宿主机 `127.0.0.1:3000`，需要通过已有 HTTPS 反向代理访问。反向代理须支持 `/api/agent/connect` 的 WebSocket Upgrade，并对 Agent 长轮询和任务 SSE 关闭缓冲、提供至少 60 秒读超时。

首次打开面板使用已有初始化注册流程创建管理员。后台入口是 `/dashboard/nodify/overview`。主控密钥与数据库保存在 `panel-data` 卷；卸载容器时保留该卷。

## Cloudflare Tunnel 发布

“系统设置 → Cloudflare Tunnel 发布向导”使用本地管理的 Tunnel：面板、订阅分开域名；生成配置、Docker Compose 覆盖文件或专属 systemd 单元、安装和 DNS 验证命令。Tunnel 固定为 cloudflared 2026.8.3，裸机下载校验 amd64/arm64 SHA256，关闭自动更新。依据 [Cloudflare 本地 Tunnel 教程](https://developers.cloudflare.com/tunnel/advanced/local-management/create-local-tunnel/)创建 Tunnel UUID 和 JSON 凭据；账户证书和 JSON 凭据不提交给 Nodify API，不放入仓库。

新实例尚无 HTTPS 入口时，先用构建产物离线生成文件。准备 `publication.json`（字段不含秘密）：

```json
{"panelUrl":"https://panel.example.com","subscriptionUrl":"https://sub.example.com","tunnelId":"替换为实际 Tunnel UUID","mode":"docker","port":3000}
```

源码构建后执行 `node apps/backend/dist/tunnel-config.js publication.json tunnel-bootstrap`。Docker 镜像可执行：

```sh
docker run --rm --network none --entrypoint node -v "$PWD:/work" \
  nodify/panel:0.3.0 dist/tunnel-config.js /work/publication.json /work/tunnel-bootstrap
```

裸机包对应 `/opt/nodify-panel/current/bin/node /opt/nodify-panel/current/app/dist/tunnel-config.js publication.json tunnel-bootstrap`，配置的 `mode` 改为 `native`。输出目录必须不存在，命令不会覆盖已有文件，也不会启动服务。工具与 HeroUI 使用同一份共享生成器。

将下载/生成的 `config.yml` 放入 `tunnel/config.yml`，实际 Tunnel JSON 凭据放入 `tunnel/credentials.json`。Docker 模式将 `tunnel` 目录、`compose.tunnel.yml` 和命令文件放到本仓库 `compose.yml` 同一目录；裸机可在输出目录执行。先核对安装命令，再用 `bash install-nodify-tunnel.sh` 安装/启动。JSON 格式的配置及 Compose 文件是合法 YAML。原生二进制路径 `/opt/nodify-tunnel/2026.8.3/cloudflared`，专属服务为 `nodify-tunnel.service`，不会改动已有的 `cloudflared.service`。首次安装前保留已有 Nodify Tunnel 配置；更新配置前另存 `/etc/nodify-tunnel` 和专属 unit，失败时恢复备份并重启。Docker 可保留上一份配置和镜像标签，恢复后重新创建 cloudflared 服务。

裸机回源仅监听回环：在 `/etc/nodify/panel.env` 设置 `NODIFY_LISTEN_HOST=127.0.0.1`，重启 `nodify-panel`。Docker 必须保持容器内 `0.0.0.0`，根 Compose 显式设置该值并只映射宿主回环端口。向导端口必须与实际 `APP_PORT` 一致。主控仍要求代理设置 `X-Forwarded-For` 和 `X-Forwarded-Proto: https`；裸 HTTP 或仅做 SSH 端口转发不能代替 HTTPS 反向代理。cloudflared 的 HTTPS 公网入口提供这些转发信息。

生成器将面板域名转发全部路径；订阅域名仅开放 Nodify 的 `/api/sub/:token`、`/subscription/:token`、`/assets/*` 和 favicon，其他域名/路径以 404 兜底。固定回源 Host，并在主控 HTTP、Agent WebSocket 与高级 SSH WebSocket 入口再次约束订阅域名；忽略 `X-Forwarded-Host` 的越权尝试，不以账号登录凭据绕过域名范围。静态资源本身是公开构建文件，不代表开放管理 API。

保留的旧订阅 API 使用 `/api/legacy-sub`，其响应规则仅作用于旧入口；新套餐权益订阅独占 `/api/sub`。旧高级配置编辑器的 WASM 资源仍未纳入统一构建，当前应使用 Nodify 服务器配置页面；相关缺口见功能对照和验收记录。

在执行过 `cloudflared tunnel login` 的环境运行生成的 DNS 命令。验证面板 `/auth/login` 为 200、订阅 `/` 与 `/auth/login` 为 404、订阅 `/api/sub/invalid?format=info` 到达 Nodify 返回 401；随后更新真实订阅并检查 Agent。`verify-nodify-tunnel.sh` 显示状态码供核对，不把命令执行成功视为全链路验收。Cloudflare Access、缓存规则或挑战页面可能影响客户端/Agent，须按实际场景配置。

验证后保存发布域名。新服务器安装命令立即使用面板域名，成员/文件/短链/私有页客户端链接使用订阅域名；原有 Agent 的面板地址仍需自行更新。设置通过版本号防止覆盖其他编辑，随加密 SQLite 备份恢复。Tunnel 的外部 JSON 凭据、Cloudflare DNS 资源不在 Nodify 备份中。页面始终区分“域名已保存”和“Tunnel 公网未验证”，目前不通过远端账户自动判断 Healthy。

停用：裸机 `sudo systemctl disable --now nodify-tunnel`；Docker `docker compose -f compose.yml -f compose.tunnel.yml stop cloudflared`。保留配置和凭据。先确保原 HTTPS 入口可用，再在向导中“恢复环境地址”；不要用 `docker compose down -v` 清理主控数据。

## systemd 主控

目标系统为 Debian 12/13、Ubuntu 22.04/24.04，amd64/arm64。Debian 12 / amd64 已进行 VPS 验收，其余系统与架构仍待验证，详见 [VPS 验收记录](VPS-ACCEPTANCE.md)。

下载自有发布包，核对 `SHA256SUMS` 后解压。以 root 执行包内脚本：

```sh
NODIFY_PUBLIC_URL=https://panel.example.com \
NODIFY_RELEASE_URL=https://files.example.com/nodify/0.3.0 \
bash deploy/install.sh panel
```

脚本安装到 `/opt/nodify-panel/releases/<版本>`，`current` 指向生效版本，`previous` 保留上一版本。配置位于 `/etc/nodify/panel.env`，SQLite 与密钥位于 `/var/lib/nodify-panel`。主控自有 Valkey 监听 `127.0.0.1:6380`，不修改宿主机已有 Redis/Valkey。

主控默认端口为 3000，可在首次安装时通过 `NODIFY_APP_PORT=3300` 指定其他空闲端口；健康检查读取 `/etc/nodify/panel.env` 中的 `APP_PORT`。数据库仍使用 `/var/lib/nodify-panel/nodify.db`，不要单独修改路径而遗漏快照与恢复命令。

```sh
bash /opt/nodify-panel/current/deploy/manage.sh panel logs
bash /opt/nodify-panel/current/deploy/manage.sh panel upgrade https://files.example.com/nodify/0.3.0
bash /opt/nodify-panel/current/deploy/manage.sh panel rollback
bash /opt/nodify-panel/current/deploy/manage.sh panel uninstall
```

升级前停止主控并创建一致性数据库快照，健康检查失败恢复上一版本。**主控版本回退同时恢复升级前快照，升级后的数据库写入不会保留。** 卸载仅移除 Nodify 服务，保留数据、凭据与发布文件。

卸载后可用同一份版本包重装，保留原数据和上一版本指针；运行中的同版本不会重复安装。同版本但清单不同的包会被拒绝，应为修改后的产物使用新版本号。上面的升级 URL 需替换为实际托管的目标版本。

## 服务器交互终端

在服务器详情中开启“交互终端”。在线 Agent 须带有 `nodify-pty/1` 辅助程序；旧版或 Windows Agent 会显示能力不可用。终端由 Agent 主动通道传输，不需要新增 SSH 或公网终端端口；管理员接口沿用登录鉴权，Agent 只能交换自身会话。

终端以 Agent 的系统身份运行 Bash，Docker 中位于 Agent 容器内。目录、环境变量和前台程序保留到会话结束。界面默认十分钟，API 最长三十分钟，每台服务器最多两会话，输出最多 1 MiB；输入与输出加密持久化，不显示在普通任务日志中。临时记录在过期一小时后、下一次开启会话时清理。

短暂断线会重试未确认的输入和输出；页面失联三十秒后关闭，持续无法联系主控时 Agent 也会按本地租约关闭。关闭或到期后须手动开启新会话，不自动重跑旧命令。关闭会话会终止属于该 Bash 会话的进程；有意创建新系统会话的守护进程不属于此范围。Docker 镜像使用 tini 回收孤儿进程，裸机依靠专属 systemd 服务与 PTY 辅助程序。

## 接入 Agent

在“服务器”创建记录，公网 IP/域名用于客户端连接。页面返回一次性令牌和本主控生成的安装命令；令牌 30 分钟有效，只能消费一次。执行命令后，以通过鉴权的心跳为接入成功依据。

### 连接模式与 HTTPS 直连

Agent 的 `NODIFY_CONNECTION_MODE` 可取 `auto`（默认，依次尝试 WebSocket、已显式配置的 HTTPS 直连、HTTPS 拉取）、`ws`（只用 WebSocket）、`pull`（只用 HTTPS 拉取）、`direct`（由主控主动访问 Agent）。页面显示最近已认证心跳实际使用的通道和 Agent 策略。auto 仅在提供 NODIFY_DIRECT_TOKEN 时启动直连监听；未提供时保留 WebSocket → 拉取。自动模式下 WebSocket 请求等待 10 秒、直连等待 5 秒，直连失败后暂停尝试 15 秒；WebSocket 重连使用 5–60 秒退避，恢复后优先使用。显式 ws、pull、direct 均不跨通道回退。首次注册仍需访问主控一次，随后使用已持久化的身份。

服务器详情的“Agent 连接”中配置 HTTPS 地址和独立直连凭据。先生成凭据、选择复制配置的 Agent 策略并复制，再保存主控连接；复制只生成环境配置，仍需在 Agent 应用并重启。凭据保存后不再回显，编辑留空会保留。地址不允许包含 URL 凭据、查询参数或片段，不能填 HTTP。保存只表示配置已持久化，状态在主控收到该服务器经过身份校验的消息后更新。关闭主控直连不会修改 Agent 本地配置；auto 在 WebSocket 不可用时会回退到拉取，并继续尝试恢复 WebSocket。若要关闭 Agent 直连监听，将模式改为 ws/pull，或移除 auto 配置中的 NODIFY_DIRECT_TOKEN，再重启。

裸机首次安装可一并传入以下变量；已有安装则编辑 `/etc/nodify/agent.env` 后重启 `nodify-agent`。Docker 将这些变量加入 Agent 服务，并挂载所需 TLS 文件，然后重建容器。

```sh
NODIFY_CONNECTION_MODE=direct
NODIFY_DIRECT_TOKEN=与主控连接表单相同的随机凭据
NODIFY_DIRECT_HOST=127.0.0.1
NODIFY_DIRECT_PORT=23889
```

默认只在回环地址提供 HTTP，供本机 HTTPS 反向代理转发；主控地址填写代理的 HTTPS 地址。路径为 `/api/nodify/exchange`，代理须保留 Authorization 请求头、允许 8 MiB 请求体、关闭缓冲并设置至少 30 秒读取超时。不需要 WebSocket Upgrade。若地址包含路径前缀，代理须将前缀后的该路径转发给 Agent。

也可由 Agent 自身提供 TLS，设置 `NODIFY_DIRECT_CERT`、`NODIFY_DIRECT_KEY` 两个证书文件绝对路径，并将 `NODIFY_DIRECT_HOST` 改为所需监听地址。非回环监听没有 TLS 会拒绝启动。Docker 使用自有证书挂载；裸机安装变量中的路径不能含空格。主控严格验证证书和名称、不跟随重定向；私有 CA 可通过主控进程的 `NODE_EXTRA_CA_CERTS` 配置。Agent 自身 TLS 文件替换后须重启 Agent，HTTPS 代理的证书续期由代理负责。

裸机首次安装中，auto 加 NODIFY_DIRECT_TOKEN 会校验并保存直连环境变量，要求与 direct 相同；已有安装的环境文件仍需自行编辑。

直连与其他通道复用远程任务、协议计量和终端处理。请求具有 ID，任务和流量仍按原日志/批次去重；数据库租约避免多个主控 API 进程同时调度同一连接。服务器凭据撤销会同时禁用主控直连，重新注册后须显式启用。接入凭据轮换通过原任务通道完成；独立直连凭据的更换需同时修改主控表单与 Agent 环境，更新期间界面会显示连接不可用。

裸机 Agent 的数据目录为 `/var/lib/nodify-agent`，systemd 服务为 `nodify-agent`。Agent 管理自身 Xray、sing-box 和 Nginx 子进程及配置；不会接管宿主机已有服务。机器已占用的监听端口会导致发布失败。首次安装缺少 Nginx 时安装发行版软件包，并停用这次新安装的默认 Nginx 服务。

Docker Agent 同样从本仓库构建，在仓库根目录运行：

```sh
NODIFY_PANEL=https://panel.example.com NODIFY_ENROLLMENT=页面给出的令牌 \
docker compose -f deploy/agent-compose.yml up -d --build
```

Agent 使用 host 网络和持久化数据卷，先尝试 WSS，失败后使用 HTTPS 长轮询。不要删除已注册 Agent 的数据卷后继续使用旧的一次性令牌；在面板重新签发安装令牌。凭据轮换通过两阶段确认完成，撤销后原有连接和令牌失效。

单台或批量升级在服务器维护入口提交固定版本、HTTPS 包 URL 和 SHA256。批量选择须使用同一架构；每台 Agent 独立校验架构。独立监督进程负责替换、认证健康检查和失败回退。Docker 内升级依赖持久卷保存下载后的版本；基础镜像及监督进程自身更新仍需重建容器。

原有高级 HTTP 节点入口保留，但新 Agent 默认不暴露 HTTP 管理监听端口；两套接入方式不共享凭据。

## 从配置到订阅

1. 在“证书”上传证书链与私钥，或发起 DNS ACME。Cloudflare 使用 `CF_DNS_API_TOKEN`（按需 `CF_ZONE_API_TOKEN`）；阿里云使用 `ALICLOUD_ACCESS_KEY`、`ALICLOUD_SECRET_KEY`；DNSPod 使用腾讯云的 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`。界面默认测试 CA，正式使用需关闭测试选项。
2. 在服务器详情创建入站。VLESS/VMess/Trojan/Shadowsocks/Hysteria2 由 Xray 承载，AnyTLS 由独立 sing-box 承载。TLS 必须引用未过期且域名匹配的证书；61001/61002 保留给本地统计接口。
3. 保存草稿，再发布。Agent 先校验内核配置与端口，再应用并检查进程；“已应用”只在成功确认后更新。历史版本可以重新发布。默认各服务器独立；共享模板需显式绑定，发布前显示受影响服务器。
4. 配置高级模式使用 `{inbounds, xray, singbox}`。未覆盖字段通过 `extra`、`xray`、`singbox` 保留；用户凭据、统计接口和入站标识由系统管理。请在顶层 `inbounds` 修改入站，嵌套的 `xray.inbounds`/`singbox.inbounds` 会被明确拒绝，避免绕过权益校验。
5. 发布成功自动生成客户端节点。在“节点与订阅”编辑名称、排序、标签/分组、启用状态，或为有权使用的用户生成分享 URI/二维码。
6. 创建套餐，明确选择节点或标签；不选择代表没有授权节点。创建成员并分配套餐，每人只有一个生效权益快照。修改模板不改变已分配用户；“同步”显式更新额度、设备限制、授权和倍率，重置周期改变时从同步时重新排期，不自动延长到期时间或清零流量。
7. 将成员私有订阅页交给本人。页面显示用量、到期、节点、二维码及各客户端订阅地址；无需普通用户账户。撤销会同时轮换订阅链接和协议凭据。

默认额度统计上传加下载，可选择单方向并叠加服务器和套餐倍率。倍率以 Agent 确认的配置策略为界，旧策略离线批次仍按旧倍率计算；重置前的批次不再计入新周期。主机网卡流量与用户协议流量独立记录。断网期间 Agent 按缓存到期和额度策略撤权；多服务器额度属于异步汇总，存在采样与同步延迟。

订阅设备限制使用 HWID；不携带 HWID 的客户端在启用限制时会被拒绝。这不是协议在线连接数量限制。外部订阅只分发节点，不能计量或撤销外部服务凭据。外部源限 HTTPS、5 MiB、15 秒且不跟随重定向，解析失败保留上次有效节点。

入站向导可设置 WebSocket/XHTTP Host、WebSocket 心跳秒数、TLS ALPN 和 XHTTP 模式。Host 使用 ASCII 域名或 IPv4，不包含端口；它与 SNI 分开，填写后服务端会校验请求。WS 的 ALPN 使用 `http/1.1`，gRPC 需要 `h2`，留空使用内核默认。可选字段清空后从配置删除，未知高级字段继续保留。Mihomo 的 XHTTP 模式输出在 `xhttp-opts.mode`；sing-box 不支持 XHTTP，Mihomo 1.19.30 不支持 VMess/Trojan + XHTTP，生成订阅会过滤并在私有页说明。发布后的参数只有 Agent 确认才进入受管节点订阅。

网站支持现有静态目录或 HTTP/HTTPS 反向代理，并支持 WebSocket 和证书引用。静态目录需先放到 Agent 可见的路径；Docker 中需自行挂载。TCP/UDP 端口转发配置指定目标主机和端口，不提供多跳编排。

## 备份与恢复

“备份”可手动创建、下载加密包，也可保存本地/WebDAV/S3 兼容存储的周期与保留数量。加密密码至少 12 字符。DNS 凭据、证书私钥和 ACME 账户资料加密入库；临时 ACME 目录在任务结束时清理。

WebDAV 目录和 S3 存储桶需预先创建，并授予读、写、删除权限。远程上传后会下载加密包并流式检查大小和 SHA-256，通过后才清理超过保留份数的备份。回读会产生下载流量；上传和回读共用 120 秒截止。校验失败保留本地文件，可在任务中重试。存储地址必须为不含账号、查询参数及片段的 HTTPS 地址；S3 使用路径式存储桶地址和 SigV4 签名。保存计划时需重新填写密码与凭据，普通查询不会返回这些秘密。切换存储目的地后，原目的地遗留的远端对象需自行管理。

备份包含一致性 SQLite 快照、库内配置/模板/证书、主密钥和应用密钥。采用 scrypt 与 AES-256-GCM；当前实现将快照装入内存，数据库上限为 128 MiB。Agent 网站目录内容、宿主机文件和发布二进制不在面板备份中，应另行备份。远程上传失败仍保留本地包并显示失败状态。

恢复只能离线执行，网页不会替换正在使用的数据库。systemd：

```sh
read -rsp 'Backup password: ' NODIFY_BACKUP_PASSWORD; echo
export NODIFY_BACKUP_PASSWORD
bash /opt/nodify-panel/current/deploy/manage.sh panel restore /安全路径/backup.nodify
unset NODIFY_BACKUP_PASSWORD
```

命令停止全部主控写入进程，检查点处理 SQLite，校验包版本、认证标签、SHA256 与数据库完整性，并创建当前状态的加密备份后恢复。文件替换失败会回滚；systemd 管理命令在恢复后执行启动健康检查，失败时恢复预备份。Docker 离线恢复后由操作员检查服务，必要时恢复预备份。只接受与当前应用版本一致的备份包，不做跨版本转换。

Docker 恢复需停止 `panel`，把备份目录挂载给临时同版本容器，保留原 `panel-data` 卷；先检查点，再运行恢复脚本：

```sh
docker compose stop panel
docker compose run --rm --no-deps --entrypoint node panel -e \
  'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync("/opt/app/data/nodify.db");d.exec("PRAGMA wal_checkpoint(TRUNCATE)");d.close()'
docker compose run --rm --no-deps --entrypoint node \
  -v /安全路径:/restore:ro -e NODIFY_OFFLINE_RESTORE=1 -e NODIFY_BACKUP_PASSWORD \
  panel deploy/restore.mjs /restore/backup.nodify /opt/app/data/nodify.db /opt/app/data/nodify
docker compose start panel
```

在 shell 预先设置密码环境变量。恢复后必须验证管理员登录、Agent 重连、证书使用、订阅生成和流量连续性；不要删除恢复前备份，直到这些检查完成。

恢复旧快照后，Agent 会重传本地尚未确认的流量。新策略的认证加密计费凭据随批次保留，主控可验证快照之后下发的策略，并按当时的方向、倍率和额度代次入账。恢复验证应同时确认服务器的“待补报”数量归零。没有有效凭据的未知策略批次继续留在 Agent，需保留其数据并核对原主控记录。

恢复以备份时间点的数据为基础。备份之后已经被主控确认、且 Agent 已移出待发送队列的数据，不会自动从 Agent 重建；需要更近的备份或保留的原主控数据。策略凭据用于恢复未确认批次的正确计费，不能替代更新的数据库备份。

## 验证

### 模板与文件的自定义规则

在系统设置的订阅模板中选择全部启用规则集、指定规则集或不附加。主订阅使用系统默认模板的选择；文件可以跟随其绑定模板，也可以单独选择范围。新建文件界面默认跟随模板，已有文件的明确范围保持不变。

规则按全局顺序附加在模板自带规则之前，停用规则不输出。选择“不附加”仅移除额外的规则集，不删除模板自带规则。规则集仍被模板或文件引用时，需要先调整对应选择才能删除。保存后的变化在客户端刷新订阅时生效，URI 节点列表不携带规则。

升级时正常执行仓库 SQLite 迁移，模板关联包含在加密数据库快照内。`tests/template-rule-bindings.test.mjs` 验证恢复后关联和订阅输出，`tests/subscription-rules.test.mjs` 使用实际内核验证文件独立规则及继承模板的连接行为。

### 执行检查

普通 `npm test` 运行临时 SQLite 和真实 HTTP/WebSocket 集成测试。真实内核连接测试需额外指定：

远程备份 HTTPS 用例会生成一次性测试证书，需要 OpenSSL；可通过 `NODIFY_TEST_OPENSSL` 指定可执行文件，Windows 默认也会查找 Git for Windows 自带的 OpenSSL。证书只加入该测试进程的信任列表，测试结束后恢复。WireGuard 专项使用指定的 Xray 在用户空间运行，测试 TCP、UDP 和受管用户统计，不需要系统 TUN 权限。

```sh
NODIFY_TEST_XRAY=/path/xray \
NODIFY_TEST_SINGBOX=/path/sing-box \
NODIFY_TEST_CERT_DIR=/path/test-certificates \
node --test tests/engines.test.mjs
```

证书目录包含测试域名 `node.example` 的 `fullchain.pem` 和 `privkey.pem`；测试使用本地端口 25440–25445、25540–25545、61001/61002。测试启动真实核心和客户端进程，通过 SOCKS 下载已知大小内容，最后关闭自身进程。

当前实测与剩余验收详见根目录 [IMPLEMENTATION.md](../IMPLEMENTATION.md)。
