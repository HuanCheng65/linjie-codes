# linjie-codes

临界各个活动用到的代码都放在这里：晚会互动游戏、报名页、抽奖、大屏展示、各种小工具……

## 怎么组织

```
projects/     每个项目一个目录，项目里按需要再分几个子目录
shared/       被多个项目共用的代码（视觉规范、工具函数等）
scripts/      仓库级别的脚本，比如汇总发布网页
```

**目录按项目划分。** 同一个东西常常会在好几次活动里用（比如应援棒游戏今年迎新用完，明年周年庆还能再用），
所以目录只跟着项目走。每个项目的 README 开头写清楚用在了哪些活动，下面的活动索引也会记一笔。

**一个项目一个目录，里面放什么由项目自己决定。**

- 简单的单页网页：项目目录下放一个 `web/` 就够了。
- 有多个部分的：像应援棒这样拆成 `web/`、`core/`，以后再加 `server/`、`screen/`。
- 不是网页的也可以放：Python 脚本、表格模板、OBS 场景配置都行，只要项目 README 写清楚怎么用。

**新建项目时：**

1. 在 `projects/` 下建目录，名字用简短的英文小写短横线，比如 `lucky-draw`、`signup-2027`。
2. 写 `README.md`：一句话说明、用于哪次活动、状态、怎么运行。需求文档放 `docs/`。
3. JS/TS 的子目录会被 pnpm workspace 自动识别（`projects/*/*`），包名用 `@linjie/<项目>-<部分>`，
   例如 `@linjie/penlight-web`。
4. 想发布到 GitHub Pages 的网页，在它的 `package.json` 里加：

   ```json
   "linjie": { "pages": "lucky-draw", "title": "抽奖" }
   ```

   推到 `main` 后会发布到 `<站点>/lucky-draw/`，站点首页会自动列出所有已发布的网页。
   网页请用相对路径构建（Vite 设 `base: './'`）。

## 项目

| 项目 | 说明 | 状态 |
| --- | --- | --- |
| [应援棒互动游戏](projects/penlight) | 手机当应援棒跟着音乐挥，判定节奏稳定度 | 单机版完成 |

## 活动索引

| 活动 | 用到的项目 |
| --- | --- |
| 2026 迎新晚会 | [应援棒互动游戏](projects/penlight) |

## 常用命令

需要 Node 22 以上和 pnpm 10（`corepack enable` 之后会自动用 `packageManager` 里写的版本）。

```bash
pnpm install
pnpm penlight dev     # 启动某个项目，快捷命令写在根目录 package.json 的 scripts 里
pnpm test             # 所有包的单元测试
pnpm typecheck        # 所有包的类型检查
pnpm build            # 构建所有包
pnpm site             # 构建之后，把要发布的网页汇总到 _site/，可以本地预览
```

只操作某一个包：`pnpm --filter @linjie/penlight-core test`；操作某个项目下的所有包：
`pnpm --filter "./projects/penlight/**" build`。

## 部署

推到 `main` 后，GitHub Actions 依次跑类型检查、测试、构建，再发布到 GitHub Pages。
第一次用需要在仓库 Settings › Pages 里把 Source 设成「GitHub Actions」。
