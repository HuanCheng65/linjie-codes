# linjie-codes

个人项目的 monorepo，用 pnpm workspace 管理。

## 目录结构

```
apps/        可以直接运行或部署的应用
packages/    被应用共用的库，不单独发布
docs/        各项目的需求文档和设计说明，按项目分子目录
```

命名约定：同一个项目的应用和库用相同前缀，比如应援棒游戏的手机端叫 `apps/penlight`，
逻辑库叫 `packages/penlight-core`。之后的大屏页、主持控制台、服务器可以按
`apps/penlight-screen`、`apps/penlight-console`、`apps/penlight-server` 往下加。
包名统一用 `@linjie/` 作用域。

## 项目

| 项目 | 路径 | 说明 |
| --- | --- | --- |
| 应援棒互动游戏 · 手机端 | [`apps/penlight`](apps/penlight) | 单机版：传感器自检、挥动判定、真歌节拍识别 |
| 应援棒互动游戏 · 逻辑库 | [`packages/penlight-core`](packages/penlight-core) | 挥动检测、节拍网格、判定计分，手机端和服务器共用 |

需求文档：[`docs/penlight/brief.md`](docs/penlight/brief.md)

## 常用命令

需要 Node 22 以上和 pnpm 10（`corepack enable` 后会按 `packageManager` 字段自动装对版本）。

```bash
pnpm install
pnpm dev          # 启动应援棒手机端
pnpm test         # 所有包的单元测试
pnpm typecheck    # 所有包的类型检查
pnpm build        # 构建所有应用
```

只操作某一个包时用 `pnpm --filter <包名> <命令>`，例如 `pnpm --filter @linjie/penlight-core test`。

## 部署

推到 `main` 后，GitHub Actions 会跑类型检查、测试和构建，然后把应援棒手机端发布到 GitHub Pages 的
`/penlight/` 路径下。第一次使用需要在仓库 Settings › Pages 里把 Source 设成「GitHub Actions」。
