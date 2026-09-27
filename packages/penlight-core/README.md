# @linjie/penlight-core

应援棒游戏的纯逻辑部分，不依赖 DOM，手机端和之后的服务器都可以直接用。

| 模块 | 内容 |
| --- | --- |
| `grid.ts` | 节拍网格（BPM + 第一拍），找最近的拍子，½ / ×2 / 平移 |
| `detector.ts` | 挥动检测状态机、灵敏度阈值、含重力数据的高通滤波 |
| `chart.ts` | 谱面：判定范围、预备拍、分段颜色；从一段音频生成谱面 |
| `judge.ts` | 校准、命中判定、回程挥动、打法识别、计分、近 8 下稳定度 |
| `fit.ts` | 把识别出的拍点拟合成等间距网格（周期最小二乘，相位圆周平均） |
| `presets.ts` | 内置测试曲的谱面 |

规则细节见 [`docs/penlight/brief.md`](../../docs/penlight/brief.md) 的「玩法与判定规则」，
每条规则在 `test/` 里都有对应的测试。

```bash
pnpm --filter @linjie/penlight-core test
```

包直接导出 TypeScript 源码（`exports` 指向 `src/index.ts`），由使用方的打包工具编译。
