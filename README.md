# Nodify

Remnawave 全部公开组件的单体仓库。源码来自 [remnawave](https://github.com/remnawave)，按应用、SDK、工具和文档站点重新组织。

当前对齐的上游版本是 **3.4.3** 附近的各仓库最新提交。每个目录的原始仓库和 commit 见 [SOURCES.md](SOURCES.md)。

许可仍是 **AGPL-3.0**。上游版权归 Remnawave 及其贡献者。

## 目录

```
apps/                  可运行的主服务
  backend/             管理 API（NestJS + Prisma + Redis）
  frontend/            管理后台（React + Vite + Mantine）
  node/                节点端，驱动 Xray-core
  subscription-page/   独立订阅页

packages/              库和 SDK
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
```

## 本地上游备份

完整 git 历史仍保留在本机 `D:\remnawave-upstream\`，每个子仓库各自独立。这个仓库是它们的合订本。

## 文档

- 上游文档：https://docs.rw
- 组织：https://github.com/remnawave
