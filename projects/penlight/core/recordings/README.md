# 录制数据

从手机端结果页「导出本局数据」得到的 JSON 放在这里，然后运行：

```bash
pnpm --filter @linjie/penlight-core replay            # 回放这个目录下的全部文件
pnpm --filter @linjie/penlight-core replay 某个文件.json --csv --sensitivity 4
```

文件名建议写上机型和情况，比如 `iphone13-快慢变化.json`、`redmi-走路.json`。
