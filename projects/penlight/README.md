# 应援棒互动游戏

全场观众把手机当应援棒，跟着会场音乐挥动，手机判定节奏稳不稳，大屏显示全场同步率，结束后出排行榜。

- 用于：2026 迎新晚会（中场互动，两个校区同时进行）
- 需求：[`docs/brief.md`](docs/brief.md)；检测和判定规则：[`docs/judging.md`](docs/judging.md)
- 状态：阶段 1 单机版已完成，正在收集真机录制数据调参；联机版（服务器、大屏、主持控制台）未开始

| 目录 | 包名 | 内容 |
| --- | --- | --- |
| [`web`](web) | `@linjie/penlight-web` | 手机端网页 |
| [`core`](core) | `@linjie/penlight-core` | 挥动检测、节拍网格、判定计分，手机端和之后的服务器共用 |

联机版计划加的目录：`screen`（大屏页）、`console`（主持控制台）、`server`（Node + WebSocket）。

```bash
pnpm penlight dev          # 本地开发
pnpm penlight dev:https    # 局域网 HTTPS，手机上测传感器
pnpm --filter "./projects/penlight/**" test
```

## 待办

- [ ] 收集真机录制数据：有快有慢（重点验证半拍档）、换动作（前后 / 左右 / 小幅手腕）、走路、故意乱挥、iPhone
- [ ] 用新数据回放调参，把每份数据写成回归测试（见 `core/recordings/`）
- [ ] 录制数据里记下设备型号：Android Chromium 通过 `navigator.userAgentData.getHighEntropyValues(['model'])` 获取，iPhone 只能记屏幕尺寸辅助判断
