# 02 致命问题（已全部修复）

原文档在 commit `4249ef9`（v3.9.2）上记录了 8 个致命问题。**这 8 个问题已经全部修复**（每个问题一个独立 commit），原始的问题描述已从本文档删除，防止误导后续工作。

如需查看当时的问题详情，请查阅本文件删除前的 git 历史。

## 修复索引

| Bug | 修复内容 | 回归测试 |
| --- | --- | --- |
| 1 | `ComponentHost` / `StaticHost` 保存 `root.on('attach', ...)` 的退订函数（`deleteLayoutEffectCallback` / `removeAttachListener`），destroy 时正确退订 | `__tests__/fatalBugs.spec.tsx`（BUG 1a/1b） |
| 2 | `Root.destroy()` 先派发 `detach`、销毁 host，最后才清空监听器 | `__tests__/fatalBugs.spec.tsx`（BUG 2） |
| 3 | `Form.register` 的 multiple 分支重写，消除 ASI 分号陷阱 | `__tests__/fatalBugs.spec.tsx`（BUG 3） |
| 4 | `RxListHost` 的 reorder / explicit key change 锚点改到列表自身区域内，不再假设列表独占父元素 | `__tests__/fatalBugs.spec.tsx`（BUG 4a/4b） |
| 5 | `setAttribute` 遇到事件 key 冲突（`onChange` 别名成 `input` 后与 `onInput` 撞 key）时合并为数组；falsy 值表示解绑 | `__tests__/fatalBugs.spec.tsx`（BUG 5） |
| 6 | `data0` 加入 devDependencies、alias 支持兄弟目录回退（review 分支附带）；`package.json` 的 `main` 改为指向 `./dist/axii.umd.cjs` | `__tests__/node/packageJson.spec.ts` |
| 7 | `RxDOMSize.globalResizeObserver` 改为惰性初始化的静态 getter，import 框架入口不再执行浏览器 API | `__tests__/node/importInNode.spec.ts` |
| 8 | `StyleManager.update` 实现长度为 2 的滚动 buffer，过期且引用归零的 stylesheet 立即从 `document.adoptedStyleSheets` 移除 | `__tests__/fatalBugs.spec.tsx`（BUG 8） |

运行方式：

```bash
# 浏览器环境回归（BUG 1/2/3/4/5/8）
npx vitest run __tests__/fatalBugs.spec.tsx --coverage.enabled=false

# node 环境回归（BUG 6/7）
npx vitest run --config vitest.node.config.ts
```
