# @linjie/penlight-core

应援棒游戏的纯逻辑部分，不依赖 DOM，手机端和之后的服务器都可以直接用。

| 模块 | 内容 |
| --- | --- |
| `grid.ts` | 节拍网格（BPM + 第一拍），找最近的拍子，½ / ×2 / 平移 |
| `detector.ts` | 挥动检测：主轴跟踪、波瓣切分、自适应门槛，输出带方向的转向点 |
| `chart.ts` | 谱面：判定范围、预备拍、分段颜色；从一段音频生成谱面 |
| `judge.ts` | 相位锁定判定、同步率 × 参与度计分、近 8 下稳定度、每小节打法 |
| `fit.ts` | 把识别出的拍点拟合成等间距网格（周期最小二乘，相位圆周平均） |
| `presets.ts` | 内置测试曲的谱面 |
| `recording.ts` | 录制数据格式和离线回放 |

规则见 [`docs/judging.md`](../docs/judging.md)。`test/players.ts` 里有一组模拟玩家（新手、会打的、乱挥的……），
测试会检查每类玩家的分数落在合理范围。

```bash
pnpm --filter @linjie/penlight-core test
pnpm --filter @linjie/penlight-core replay     # 回放 recordings/ 里的真机录制数据
```

包直接导出 TypeScript 源码（`exports` 指向 `src/index.ts`），由使用方的打包工具编译。
