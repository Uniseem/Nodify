# Nodify

面向自用和小圈子共享的多服务器管理面板，使用 NestJS、React、HeroUI、SQLite 和 Redis/Valkey。源码基于 [Remnawave](https://github.com/remnawave) 各公开组件整理，并在本仓库实现 Nodify 主控、主动连接 Agent、套餐权益和私有订阅页。

**接手入口：[开发交接](HANDOFF.md)。新部署入口：[部署与操作说明](deploy/README.md)。功能与验收进度：[功能对照](FEATURE-PARITY.md)。** 当前源码是未冻结的 `0.3.0`；最新 Linux 构建及 99 项测试通过，但整体功能对齐尚未完成。历史 `0.2.0` 的 Docker/systemd 生命周期与最新候选的验证范围见 [VPS 验收记录](deploy/VPS-ACCEPTANCE.md)，不能混用。旧高级编辑器 WASM、最新发行生命周期、目标 GUI 客户端及其他 Linux 系统/架构仍有缺口。

在根目录运行 `npm run setup`、`npm run typecheck`、`npm test`、`npm run build`。主控前端、Agent 和共享契约均从本仓库构建。此次数据库变更以全新实例为目标，请勿直接对旧数据库运行新迁移。

当前对齐的上游版本是 **3.4.3** 附近的各仓库最新提交。每个目录的原始仓库和 commit 见 [SOURCES.md](SOURCES.md)。

许可仍是 **AGPL-3.0**。上游版权归 Remnawave 及其贡献者。

## 目录

```
apps/                  可运行的主服务
  backend/             管理 API（NestJS + Prisma/SQLite + Redis）
  frontend/            管理后台（React + Vite + HeroUI）
  node/                Nodify Agent（agent/）和保留的高级 HTTP 节点代码
  subscription-page/   独立订阅页

packages/              库和 SDK
  nodify-contract/      主控、Agent 和前端共享的数据校验与能力表
  xtls-sdk/
  xtls-sdk-nestjs/
  utils/
  rust-sdk/
  python-sdk/          已归档
  supervisord-nestjs/

tools/                 迁移、脚本、周边工具
  migrate/
  geocheck/
  scripts/
  xray-monaco-editor/
  caddy-with-auth/
  asn-index/

website/               原 remnawave/panel，文档站点
templates/             客户端订阅模板
deploy/                Docker、systemd、版本包与离线恢复工具
tests/                 SQLite、通信与真实协议连接测试
```

## 本地上游备份

完整 git 历史仍保留在本机 `D:\remnawave-upstream\`，每个子仓库各自独立。这个仓库是它们的合订本。

## 文档

- 上游文档：https://docs.rw
- 组织：https://github.com/remnawave
