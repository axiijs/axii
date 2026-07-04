# 04 致命问题测试复现报告（已归档）

本报告原本记录 8 个致命问题的复现方法与结果（复现测试断言的是【当时的错误行为】，测试通过 = bug 存在）。

**这 8 个问题现已全部修复**，`__tests__/fatalBugs.spec.tsx` 与 `__tests__/node/importInNode.spec.ts` 中的断言已经反转为【正确行为】，即转为回归测试。原复现记录已删除，防止误导后续工作；如需查看，请查阅本文件删除前的 git 历史。

修复索引与回归测试的运行方式见 [02-fatal-issues.md](./02-fatal-issues.md)。

## 回归确认

修复后的全量测试：

```
# 浏览器环境（npx vitest run）
Test Files  14 passed (14)
     Tests  124 passed (124)   # 113 个既有测试 + 11 个回归测试

# node 环境（npx vitest run --config vitest.node.config.ts）
Test Files  2 passed (2)
     Tests  4 passed (4)
```
