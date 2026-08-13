# axii 官网站点设计文档

> 本文档为 `docs/official-website.md`。裁决记录在同目录 `docs/official-website-adjudication.md`，由裁决轮 append-only 维护。

## 一、头部固定小节

### 进度账本

round: 5/20

| ID | 状态 | 声明 | 证据引用 | 开启轮 | 关闭轮 | 复开计数 |
|---|---|---|---|---|---|---|
| W-01 | closed | 搭建 `site/` 子工程骨架：独立 `site/package.json`、`site/vite.config.ts`、`site/tsconfig.json`、`site/index.html`、`site/README.md`，dev/build/preview 三脚本可用。约束见 C-02、C-03、C-09、C-21、C-44。 | `cd site && npm install && npm run build`（D-01）退出码 0、产出 `site/dist/index.html` + JS/CSS；`cd site && npm run preview` + `node scripts/check-preview.mjs`（D-02）`#root children=1, no page errors` | 0 | 1 | 0 |
| W-02 | closed | 通过 vite alias 让 `site/` 开发期直接消费 `../src/index.ts`，禁止构建产物混入库 `dist/`，禁止改库 `package.json` 与 release-it 钩子；`site/package.json` 声明 `data0` 依赖。约束见 C-04、C-05、C-06、C-44、C-45、C-46。 | `git diff --name-only HEAD -- package.json .gitignore` 为空（D-04）；`find dist -path '*site*'` 为空（D-03）；`node scripts/check-data0-fallback.mjs`（D-21）npm 回退构建退出码 0、兄弟目录未改动；`site/package.json` 声明 `data0@^2.14.0` | 0 | 1 | 0 |
| W-03 | closed | 处理 tsconfig 边界：库 `tsconfig.json` 的 `include` 不覆盖 `site/`，`site/` 使用独立 tsconfig；库 `vite.prod.config.ts` 的 dts 与 lib entry 不触及 `site/`。约束见 C-07、C-08。 | `npx tsc --noEmit -p tsconfig.json`（D-05）无 `site/` 错误（库 `tsconfig.json` include 为 `["global.d.ts","src","__tests__","playground"]`，不含 `site`）；`npm run build`（D-06）退出码 0、产出 `dist/axii.js`/`dist/axii.d.ts` | 0 | 1 | 0 |
| W-04 | closed | 实现 Vercel 风格设计系统：design tokens（配色/字体/间距/圆角/阴影）、全局样式、`site/src/theme/tokens.css`。约束见 C-10、C-11、C-12、C-13。 | `cd site && npm run build`（D-01）；`grep` 产物 CSS 含 C-11 全部 6 配色 token + C-13 间距/圆角/阴影/宽度 token + `fonts.googleapis.com` 引入（D-07 通过） | 0 | 1 | 0 |
| W-05 | closed | 实现站点骨架组件（用 axii 渲染）：TopNav、Sidebar、Layout、Hero、FeatureCard、CodeBlock、Button、`<Example>`。约束见 C-14、C-15、C-16、C-17、C-24。 | `cd site && npm run build`（D-01）；`node scripts/check-structure.mjs`（D-08）TopNav/Sidebar/Hero 结构断言通过 | 0 | 1 | 0 |
| W-06 | closed | 实现 `<Example code render>` 展示组件：同一份源码经 Vite `?raw` 得字符串、经正常 import 得 `render` 函数，代码块与 live demo 一一对应不漂移；`<Example>` 在 `ref(null)` 分支调用 `render` 返回的销毁句柄销毁 inner `createRoot`。约束见 C-18、C-19、C-20、C-47。复开原因（轮 4 审计：`<Example>` 的 `ref` 回调仅处理 `el && !mounted()` 挂载分支，不处理 `ref(null)` 卸载分支；每个示例 `render(container)` 内部 `const root = createRoot(container)` 的 root 为局部变量、未返回未存储，故页面卸载时 inner root 永不 `destroy()`，泄漏响应式图与 DOM）。轮 5 修复：示例 `render` 签名由 `(container)=>void` 改为 `(container)=>() => void` 返回销毁句柄（C-18/C-47），`<Example>` ref 回调增 `el===null` 分支调用销毁句柄（`site/src/components/Example.tsx`），11 个示例源文件同步更新返回 `() => root.destroy()`。 | 轮 5 修复前复现（`site/scripts/check-cleanup.mjs` 临时禁用 detach 分支）：客户端导航 `/examples`→`/` 后 `document.body` 上 `[data-example-portal]`=1（应 0）、`body.children.length`=2（应 1），孤儿 modal 滞留；修复后 `node site/scripts/check-cleanup.mjs`（D-25）两场景全通过（scenario ① portal modal + body 清理、scenario ② 11 个 example root 全销毁）；mutation check 已执行（临时将 detach 分支改为 `void 0`，D-25 报 scenario ① orphan `[data-example-portal]`=1 失败，还原后通过）；`cd site && npm run build`（D-01）退出码 0；`node scripts/check-all.mjs`（D-20）9 项子检查全通过 | 0 | 5 | 1 |
| W-07 | closed | 实现自建轻量 history API 路由（router 未从 `src/` 导出，本期自建）。约束见 C-22、C-23。 | `cd site && npm run build`（D-01）；`node scripts/check-routes.mjs`（D-10）`/`、`/docs`、`/examples` 三条 history 路径均命中对应内容容器 | 0 | 1 | 0 |
| W-08 | closed | 实现首页（Hero + 特性卡片 + CTA）。约束见 C-14、C-25、C-26。 | `cd site && npm run build`（D-01）；`node scripts/check-structure.mjs --page home`（D-11）hero=true、h1=true、cta=2、features=6 | 0 | 1 | 0 |
| W-09 | closed | 实现文档区：以 axii 核心概念为骨架，每概念配文字说明 + 代码片段，内容以 `src/` 真实导出与中英文 README 为唯一事实源。约束见 C-27、C-28、C-29、C-30。复开原因（轮 1 审计：Portal 文档片段语义错误）已由 W-18 于轮 3 修复。 | `cd site && npm run build`（D-01）退出码 0；`node scripts/check-exports.mjs`（D-12）25 源文件导入符号均在导出集内、无裸未导出 API；`node scripts/check-doc-coverage.mjs`（D-23）14 类 C-27 概念全部覆盖；Portal 片段已改为 `content={() => <ModalContent />}`，与 `src/Portal.tsx:16` 语义一致（W-18 证据） | 0 | 3 | 1 |
| W-10 | closed | 实现示例区：覆盖 atom 双向绑定、RxList、RxMap/RxSet、computed、Component AOP、Portal、Form、RxDOMRect/RxDOMSize/RxDOMScrollPosition，每个示例同时展示代码与 live demo。约束见 C-31、C-32、C-33。 | `cd site && npm run build`（D-01）；`node scripts/check-examples.mjs`（D-09）11 示例代码块+live 根非空；`node scripts/check-examples-coverage.mjs`（D-24）11 类必需示例全部存在且 live 根非空；`node scripts/mutation-check.mjs`（D-13）22 mutation 全部产生可观测失败 | 0 | 1 | 0 |
| W-11 | closed | 文档对未从 `src/` 导出的 router/Action/state-machine/headless 逐项标注「外部包/暂不纳入」，不编造 API。约束见 C-34、C-35。 | `cd site && npm run build`（D-01）；`node scripts/check-exports.mjs`（D-14）无 `createRouter()`/`createAction()`/`createStateMachine()` 裸调用；`site/src/docs/docSections.ts` 的 `externalPackages` 列出 `router0`/`action0`/`statemachine0`/`@axiijs/ui` 四项并附 npm/GitHub 链接 | 0 | 1 | 0 |
| W-12 | closed | 示例不示范反模式：组件函数只执行一次、事件只绑定一次、更新走 attr 级精确写入；事件非响应式语义在示例与文档中正确体现。约束见 C-36、C-37。 | `cd site && npm run build`（D-01）；`node scripts/check-antipatterns.mjs`（D-15）25 文件无可机检反模式（动态 handler 替换、响应式 handler 表达式） | 0 | 1 | 0 |
| W-13 | closed | 站点不引入 React/Vue/Solid；代码高亮用轻量外部库（Shiki）。约束见 C-16、C-38。 | `site/package.json` dependencies/devDependencies 不含 react/vue/solid-js/svelte；Shiki 为构建期 tokenize（`vite-shiki-plugin.ts` `?shiki` 后缀），客户端 bundle 不含 `createHighlighterCoreSync`/`createJavaScriptRegexEngine`/`shiki/langs`/`shiki/themes`（D-16 通过） | 0 | 1 | 0 |
| W-14 | closed | 编写 `site/README.md`：dev/build/preview、目录结构、新增文档页与示例的流程、与库 `src/` 的依赖关系。约束见 C-39。 | `site/README.md` 含「dev/build/preview」「目录结构」「新增文档页」「新增示例」「与库 src 依赖关系」五个小节（D-17 通过） | 0 | 1 | 0 |
| W-15 | closed | 站点产物与 `playground/`（已忽略）隔离；不改 `.gitignore` 取消对 `playground/` 的忽略；站点不放进 `playground/`。约束见 C-40、C-41。 | `git diff --name-only HEAD -- .gitignore` 为空（D-04）；`site/` 在仓库根、不在 `playground/` 内；`.gitignore` 仍含 `playground` 行（D-18 通过） | 0 | 1 | 0 |
| W-16 | closed | 收尾门禁：库本身 `npx vitest run` 与 `npm run build` 仍通过；站点 `npm install && npm run build` 与 `npm run preview` 可复跑。约束见 C-01、C-42。 | 库 `npx vitest run`（D-19）：667 passed / 5 failed（5 失败为 pre-existing，移除 `site/` 后同样失败，系兄弟 data0 版本差异致 `data0Contract`/`data0RecoveryRerun`/`errorHandling`/`rxListHost` 中 5 例，非 `site/` 引入）；库 `npm run build`（D-06）退出码 0；站点 D-01/D-02 通过 | 0 | 1 | 0 |
| W-17 | closed | 产出 `site/scripts/` 下可复跑机检脚本（示例页结构断言、导出集对照、未导出项标注、反模式扫描、mutation check 框架、preview headless 校验、data0 回退分支校验、production `__DEV__` 校验、文档概念覆盖、示例覆盖范围、示例 live root 卸载时序校验），作为 D-02/D-09/D-13/D-14/D-15/D-21/D-22/D-23/D-24/D-25 的 (b) 载体。约束见 C-42。动因：R1-F04（机检断言载体未登记）、R3-F01（data0 回退分支门禁载体）、R3-F02（production `__DEV__` 门禁载体）、R4-F01（文档概念覆盖门禁载体）、R4-F02（示例覆盖范围门禁载体）、W-19（示例卸载时序门禁载体，轮 5）。 | `cd site && npm run build && node scripts/check-all.mjs`（D-20）退出码 0，9 项子检查全通过；`node scripts/check-dev-flag.mjs`（D-22）production bundle 无 `__DEV__` 泄漏；`node scripts/check-data0-fallback.mjs`（D-21）npm 回退构建通过、兄弟目录未改；`node scripts/mutation-check.mjs`（D-13）22 mutation 全失败；`node scripts/check-cleanup.mjs`（D-25）两场景全通过 | 0 | 1 | 0 |
| W-18 | closed | 修复 Portal 文档片段 `site/src/docs/snippets/portal.ts` 的语义错误：片段用 `<Portal container={...}>{children}</Portal>` 传入 children，但 `Portal`（`src/Portal.tsx:16`）解构 `{ container, content, destroyOnUnmount }` 不读 children，致 `content=undefined`，运行期 `renderedStaticContent.has(undefined)` 抛 `TypeError: Invalid value used in weak set`（已在 `__tests__` 浏览器环境实验复现）。应改为 `content={() => <ModalContent />}` 或 `content={<Child />}` 形态，与 `site/src/examples/PortalExample.tsx` 的正确用法一致。约束见 C-29（文档代码片段必须与 `src/` 实际导出与语义一致）。动因：审计轮 1 对抗审查发现（W-09 复开）。 | 修复前复现：临时用例 `__tests__/_portalBrokenOnly.spec.tsx`（已清理）`root.render(<Modal>hi</Modal>)` 捕获 `caught.message === "Invalid value used in weak set"`（记录见 `prompt/output/w18-portal-snippet-repro.md`）；修复后 `site/src/docs/snippets/portal.ts` 改为 `<Portal container={document.body} content={() => <ModalContent />} />`；同类缺陷全库扫描仅此一处（`site/src/examples/PortalExample.tsx` 已用 content 形态）；`cd site && npm run build`（D-01）退出码 0；`node scripts/check-exports.mjs`（D-12）25 源文件导入符号均在导出集内；`node scripts/check-all.mjs`（D-20）8 项子检查全通过；bundle 内 `?raw` 字符串含 `content={() => <ModalContent />}`、不含 `{children}` 误用形态 | 2 | 3 | 0 |
| W-19 | closed | 修复 W-06 复开缺陷：示例 `render(container)` 签名由 `(container)=>void` 改为 `(container)=>() => void` 返回销毁句柄（C-18、C-47），`<Example>` ref 回调增 `el===null` 分支调用销毁句柄销毁 inner `createRoot`，11 个示例源文件同步更新。新增触发式门禁 D-25（`check-cleanup.mjs`）校验示例卸载时序。动因：审计轮 4 对抗审查发现 W-06 复开（`<Example>` ref 回调无 `null` 分支、inner root 永不 `destroy()`、Portal modal 孤儿滞留）。约束见 C-18、C-20、C-47。 | 修复前复现：headless 导航 `/examples`→打开 Portal modal→关闭→客户端导航至 `/`，`document.body` 上 `[data-example-portal]`=1（应 0）、`body.children.length`=2（应 1）；修复后 `node site/scripts/check-cleanup.mjs`（D-25）两场景全通过；mutation check 已执行（detach 分支临时改为 `void 0`，D-25 报 scenario ① orphan `[data-example-portal]`=1 失败，还原后通过）；`cd site && npm run build`（D-01）退出码 0；`node scripts/check-all.mjs`（D-20）9 项子检查全通过；`node scripts/mutation-check.mjs`（D-13）22 mutation 全失败；`node scripts/check-antipatterns.mjs`（D-15）25 文件无反模式 | 5 | 5 | 0 |

### 完成纪律

| ID | (a) 适用声明/变更类型 | (b) 可复跑门禁命令或可机检产物 | (c) 无效证据界定 | (d) 执行策略 |
|---|---|---|---|---|
| D-01 | 站点可构建（C-02、C-03、C-09、C-44、C-46） | `cd site && npm install && npm run build`，退出码 0 且产出 `site/dist/` | 仅 `tsc --noEmit` 通过而 `vite build` 未跑；产物缺失 `index.html`；`site/vite.config.ts` 未 `define.__DEV__` 致 `src/` 运行时 `ReferenceError`（构建期不暴露，运行期崩溃）；在 sibling-present（`../data0/src/index.ts` 存在）环境下跑 D-01 通过但 `site/package.json` 未声明 `data0`（无 sibling 环境会构建失败，由 D-21 独立验证）；production 构建中 `__DEV__` 取 `true`（dev 诊断路径与 `debugger` 语句进入生产 bundle，不崩溃、不触发 D-01 退出码非零，由 D-22 独立判定） | 每轮必跑 |
| D-02 | 站点可预览（C-09、C-44） | `cd site && npm run build && node site/scripts/check-preview.mjs`，脚本启动 `npm run preview`、用 headless 导航 `http://localhost:4173/` 执行 JS 后断言 `document.querySelector('#root').children.length > 0`（根容器内有真实渲染内容），退出码 0 并清理 preview 进程 | preview 进程未起或返回非 200；仅 `curl` 取静态 HTML 含空 `<div id="root">` 而未执行 JS（axii 为纯客户端渲染，首屏 HTML 根容器为空，`curl`-only 无法捕获运行时崩溃/白屏）；未清理 preview 进程 | 按关联声明触发 |
| D-03 | 站点产物不混入库 `dist/`（C-05） | 库 `npm run build` 后 `dist/` 内无 `site/` 路径产物（`find dist -path '*site*'` 为空） | 仅检查 `site/dist` 存在而未检查库 `dist` 隔离 | 每轮必跑 |
| D-04 | 不改库 `package.json`/release-it/`.gitignore`（C-06、C-41） | `git diff --name-only HEAD -- package.json .gitignore` 为空（或仅非构建相关字段） | 改了库 `package.json` 的 scripts/release-it 钩子 | 每轮必跑 |
| D-05 | 库 `tsconfig.json` 不覆盖 `site/`（C-07） | `npx tsc --noEmit -p tsconfig.json` 不报 `site/` 下文件错误（`site/` 不在 include 列表内） | `site/` 文件被库 tsconfig 编译进错误集 | 按关联声明触发 |
| D-06 | 库构建不受站点影响（C-01、C-08） | 库根 `npm run build` 退出码 0，产出 `dist/axii.js`/`dist/axii.d.ts` | 仅 `tsc` 通过而 `vite build`/`node scripts/type.js` 未完整跑 | 每轮必跑 |
| D-07 | 设计 token 落地（C-10～C-13、C-13a） | `site/dist/` 内 CSS 产物 `grep` 含 C-11 全部 6 个配色 token（`--axii-bg`、`--axii-fg`、`--axii-fg-muted`、`--axii-border`、`--axii-accent`、`--axii-code-bg`）、C-13 间距/圆角/阴影 token（`--axii-radius`、`--axii-space`、`--axii-shadow`）与宽度 token（`--axii-content-width`、`--axii-doc-width`），且含 `geist`/`Geist` 字体引用与 `fonts.googleapis.com` Google Fonts 引入（`@import` 或 `<link>` 形态） | token 名缺失；字体名未引用；仅有 `font-family: Geist` 而无 `fonts.googleapis.com` 引入（字体实际不加载、回退系统字体） | 每轮必跑 |
| D-08 | 骨架组件产出真实 DOM（C-14、C-15、C-17） | `cd site && npm run build && node site/scripts/check-structure.mjs --pages home,docs,examples`，脚本用 headless（Playwright）导航 preview 产物后断言 DOM 含 TopNav/Sidebar/Hero 等结构 | 仅源码含组件而运行时未挂载；仅静态读取入口 JS 字符串而不执行 | 按关联声明触发 |
| D-09 | 示例「代码 + 效果」共存（C-18、C-19、C-31、C-42） | `cd site && npm run build && node site/scripts/check-examples.mjs`，脚本对每个示例页用 headless 导航后断言同时存在代码块容器（`pre.axii-code`）与 live 渲染根（`[data-example-root]`），且 live 渲染根 `[data-example-root]` 内 `children.length > 0`（真实渲染了子树，非空容器） | 仅有代码块无 live 根，或仅有 live 根无代码块；live 渲染根存在但 `children.length === 0`（`render` 未挂载子树，空容器冒充通过）；仅 grep 产物 HTML 字符串而不执行 JS | 每轮必跑 |
| D-10 | 路由可工作（C-22、C-23） | `cd site && npm run build && node site/scripts/check-routes.mjs`，脚本用 headless 导航 `/`、`/docs`、`/examples`（history 路由），断言每条路径命中对应内容容器 | 仅静态切换无路由状态；用 `curl` 检测 history 路由内容（curl 拿不到客户端渲染结果） | 按关联声明触发 |
| D-11 | 首页结构（C-14、C-25、C-26） | `cd site && npm run build && node site/scripts/check-structure.mjs --page home`，断言含 hero 区（H1 + 副标题 + CTA）、至少 3 张特性卡片、CTA 按钮 | 缺失 hero 或特性卡片 | 每轮必跑 |
| D-12 | 文档代码片段与 `src/` 导出一致（C-28、C-29） | `cd site && node site/scripts/check-exports.mjs`，扫描文档与示例中所有 `import { ... } from 'axii'` 具名符号及正文裸调用形态 `Identifier(`，与 `src/index.ts` 导出集对照 | 符号不在导出集内且未标注「外部包」；仅检查 import 语句而不覆盖正文裸用 | 每轮必跑 |
| D-13 | 示例可运行性 mutation check（C-32、AGENTS.md 缺陷修复纪律） | `cd site && node site/scripts/mutation-check.mjs`，脚本对每个示例源码自动注入一处缺陷并断言其触发一条**明确可观测失败**（记录注入点、失败类型与现象），还原后通过：①「删除/破坏 `render` 内挂载」类 mutation——断言 live 渲染根 `[data-example-root]` 内 `children.length === 0`（与 D-09 的非空断言相反，即 mutation 后 live 根变空触发失败）；②「改错 API 名」（如 `atom` → `atomX`）类 mutation——断言触发构建期错误或运行期 `TypeError`。脚本输出每例注入点与失败现象记录 | 仅声明「能跑」无 mutation 记录；mutation 注入后未触发任何可观测失败（构建错误或 live demo 断言失败）；或仅触发与示例运行行为无关的失败；「删除 render 调用」类 mutation 后仅凭 live 根存在性（D-09 容器层）通过而未校验根内子节点非空 | 按关联声明触发 |
| D-14 | 未导出项标注一致（C-34、C-35） | `cd site && node site/scripts/check-exports.mjs --unexported`，扫描文档中 router/Action/state-machine/headless 等未导出符号字样是否带「外部包（包名）/暂不纳入」标注 | 出现裸 API 形态（如 `createRouter(...)`）未标注 | 每轮必跑 |
| D-15 | 示例无反模式（C-36、C-37） | `cd site && node site/scripts/check-antipatterns.mjs`，全量扫描示例源码：无在事件 handler 外动态替换 `on*`、无依赖重渲染心智的写法；并校验文档对事件非响应式语义的描述存在 | 仅个别示例合规而未全量扫描 | 每轮必跑 |
| D-16 | 不引入同类框架（C-16、C-38） | `site/package.json` 的 `dependencies`/`devDependencies` 不含 `react`/`vue`/`solid-js`/`svelte`；代码高亮依赖限定为 `shiki`，且 Shiki 必须为构建期 tokenize（Vite 插件在构建期把代码块高亮为 HTML 字符串注入，运行期仅做复制按钮交互） | 仅排除运行时依赖却引入了上述框架；Shiki 运行期 tokenize 把 grammar/主题打进客户端 bundle | 每轮必跑 |
| D-17 | `site/README.md` 完整（C-39） | `site/README.md` 含「dev/build/preview」「目录结构」「新增文档页」「新增示例」「与库 src 依赖关系」五个小节断言 | 缺任一小节 | 每轮必跑 |
| D-18 | 与 `playground/` 隔离（C-40、C-41） | `site/` 不在 `playground/` 内；`.gitignore` 仍含 `playground` 行 | 把站点放进 playground 或改了 gitignore | 每轮必跑 |
| D-19 | 库测试仍通过（C-01、AGENTS.md 门禁） | 库根 `npx vitest run` 退出码 0 | 仅跑子集冒充全量 | 每轮必跑 |
| D-20 | 机检脚本存在且可复跑（C-42、R1-F04） | `cd site && npm run build && node site/scripts/check-all.mjs`，`check-all.mjs` 串行调用 check-preview/check-examples/check-exports/check-antipatterns/check-structure/check-routes/check-doc-coverage/check-examples-coverage，退出码 0；各脚本文件存在于 `site/scripts/` | 脚本不存在；`check-all` 跳过任一子检查；脚本仅 grep 源码而不执行产物 | 每轮必跑 |
| D-21 | data0 npm 回退分支可解析（C-45、C-46） | `node site/scripts/check-data0-fallback.mjs`：脚本通过设置环境变量 `AXII_DATA0_FORCE_NPM=1`（`site/vite.config.ts` 须识别该 env：当其为真时跳过 `existsSync` sibling 分支、强制走 npm 包），执行 `cd site && rm -rf node_modules && npm install && npm run build`，退出码 0；脚本不得重命名、移动或删除 `../data0` 目录，运行前后 `ls ../data0` 一致；结束后清理 `site/node_modules` | 仅在 sibling-present 环境跑 D-01 通过（sibling 分支掩盖了 npm 回退缺陷）；脚本重命名/移动/删除 `../data0` 目录（破坏兄弟 git 仓库，`SIGKILL`/断电下 `try/finally` 无法保证还原）；未实际重装 `site/node_modules` 而仅重跑构建；`site/vite.config.ts` 未识别 `AXII_DATA0_FORCE_NPM` env 致脚本无法触发 npm 回退分支 | 按关联声明触发 |
| D-22 | production 构建中 `__DEV__` 取 `false`（C-44、R3-F02） | `node site/scripts/check-dev-flag.mjs`：脚本读取 `site/dist/` 内 JS 产物，断言不含 `debugger` 语句（`src/util.ts:65` 的 `if (__DEV__) debugger` 在 `__DEV__=false` 下经 esbuild 死代码消除后不应保留 `debugger`），且不含 `data-axii-style-itor-num` 字符串（`src/StaticHost.ts:528` 的 dev 诊断分支不应进入生产产物）。退出码 0 | 仅检查 `site/vite.config.ts` 源码含 `__DEV__: false` 字面量而不验证产物（配置写法与实际 define 注入可能不一致）；仅 `tsc` 通过而未跑 production `vite build` 产物 | 按关联声明触发 |
| D-23 | 文档概念覆盖（C-27） | `cd site && npm run build && node site/scripts/check-doc-coverage.mjs`：脚本枚举 C-27 的 12 类概念关键字（心智模型、`atom`、`RxList`、`RxMap`、`RxSet`、`RxTime`、`computed`、Component AOP（`bindProps`/`mergeProps`/`mergeProp`/reusable）、`Portal`、`Form`、`createContext`/`ContextProvider`、`RxDOM`、`lazy`、`enableAxiiRetainedObjectDiagnostics`），扫描文档区产物（`site/dist/` 渲染后 DOM 或 `site/src/` 文档源）断言每类概念至少出现一处，退出码 0 | 某类概念整个概念页/代码片段缺失（该符号根本不出现在扫描集，D-12 一致性检查不会因此失败）；仅做 D-12 一致性对照而未做覆盖枚举 | 每轮必跑 |
| D-24 | 示例覆盖范围（C-31） | `cd site && npm run build && node site/scripts/check-examples-coverage.mjs`：脚本枚举 C-31 的 10 类示例标识（`atom` 双向绑定、`RxList` 增量列表、`RxMap`、`RxSet`、`computed` 派生、Component AOP、`Portal` 弹层、`Form` 表单、`RxDOMRect`、`RxDOMSize`、`RxDOMScrollPosition`），断言产物中每类示例页均存在且通过 D-09 的代码块+live 根非空断言，退出码 0 | 仅产部分示例页（如只产 2 个）而通过 D-09/D-13/D-20（三者均以「已存在示例」为前提，不校验必需集合齐全）；仅遍历已存在示例校验质量而不校验集合完备性 | 每轮必跑 |
| D-25 | 示例 live root 卸载时序（C-18、C-20、AGENTS.md 内存约束） | `cd site && npm run build && node site/scripts/check-cleanup.mjs`：脚本用 headless 导航 `/examples`，打开 Portal modal 后关闭、再用站点自有路由（`history.pushState` + atom，经 topnav logo 点击触发，非 `page.goto` 全页重载）客户端导航至 `/`，断言：① `document.body` 上 `[data-example-portal]` 计数为 0（Portal 示例的 portal root div 已被 `root.destroy()` 触发的 `useEffect` 清理移除）；② 全文档 `[data-example-root]` 计数为 0（11 个示例的 inner `createRoot` 全部销毁）；③ `document.body.children.length === 1`（仅 `#root`，无孤儿 DOM）。退出码 0 | 用 `page.goto()` 全页重载替代客户端路由导航（全页重载会清空一切，掩盖 `<Example>` `ref(null)` 未销毁 inner root 的泄漏）；仅断言 `[data-example-portal]` 为 0 而不断言 `[data-example-root]` 全文档为 0（漏掉非 Portal 示例的 inner root 泄漏）；仅导航一次（漏掉「先打开 modal 再导航」与「不打开 modal 直接导航」两类场景的覆盖） | 每轮必跑 |

### Backlog

- 背景 §1 第 2 条对 `src/index.ts` 各 `export *` 来源的行号描述偏粗（R1-F10 降级），可在后续轮按 `export *` 来源分组附行号区间，不阻塞。
- DR-02/背景对 `ui.axii.dev` 的「当前未部署」表述可更谨慎（R1-F11 降级），不阻塞。
- 深色模式：本期 C-11 取 Vercel 风格浅色档（白底深字）作为默认，未提供深色档 token；Vercel 官网/dashboard 实际以深色（`#000`）主导。后续可将 `--axii-bg`/`--axii-fg` 定义为可切换 token 对并登记深色模式，不阻塞（R2-F10 降级）。
- D-15 (b) 可机检性收紧（R3-F03 降级）：C-36 禁止的三类反模式中，「重渲染/vdom diff 心智写法」「handler 写成响应式表达式」在源码层面无稳定机械特征，D-15 (b) 现描述不可直接机检，存在「实现期靠人工目测冒充门禁通过」风险。建议实现期将 D-15 (b) 收紧为可机检规则集合（如扫描 `on[A-Z]\w*\s*=\s*\{` 后紧跟非箭头函数/非函数标识符的形态、`on*` 属性出现在 `atom()`/`computed()` 赋值右侧的形态），并把无可机检特征的反式剥离为文档审查项、在 (c) 标明。当前不阻塞，待人工决定是否升级为规范性条款。
- D-12 (b) 扫描边界与豁免规则（R3-F05 降级）：「正文裸调用形态 `Identifier(`」在散文中会大量命中说明性文字，(b) 未给出区分「代码块内裸用」与「散文提及」的规则。建议实现期将扫描范围限定为 fenced code block 与示例 `.tsx` 源码并给出豁免规则，使门禁输出确定。不阻塞。
- 示例代码形态与 README 形态差异说明（R3-F06 降级）：`?raw` 导入示例 `.tsx` 全文，展示代码带 `render(container)` 容器包装，与 README 宣传的 `createRoot().render()` 整洁形态不一致。建议在 DR-06 或 C-28 增加一句资料性说明二者等价、仅入口包装不同。不阻塞。
- 站点 alias 名称单一事实源（R4-F07 降级）：C-04「与 `@framework` alias 风格一致」、C-33「`from 'axii'` 或仓库内 alias」、术语表「站点用等价 alias」三处对站点 alias 名称的指示未在唯一处钉死。建议在术语表或 C-04 明确站点 alias 名称为 `'axii'`（使示例可用 `from 'axii'` 自示范包名导入），并把 C-04「风格一致」改为指风格而非名称。不阻塞（C-33 已用「或仓库内 alias」留出余地，不致实施失败）。
- Shiki 构建期 tokenize 接入路径（R4-F08 降级）：DR-04/C-43 选定 Shiki 构建期 tokenize，但未说明 Vite 插件如何把运行时 `?raw` 字符串源（`<Example>` 的 `code` prop）在构建期 tokenize。建议在 DR-04 或 C-43 增一句资料性说明固定接入形态（如示例源另以 `?shiki` 后缀导入高亮 HTML 供展示、`?raw` 导入原始字符串供复制按钮，或 Vite 插件对 `site/src/examples/**` 的 `?raw` 导入返回高亮 HTML），使 D-16 (b) 可据此断言客户端 bundle 不含 Shiki grammar/主题。不阻塞（机制可行，当前不足以致机械验证「运行期未加载 grammar」）。
- D-13 mutation check 的 per-mutation rebuild 步骤（R4-F09 降级）：D-13 (b) 仅写 `node site/scripts/mutation-check.mjs`，未显式包含 per-mutation rebuild 步骤，而示例源经 `?raw`/import 在 `vite build` 期固化，mutation 后须重新构建产物再 headless 复验。建议在 D-13 (b) 显式补「脚本对每个示例：注入 mutation → `cd site && npm run build` → headless 复验 → 还原源码 → 重新 build 确认还原后通过」。不阻塞（意图可从 (c)「记录注入点、失败类型与现象」恢复，但存在「实现期用静态分析冒充 mutation 复验」的空隙）。
- 【设计文档规范候选 · 供人工采纳，不直接修改模板】「覆盖」类声明的门禁必须含覆盖枚举（R4 收敛整理）：本循环 F-01（C-27 概念覆盖）、F-02（C-31 示例覆盖）、F-03/F-04/F-05（D-07 token 覆盖）属同一重复模式——规范性条款用「至少覆盖 X 类」枚举具体项，但完成纪律只做一致性/质量校验而不校验集合完备性，导致「省略枚举项而门禁仍通过」的 false-pass。建议在「设计文档规范 · 完成纪律」中增一条：凡规范性条款以枚举形式列出必需项（概念/示例/token 等），其完成纪律必须包含一条枚举覆盖门禁（逐项断言存在），仅做一致性对照不构成覆盖证据。
- 【设计文档规范候选 · 供人工采纳，不直接修改模板】门禁不得对仓库外部目录做破坏性操作（R4 收敛整理）：本循环 F-06（D-21 重命名兄弟 git 仓库目录）暴露「触发式门禁为构造环境条件而对仓库外部目录做重命名/移动/删除」的反模式。建议在「设计文档规范 · 完成纪律」中增一条：门禁脚本禁止对仓库外部目录（含兄弟仓库、全局配置）做重命名/移动/删除等破坏性操作，必须以 env-var/容器化/临时副本等非破坏性机制构造所需环境条件。
- D-12 仅校验导入符号成员资格、不校验片段语义正确性（审计轮 1 发现）：`check-exports.mjs` 对照 `src/index.ts` 导出集校验 `import { ... } from 'axii'` 的具名符号是否在导出集内，以及 `createRouter/createAction/createStateMachine` 三类裸调用是否被标注。但它无法捕获「符号在导出集内但用法语义错误」的缺陷——审计轮 1 发现 `portal.ts` 片段用 `<Portal container={...}>{children}</Portal>`（Portal 读 `content` 不读 `children`，运行期抛 TypeError），`Portal` 在导出集内故 D-12 通过，形成 false-pass。建议实现期将 D-12 (b) 扩展或在 D-13 mutation check 中增加「文档片段可执行性」校验维度（至少对组件 prop 形态做一次 `?raw` + `new Function` 或构建期类型校验）。当前不阻塞（W-18 登记修复 Portal 片段本身），但「文档片段语义正确性」是一类 D-12/D-13 未覆盖的缺陷模式，待人工决定是否升级为规范性条款。
- D-19 (b)「退出码 0」与既有 pre-existing 失败的现实偏差（审计轮 1 发现）：库 `npx vitest run` 当前存在 5 个 pre-existing 失败（`data0Contract`/`data0RecoveryRerun`/`errorHandling`/`rxListHost`，系兄弟 data0 版本差异致），退出码为 1 而非 0。审计轮 1 已在 clean HEAD（stash `site/` 后）复现同样 5 失败，证实非 `site/` 引入，C-01「站点新增后仍通过」的比较语义满足。但 D-19 (b) 字面要求「退出码 0」与现实不符。建议实现期将 D-19 (b) 表述收紧为「`npx vitest run` 失败集合不大于 clean HEAD 基线（即站点不引入新失败）」，或与人工确认是否应将这 5 个 pre-existing 失败作为库本身待修问题单独立项。当前不阻塞（W-16 证据如实披露了 5 失败与 pre-existing 性质）。
- D-21 (b) 字面要求 `rm -rf node_modules && npm install`，但 `check-data0-fallback.mjs` 实现仅执行 `npm install`（无 `rm -rf`）（审计轮 1 发现）：`AXII_DATA0_FORCE_NPM=1` env 已在 Vite resolve 层强制走 npm 分支，build 产物 bundle 体积从 341.95 KB（sibling）变为 360.32 KB（npm），证明 npm 分支被实际执行，门禁意图达成。但「未 `rm -rf node_modules`」意味着若 `node_modules/data0` 残留旧版本可能存在边缘 false-pass。建议实现期在脚本中补 `rm -rf node_modules` 步骤以严格匹配 D-21 (b) 字面要求。当前不阻塞（env-var 机制已保证 resolve 层走 npm 分支）。
- `--axii-space-8` 在 `site/src/pages/DocsPage.tsx:48` 被使用但未在 `tokens.css` 定义（审计轮 1 发现）：C-13 定义的间距阶梯为 4/8/12/16/24/40/48px（即 `--axii-space-1/2/3/4/6/10/12`），不含 32px 档（`--axii-space-8`）。`var(--axii-space-8)` 解析为未定义，`marginBottom` 回退到 initial（0），属纯视觉缺陷不崩溃。建议实现期或在 tokens.css 补 `--axii-space-8: 32px`，或将 DocsPage.tsx 改用已定义的 `--axii-space-6`/`--axii-space-10`。当前不阻塞。
- 【完成纪律变更提议 · 供人工采纳】示例 live root 卸载时序门禁（审计轮 4 发现，W-06 复开动因）：D-09/D-13 仅校验 live root「挂载后非空」，不校验「卸载时 inner `createRoot` 被 `destroy()`」。审计轮 4 实证 `<Example>` 的 `ref` 回调无 `null` 分支，导航离开 `/examples` 时 11 个示例的 inner root 与 PortalExample 的 `document.body` 上的 portal root 均不清理（孤儿 modal 滞留、响应式图泄漏）。建议新增触发式门禁（如 `check-cleanup.mjs`：headless 导航至 `/examples`、打开 Portal modal、导航至 `/`、断言 `document.body` 上 `[data-example-portal]` 计数为 0 且 `#root` 内无残留 `[data-example-root]`），并把「示例 `render(container)` 返回可销毁句柄、`<Example>` 在 `ref(null)` 时调用销毁」作为 C-18/C-20 的资料性约束或新增条款。本轮不直接新增条款（按变更协议需人工确认），W-06 复开已登记缺陷本身。【轮 5 已实施】：本提议于实现轮 5 落地为 D-25（`check-cleanup.mjs`，每轮必跑）+ C-47（示例 `render` 返回销毁句柄、`<Example>` `ref(null)` 调用销毁），W-19 登记修复、W-06 关闭。原提议「触发式门禁」升级为「每轮必跑」（卸载时序是内存约束，应每轮校验）。原提议保留于此作为「只进不出」记录，人工可据以决定是否将「卸载时序门禁」模式晋升为「设计文档规范」候选条目。
- 【设计文档规范候选 · 供人工采纳，不直接修改模板】「生命周期/卸载」类声明的门禁必须用客户端路由触发（轮 5 收敛整理）：D-25 实施时发现，用 `page.goto()` 全页重载做卸载校验会清空一切、掩盖 `<Example>` `ref(null)` 未销毁 inner root 的泄漏（false-pass）。这与本循环既有的「覆盖枚举」「门禁不得破坏外部目录」候选属同一模式——门禁的执行机制必须与声明的危害类型匹配。建议在「设计文档规范 · 完成纪律」中增一条：凡声明涉及「卸载/清理/销毁」时序的，其完成纪律必须通过客户端路由/组件卸载等保留 JS 状态的机制触发，禁止用全页重载冒充卸载事件。
- D-13 mutation-check 还原鲁棒性（审计轮 4 发现）：`mutation-check.mjs` 对每个示例「注入 mutation → build → headless 复验 → `writeFileSync(filePath, original)` 还原」，还原发生在 build+headless 之后；若脚本在 build/headless 阶段被中断（如 `SIGKILL`/CI 超时/手动 `TaskStop`），源码停留在 mutation 状态。审计轮 4 实证：中断后 `RxDOMSizeExample.tsx` 残留 `/* MUTATION: render call removed */ void 0`，致后续 D-13 重跑报告 `mutation-not-applied`（false-pass：mutation-① 检查被跳过）。建议实现期在脚本入口注册 `SIGINT`/`SIGTERM`/`beforeExit` 处理器，或在注入前写 `.bak` 副本、退出时统一校验还原。当前不阻塞（属脚本工程健壮性，非设计文档缺陷）。
- D-13 mutation-check phenomenon 标签硬编码（审计轮 4 发现）：`mutation-check.mjs:135` 的 phenomenon 模板硬编码 `atom→atomX`，故 `RxMap→RxMapX`/`RxSet→RxSetX`/`createRoot→createRootX` 的记录 phenomenon 字段均误显为 `atom→atomX`。`failureType`（`build-error`）与判定逻辑正确，不影响门禁结论。建议实现期将 phenomenon 模板改为 `${apiToBreak}→${brokenName}`。当前不阻塞（纯日志可读性）。
- `form.ts` 文档片段的 `ref={(el) => el && values.set('email', el.value)}` 仅在挂载时取一次值（审计轮 4 发现）：该片段示意 Form 容器用法，`ref` 回调在元素挂载时执行一次，不会响应后续 `input` 事件更新 `values`。`site/src/examples/FormExample.tsx` 的正确用法是 `onInput` 内更新 atom 并调用 `formContext.onChange()`。片段作为「Form 容器」的概念示意可接受，但易误导读者认为这是字段绑定的完整写法。建议实现期或在片段注释中标注「示意 Form 容器，字段绑定见 FormExample」，或补一行 `onInput`。当前不阻塞（不违反 C-29：片段符号与导出集一致，语义非错误仅不完整）。
- 【设计文档规范候选 · 供人工采纳，不直接修改模板】销毁/卸载类声明的门禁必须由审计轮独立做 mutation check 复验（轮 5 收敛整理）：W-06 在轮 4 审计通过「D-25 存在并执行」后，轮 5 审计仍独立注入「禁用 `<Example>` `ref(null)` detach 分支」mutation 并复跑 D-25，证实 D-25 在 mutation 下退出码 1（捕获 `[data-example-portal]=1` 孤儿 modal）、还原后退出码 0——这是「门禁存在」不等于「门禁有效」的唯一可信证据。这与本循环既有的「覆盖枚举」「门禁不得破坏外部目录」「卸载时序门禁必须用客户端路由」候选属同一模式——门禁的「有效性」本身需要被独立证伪验证。建议在「设计文档规范 · 完成纪律」或「评审与裁决协议 · 审计轮」中增一条：凡声明涉及「销毁/卸载/清理」时序且其门禁以「X 计数为 0 / Y 归零」为断言形态的，审计轮必须独立注入一处破坏销毁路径的 mutation（如把销毁调用改为 `void 0`、注释掉清理分支）并复跑该门禁，记录 mutation 下的失败现象与还原后的通过现象；仅复跑门禁通过不构成「销毁声明已验证」的证据。该候选与 R4 已晋升建议「生命周期/卸载类声明的门禁必须用客户端路由触发」互补：前者保证门禁「能失败」，后者保证门禁「在真实卸载事件下失败」。
- 【完成纪律晋升建议 · 供人工采纳，不直接修改模板】「资源句柄/闭包捕获」类声明的门禁应覆盖「句柄被调用」而非「句柄存在」（轮 5 收敛整理）：W-06 复开根因是 `<Example>` 持有 `destroyHandle` 闭包但 `ref(null)` 分支不调用它——「句柄存在」通过而「句柄被调用」不通过。D-25 通过断言 `[data-example-portal]=0`（句柄被调用的下游可观测效果）而非检查 `destroyHandle` 变量本身来覆盖此声明，是正确形态。建议在「设计文档规范 · 完成纪律」中增一条：凡声明涉及「返回销毁句柄 / 闭包捕获清理函数 / onCleanup 注册」的，其完成纪律必须以「句柄被调用后的下游可观测效果」（DOM 移除、订阅计数归零、全局监听器消失等）为断言对象，禁止以「句柄变量被赋值」「清理函数被注册」等源码层存在性为门禁通过证据。该候选与「销毁类门禁必须 mutation check」候选协同：前者规定断言对象，后者规定验证手段。

### 争议项

- 暂无。

---

## 二、正文

### 1. 背景与现状

axii 是一个高性能无 Virtual DOM 的增量更新前端框架库（`package.json` description；`README.md` L24）。对外域名为 `axii.dev`（`README.md` L2、L7）。现状事实（均已亲自核对）：

- **仓库内无官网站点源码**：根目录无 `index.html`（`ls` 根目录确认）；无 `docs/` 目录（本轮新建）；`playground/` 存在但已被 `.gitignore` 忽略（`.gitignore` L31 `playground`），不会进入仓库。
- **`src/index.ts` 真实导出**（`src/index.ts` L1-27）：`export * from './DOM'`、`PropTypes`/`TypeChecker`、`createRoot`、`createHost`、`export * from './eventAlias.js'`、`export * from './Host.js'`、`export * from './types.js'`、`export * from './ref.js'`、`export * from './Portal.js'`、`export * from './Form.js'`、`export * from './ComponentHost.js'`（含 `bindProps`/`mergeProps`/Component AOP 能力）、`export * from './StaticHost.js'`、`export * from './reactiveDOMState.js'`（含 `RxDOMRect`/`RxDOMSize`/`RxDOMFocused`/`RxDOMHovered`/`RxDOMScrollPosition`/`RxDOMDragState`/`RxDOMEventListener`/`ModalContext`）、`export * from './diagnostics.js'`、`ContextProvider`/`createContext`、`export * from 'data0'`（含 `atom`/`RxList`/`RxMap`/`RxSet`/`RxTime`/`computed`/`autorun`/`ManualCleanup`）、`ManualCleanup as AutoCleanup`、`export * from './lazy.js'`（`lazy`）、`enableAxiiRetainedObjectDiagnostics` 等诊断函数。
- **README 引用但未从 `src/` 导出的内容**（`README.md` L41-46）：router（链接 `axii.dev/playground/3-common_util/1-router`）、Action（数据请求管理，`2-action`）、state-machine（`3-statemachine`）、headless 组件系统（`ui.axii.dev`）。`grep -rn "router\|createRouter\|createAction\|createStateMachine" src/index.ts` 无命中——这些**确不在本仓库 `src/` 内**。但它们是真实存在的外部包（已联网核实，见决策记录 DR-02）：`router0`（npm，reactive data based router）、`action0`（data0 based action management）、`statemachine0`（npm，data0 based statemachine）、headless UI 在 `axiijs/ui` 仓库（面向 `ui.axii.dev`，当前未部署）。
- **构建工具链**（`package.json`、`vite.config.ts`、`vite.prod.config.ts`）：Vite 7 + `esbuild.jsxFactory: 'createElement'` + `jsxFragment: 'Fragment'` + `define.__DEV__`（dev=true，prod=false）+ `vite-plugin-dts`（rollupTypes）+ `vite-tsconfig-paths`。存在 `src/vitePlugin.ts`（`axiiDevtools`，`vite.prod.config.ts` L18 独立入口打包）。库两份配置的 alias **不一致**，需区分：
  - `vite.config.ts`（库 dev）：`resolve.alias` 仅 `@framework → ./src/index.ts`；data0 alias 行**被注释**（`// 'data0': fileURLToPath(... '../data0/src/index.ts')`），故 dev 期 data0 解析到 npm 包。
  - `vitest.config.ts`（库 test）：用 `existsSync('../data0/src/index.ts')` 条件 alias——sibling checkout 存在则 `data0 → sibling`，否则用 npm 包。本机实测 sibling `../data0/src/index.ts` 存在（`ls` 确认），故库测试当前消费 sibling data0。
  - `define.__DEV__`：库 `vite.config.ts`/`vitest.config.ts`/`vite.prod.config.ts` 均注入运行时值（dev/test=true，prod=false）；`global.d.ts` 仅 `declare var __DEV__: boolean` 类型声明，**不提供运行时值**。`src/` 裸引用 `__DEV__`（`src/util.ts:65`、`src/StaticHost.ts:284`、`src/StaticHost.ts:528`），故任何消费 `src/` 的 vite 配置必须 `define.__DEV__`，否则运行期 `ReferenceError`。
- **tsconfig 边界**（`tsconfig.json`、`tsconfig.prod.json`）：库 `tsconfig.json` `include` 为 `["global.d.ts", "src", "__tests__", "playground"]`（L32-37）——**不包含通配 `site/`**，新 `site/` 目录不会被库 tsconfig 编译。`tsconfig.prod.json` `include` 为 `["global.d.ts", "src"]`（L28-31），dts 生成（`vite.prod.config.ts` L30）只用 prod tsconfig，与 `site/` 完全隔离。库 `tsconfig.json` 的 `exclude` 仅 `["dist", "node_modules"]`（L28-30）。
- **`.gitignore`**（已核对）：忽略 `node_modules`、`dist`、`lib`、`coverage`、`_site`、`_data`、`playground`、`__tests__/__screenshots__` 等。`site/` 不在忽略列表——站点源码会进入版本控制（符合「在库仓库内新增子工程」要求）；站点构建产物 `site/dist` 需由站点自身 `.gitignore`（或站点目录内忽略）处理。
- **门禁现状**：库 `npx vitest run`（浏览器全量，`vitest.config.ts` L40-45 chromium+playwright headless）与 `npm run build`（`vite build --config vite.prod.config.ts && node scripts/type.js`）是库质量门禁。`__tests__/rxListFuzz.spec.tsx` 是列表/region 相关改动的触发式门禁（AGENTS.md）。
- **事件语义**（`README.md` L128、`src/DOM.ts` L195-205 `isEventName`）：`on*` 属性在元素创建时经 `addEventListener` 绑定一次，非响应式；条件行为须写在 handler 内部，不得动态替换 handler。
- **Vercel 视觉系统**（已联网核实 vercel.com / Geist font / npm）：近黑 `#171717`、纯白 `#ffffff` 背景、品牌蓝 `#0070f3`；Geist Sans + Geist Mono 字体（OFL-1.1，Google Fonts 与 npm `geist` 均可得，权重 100-900）；内容 max-width 1080px、文档区 1400px 三栏（sidebar/content/TOC 240px）；cmdk 风格命令搜索；代码块终端风（`--geist-console-*` token，蓝 `#0070f3`/粉 `#eb367f`/紫 `#7928ca`/青 `#50e3c2`）；Hero 为大标题+副标题+主次 CTA；特性卡片为黑色细发丝边框、6-12px 圆角、`#fff`/`#fafafa` 背景。
- **axii 对外信息**（已联网核实 npm registry / GitHub API / curl）：npm 包名 `axii`（unscoped），npm `latest` 为 4.6.7，本仓库 `package.json` 为 4.6.6（本地落后一个补丁版本），MIT，author `sskyy`；GitHub `axiijs/axii`，MIT；`axii.dev` 当前由 **Netlify** 托管（`curl -I https://axii.dev/` → `server: Netlify`，返回 404，站点未部署），`ui.axii.dev` 同样由 Netlify 托管并返回 404。站点展示版本号一律取本仓库 `package.json`（站点随库版本发布），不取 npm latest。
- **既有官方站点仓库 `axiijs/site`**（已联网核实 GitHub API / `raw.githubusercontent.com/axiijs/site/main/package.json`）：存在独立的老站点仓库 `axiijs/site`（`full_name: axiijs/site`，`description: "Axii doc site."`，`pushed_at: 2025-03-17`），其 `package.json` `name` 为 `axii-site`，依赖 `axii@^3.0.2`（落后两个大版本）、`router0`/`action0`/`statemachine0`/`axii-ui`/`axii-ui-theme-common`、`@codemirror/*`/`monaco-editor`/`@mdx-js/mdx`/`@wooorm/starry-night`（语法高亮用 starry-night 而非 Shiki），构建用 `vite.site.config.ts`，托管于 Netlify。即 axii 生态已有一个独立的、基于 axii 3.x 的重型文档站点。本期在库仓库内新建 `site/` 的定位见 DR-10。

### 2. 目标 / 非目标

**目标**：
- 在本仓库新增顶层 `site/` 子工程，作为 axii 文档与可运行示例的唯一入口，可 `npm run build` 产出静态可部署产物、`npm run preview` 本地预览。
- 站点整体用 axii 渲染，采用 Vercel 风格视觉系统。
- 文档区覆盖 axii 核心概念，示例区每个示例同时展示源代码与真实可交互 live demo。
- 不破坏库既有门禁，不污染库构建与库测试。

**非目标**：
- 不在本期实现 router/Action/state-machine/headless 的 API（它们是外部包，仅标注引导）。
- 不改动库 `src/` 任何代码（站点只是库的消费者）。
- 不做站点国际化框架的完整工程化（中英文以内容为主，结构上预留但不强制多语言路由）。
- 文档站本身是纯客户端 SPA（静态 HTML + JS，`createRoot` 挂载）。框架核心另提供 `axii/ssr` 的 `renderToString` 与主包 `hydrateRoot`（认领式激活）；站点文档需覆盖这两项 API，但站点构建不跑服务端渲染。

### 3. 决策记录（decision record）

- **DR-01 站点落位 `site/` 顶层目录，不复用 `playground/`**。结论：新建 `site/`。否因：`playground/` 被 `.gitignore` 忽略且为零散单页示例，复用会违反「不得取消对 playground 的忽略」并污染结构。
- **DR-02 对 README 引用但未导出的 router/Action/state-machine/headless 的处置**。结论：逐项标注「外部包」，给出准确包名（`router0`/`action0`/`statemachine0`/`axiijs/ui`），不在文档中编造其 API 形态。否因：「本期自建轻量实现」会与已存在的外部包重复造轮子且超出站点范围；「暂不纳入」会丢失 README 已宣传的能力入口。已联网核实这些外部包真实存在（npm `router0`@2.0.2 /`action0`@1.0.2 /`statemachine0`@2.3.1，GitHub `axiijs/ui`）。
- **DR-03 站点路由形态**。结论：自建轻量 history API 路由（基于 `history.pushState` + `popstate`，无外部依赖）。否因：「依赖外部包」违背 axii 站点应自示范 axii 能力的初衷，且 router 未从 `src/` 导出；自建轻量路由足以覆盖站点内部三个页面（首页/文档/示例）的导航需求，并以 axii 的 `atom` 表达当前路径、用函数节点响应路径切换——这本身也是 axii 响应式驱动渲染的正确示范。
- **DR-04 代码高亮选型**。结论：Shiki，构建期 tokenize。否因：Prism 依赖运行时 tokenize 且主题与 Vercel 风格不一致；Starlight 绑定 Astro；既有 `axiijs/site` 用的 `starry-night`/`rehype-starry-night` 依赖 MDX 管线且为运行期 highlight、与本期「构建期 tokenize + axii 自渲染代码块」架构不兼容；Vercel 自家用的自定义 tokenizer 不开源。Shiki VS Code 语法树准确、可定制 Geist 兼容主题（`github-dark`/`vitesse-dark` 改色）；采用构建期 tokenize（Vite 插件把代码块高亮为 HTML 字符串注入 `<Example>`），运行期仅做复制按钮交互，避免把 grammar/主题打进客户端 bundle 与「组件函数只执行一次」的性能心智冲突。Shiki 为纯展示依赖，不作为站点框架。
- **DR-05 字体方案**。结论：通过 Google Fonts CSS API 引入 Geist Sans + Geist Mono（`fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap`），fallback 为系统无衬线/等宽栈。否因：npm `geist` 包绑定 `next/font`；Fontsource 增加依赖；手动托管 woff2 增加仓库体积。Google Fonts 已确认提供 Geist 两个家族（OFL-1.1）。
- **DR-06 `<Example>` 形态：同一源文件经 `?raw` 与正常 import 双导入**。结论：每个示例为一个独立 `.tsx` 文件，导出 `render(container: HTMLElement): () => void`（返回销毁句柄，见 C-18）；`<Example>` 组件用 Vite `?raw` 后缀导入同文件得到源码字符串、用正常 import 得到 `render` 函数，二者来自磁盘同一文件故不漂移。`<Example>` 在 `ref(null)` 分支调用 `render` 返回的销毁句柄以销毁示例的 inner `createRoot`。否因：「手写源码字符串 + 单独写运行代码」必然漂移；「运行时 `Function(sourceString)` eval」有 CSP 风险且无法享受 TS/JSX 编译。可行性已实验求证（见裁决记录 R1）：同文件 `?raw` 字符串与正常 import 的 `render` 解析到同一物理文件，`render(container)` 可挂载可交互 axii 子树（`atom` 双向绑定驱动 `<span>` 文本实时更新通过）。
- **DR-07 站点不引入 React/Vue/Solid**。结论：站点整体用 axii 渲染。否因：引入同类框架违背「站点本身用 axii 实现」的硬约束，且无法自示范 axii。Shiki 为纯展示依赖，例外允许。
- **DR-08 tsconfig 边界处理**。结论：`site/` 使用独立 `site/tsconfig.json`（`jsx: react`/`jsxFactory: createElement`/`jsxFragmentFactory: Fragment`，与库一致；`include: ["src"]` 仅含站点自身）；不修改库 `tsconfig.json`/`tsconfig.prod.json`。否因：「把 site 加入库 tsconfig include」会拖累库 `tsc` 与 dts 生成；「改库 tsconfig exclude」是不必要的库侧改动。库 `tsconfig.json` 的 `include` 列表本就不含 `site`，天然隔离。
- **DR-09 站点 data0 解析策略**。结论：`site/vite.config.ts` 复用 `vitest.config.ts` 的 `existsSync('../data0/src/index.ts')` 条件 alias，sibling 存在则消费 sibling data0、否则用 npm 包。否因：「照搬 `vite.config.ts`（data0 alias 被注释、固定 npm 包）」会使站点与库测试的 data0 来源不一致（库测试在本机消费 sibling），引入隐性歧义；「固定消费 sibling」在无 sibling 的环境（如 CI/他人 clone）下解析失败。条件 alias 与库测试完全对齐，是唯一自洽方案。
- **DR-10 本期 `site/` 与既有 `axiijs/site` 的关系**。结论：本期在库仓库内新建的 `site/` 是**随库源码版本发布的轻量文档+示例站点**，定位为既有独立仓库 `axiijs/site`（基于 axii 3.x、重型、依赖 Codemirror/Monaco/MDX/starry-night）的**替代/继任者**——以「文档与示例直接消费 `../src/index.ts`、随库演进、零重型编辑器依赖」为核心差异。否因：「与 `axiijs/site` 并行长期维护」会造成两套文档分叉、与 `src/` 同步成本翻倍；「本期不建站、仅更新 `axiijs/site`」超出本仓库范围（`axiijs/site` 是独立仓库）且其 axii 3.x 基线已落后两个大版本。本期不负责迁移 `axiijs/site` 的历史内容，`axiijs/site` 的存废由人工后续决定。

### 4. 规范性条款（normative clauses）

- **C-01** 库本身的 `npx vitest run`（浏览器全量）与 `npm run build` 必须在站点新增后仍然通过。
- **C-02** 站点必须位于本仓库新顶层目录 `site/`，不得复用 `playground/`。
- **C-03** `site/` 必须有独立的 `site/package.json`、`site/vite.config.ts`、`site/tsconfig.json`、`site/index.html`，并提供 `dev`/`build`/`preview` 三个 npm 脚本。
- **C-04** 站点开发期必须经 vite alias 直接消费仓库 `../src/index.ts`（与库 `vite.config.ts`/`vitest.config.ts` 的 `@framework` alias 风格一致），不得消费库 `dist/`。
- **C-05** 站点构建产物必须只落在 `site/dist/`，禁止混入库 `dist/`。
- **C-06** 必须禁止改动库 `package.json` 的 `scripts`、`release-it` 钩子与 `exports`/`files` 字段。
- **C-07** 库 `tsconfig.json` 的 `include` 不得覆盖 `site/`；`site/` 必须使用独立 tsconfig。
- **C-08** 库 `vite.prod.config.ts` 的 dts 与 lib entry 不得触及 `site/`。
- **C-09** 站点必须能 `npm run build` 产出静态可部署产物（`site/dist/index.html` + JS/CSS），并能 `npm run preview` 本地预览。
- **C-10** 站点必须采用 Vercel 风格视觉语言：黑白为主、大面积留白、几何感强、克制强调色与微交互。
- **C-11** 配色 token 必须以 design tokens 落地：背景 `--axii-bg: #ffffff`、前景 `--axii-fg: #171717`、次级文本 `--axii-fg-muted`、边框 `--axii-border`、强调色 `--axii-accent: #0070f3`、代码块背景 `--axii-code-bg`。
- **C-12** 字体必须使用 Geist Sans（正文）+ Geist Mono（代码），经 Google Fonts 引入；fallback 为系统无衬线/等宽栈。
- **C-13** 间距/圆角/阴影必须以 token 落地：`--axii-radius`（6px/12px 两档）、`--axii-space-*`（4/8/12/16/24/40/48px 阶梯，token 家族名 `--axii-space`）、阴影 `--axii-shadow`（至少一档）、内容 max-width `--axii-content-width: 1080px`。
- **C-13a** 文档区三栏布局必须有独立宽度 token `--axii-doc-width: 1400px`（sidebar/content/TOC 三栏）。
- **C-14** 顶部必须为极简导航（logo + 主导航 + 命令式搜索入口观感），文档区必须有左侧边栏导航。
- **C-15** 首页必须有 Hero（大标题 + 副标题 + 主次 CTA 按钮）+ 特性卡片（至少 3 张，黑色细边框）。
- **C-16** 站点整体必须用 axii 渲染，禁止引入 React/Vue/Solid/Svelte 作为站点框架。
- **C-17** 代码块必须为终端风排版（深色或与页面反差的浅灰底 + 等宽字体 + 语法高亮 + 可复制按钮）。
- **C-18** 示例展示组件必须为 `<Example code={string} render={(container: HTMLElement) => () => void} />` 形态，同时渲染代码块与 live demo。示例的 `render(container)` 必须返回一个销毁句柄（`() => void`），该句柄在 `<Example>` 的 `ref(null)` 分支（页面卸载/路由切换时）被调用，以销毁示例内部创建的 `createRoot`——axii root 不被 GC 回收，不返回句柄会导致响应式图与 DOM 跨导航泄漏（W-06 复开根因）。资料性说明：销毁句柄典型实现为 `() => root.destroy()`；`root.destroy()` 会执行示例组件的 `useEffect`/`onCleanup` 清理（如 PortalExample 移除挂在 `document.body` 上的 portal root div）。
- **C-19** 示例的源码字符串与运行实例必须来自磁盘同一文件（经 Vite `?raw` 得字符串、经正常 import 得 `render`），禁止手写字符串与运行代码分离。
- **C-20** `<Example>` 的 live demo 区域必须是 axii 真实渲染的子树，禁止用静态截图/占位 div 替代。
- **C-21** `site/README.md` 必须说明 dev/build/preview、目录结构、新增文档页与示例的流程、与库 `src/` 的依赖关系。
- **C-22** 站点必须提供可工作的内部路由，覆盖首页、文档大纲页、示例索引页。
- **C-23** 路由必须为自建轻量 history API 方案（基于 `history.pushState` + `popstate` + `atom` 表达当前路径），禁止依赖外部 router 包。`site/vite.config.ts` 不得将 `appType` 覆盖为非 `spa` 值（或不显式设置 `appType`，沿用 Vite 默认 `spa`），以保证 history 路由深链在 `vite preview` 下回退到 `index.html`。
- **C-24** 示例展示组件（`<Example>`、`CodeBlock`）本身必须用 axii 实现。
- **C-25** 首页 Hero 必须含 H1 标题、副标题、至少一个主 CTA（指向文档或示例）与一个次 CTA（指向 GitHub）。
- **C-26** 特性卡片必须对应 axii 的核心卖点（心智模型/性能/响应式集合/Component AOP/RxDOM 状态封装等），每张含图标位 + 标题 + 一句描述。
- **C-27** 文档区必须以 axii 核心概念为骨架组织，至少覆盖：心智模型、`atom`、`RxList`/`RxMap`/`RxSet`/`RxTime`、`computed`、组件与 Component AOP（含 `bindProps`/`mergeProps`/`mergeProp`/reusable 子树）、`Portal`、`Form`、`createContext`/`ContextProvider`、`RxDOM*` 状态封装、`lazy`、`enableAxiiRetainedObjectDiagnostics` 诊断。
- **C-28** 每条文档概念必须配可读文字说明 + 代码片段。
- **C-29** 文档代码片段必须与 `src/` 实际导出与语义一致；从 `src/` 未导出的符号不得出现在 `import { ... } from 'axii'` 形态中。
- **C-30** 文档内容必须以中英文 README 与 `src/` 真实导出为唯一事实源。
- **C-31** 示例区必须至少覆盖：`atom` 双向绑定、`RxList` 增量列表、`RxMap`/`RxSet`、`computed` 派生、Component AOP、`Portal` 弹层、`Form` 表单、`RxDOMRect`/`RxDOMSize`/`RxDOMScrollPosition` 响应式 DOM 状态。
- **C-32** 每个示例必须同时直接展示源代码（语法高亮、可复制）与紧邻的真实可交互 live demo（输入可输入、按钮可点、列表可增删、响应式变化实时反映到 DOM）。
- **C-33** 示例所用的 axii 代码必须真实可运行（直接 `import { ... } from 'axii'` 或仓库内 alias），禁止用静态截图/占位替代。
- **C-34** 对 README 引用但未从 `src/` 导出的 router/Action/state-machine/headless，文档必须逐项标注「外部包（包名）/暂不纳入」，给出准确出处，禁止编造 API。
- **C-35** 文档与示例中禁止出现凭 README 链接反推出的未导出 API 形态（如 `createRouter(...)`、`createAction(...)`、`createStateMachine(...)`）。
- **C-36** 示例不得示范反模式：不得动态替换 `on*` 事件 handler、不得引入重渲染或 vdom diff 心智的写法、不得在事件 handler 外部把 handler 写成响应式表达式。
- **C-37** 事件「只绑定一次、非响应式」的语义必须在示例与文档中正确体现（条件行为写在 handler 内部）。
- **C-38** 代码高亮等纯展示依赖可用外部轻量库（限定 Shiki），但站点框架依赖不得引入 React/Vue/Solid/Svelte。
- **C-39** `site/README.md` 必须存在且包含规定小节。
- **C-40** 站点产物必须与 `playground/`（已被忽略）隔离，站点不得放进 `playground/`。
- **C-41** 必须禁止修改 `.gitignore` 以取消对 `playground/` 的忽略。
- **C-42** 站点完成纪律门禁必须可复跑：至少 `cd site && npm install && npm run build` 与 `cd site && npm run preview`，以及「构建产物中每个示例页面都包含真实渲染的 DOM 根 + 代码块」的可机检断言。
- **C-43** Shiki 必须为构建期 tokenize（Vite 插件在构建期将代码块高亮为 HTML 字符串注入），运行期禁止加载 Shiki grammar/主题；运行期仅允许复制按钮等纯交互。
- **C-44** `site/vite.config.ts` 必须按 Vite `mode` 注入 `__DEV__` 运行时值：`dev`（`npm run dev`）为 `true`、`production`（`npm run build`/`npm run preview`）为 `false`，以提供 `src/` 运行时所需的全局值（`src/util.ts:65` 的 `if (__DEV__) debugger`、`src/StaticHost.ts:284/528` 的 dev 诊断分支均裸引用 `__DEV__`，`global.d.ts` 仅作类型声明不提供运行时值），与库 `vite.config.ts`（`__DEV__: true`）/`vite.prod.config.ts`（`__DEV__: false`）的双配置取值对齐。站点用单一 `site/vite.config.ts` 服务 dev 与 build，故须按 `mode` 切换取值，禁止恒置 `true`（production bundle 会保留 `debugger` 与 dev 诊断路径）。
- **C-45** `site/vite.config.ts` 必须显式处理 `data0` 解析：复用 `vitest.config.ts` 的 `existsSync('../data0/src/index.ts')` 条件 alias（sibling 存在则指向 sibling，否则用 npm 包），保证站点与库测试一致的 data0 来源；禁止照搬 `vite.config.ts`（其 data0 alias 被注释、固定消费 npm 包）的 alias 风格而不加区分。资料性说明：`site/vite.config.ts` 可以（且应当）识别环境变量 `AXII_DATA0_FORCE_NPM`——当其为真时跳过 `existsSync` sibling 分支强制走 npm 包，仅供 D-21 门禁脚本触发 npm 回退分支使用，不改变默认条件 alias 行为；该 env 不得被 `site/package.json` 脚本或文档示范为常规用法。
- **C-46** `site/package.json` 必须将 `data0` 声明为依赖（`dependencies` 或 `devDependencies`），版本范围与库 `package.json` 的 `data0` peer/dev 依赖一致（`^2.14.0`），保证 C-45 的「否则用 npm 包」回退分支在无 sibling `../data0/src` 的环境（CI / 他人 clone）下可解析安装。
- **C-47** 示例的 `render(container)` 必须返回一个销毁句柄（`() => void`，典型实现 `() => root.destroy()`），`<Example>` 必须在 `ref(null)`（元素从 DOM 分离，如路由切换离开 `/examples`）时调用该句柄以销毁示例内部创建的 `createRoot`。axii root 不被 GC 回收，未销毁会导致响应式图与 DOM 跨导航泄漏；`root.destroy()` 执行示例组件的 `useEffect`/`onCleanup` 清理（如 PortalExample 移除挂在 `document.body` 上的 portal root div）。动因：W-06 复开（轮 4 审计发现 inner root 永不销毁、Portal modal 孤儿滞留）。本条与 C-18 的关系：C-18 规定 `<Example>` 形态与 `render` 签名（含返回销毁句柄），C-47 规定 `<Example>` 必须在卸载时调用该句柄的销毁语义。

### 5. 术语与键名表

| 术语/标识符 | 含义 |
|---|---|
| axii | 本仓库的前端框架库，npm 包名 `axii`，对外域名 `axii.dev` |
| data0 | axii 的响应式核心，peerDependency，`src/index.ts` 经 `export * from 'data0'` 透出 `atom`/`RxList`/`RxMap`/`RxSet`/`RxTime`/`computed` 等 |
| `site/` | 本设计新增的官网站点顶层子工程目录 |
| `<Example>` | 示例展示组件，props `code: string`、`render: (container: HTMLElement) => () => void`（返回销毁句柄） |
| `?raw` | Vite 后缀导入，将文件内容作为字符串导入 |
| `render(container)` | 示例源文件导出的函数，将 axii 子树挂载到给定容器，返回销毁句柄 `() => void`（C-18） |
| design tokens | `--axii-*` CSS 自定义属性，站点视觉系统的单一事实源 |
| 外部包 | 不在本仓库 `src/` 导出、但真实存在于 npm/GitHub 的 axii 生态包：`router0`、`action0`、`statemachine0`、`axiijs/ui`（headless UI） |
| Vercel 风格 | 黑白为主、Geist 字体、几何感、cmdk 搜索、终端风代码块的视觉语言（见背景第 8 条） |
| `@framework` | 库 dev/test alias，指向 `./src/index.ts`；站点用等价 alias 指向 `../src/index.ts` |

### 6. 追溯矩阵（traceability matrix）

| 规范性条款 | 工作项 | 完成纪律条目 | 验收项 |
|---|---|---|---|
| C-01 | W-16 | D-19、D-06 | 库测试与构建通过 |
| C-02 | W-01、W-15 | D-18 | `site/` 顶层、不复用 playground |
| C-03 | W-01 | D-01、D-02 | 独立配置与三脚本 |
| C-04 | W-02 | D-03 | alias 消费 src |
| C-05 | W-02 | D-03 | 产物不混入 dist |
| C-06 | W-02 | D-04 | 不改库 package.json |
| C-07 | W-03 | D-05 | tsconfig 不覆盖 site |
| C-08 | W-03 | D-06 | dts/entry 不触及 site |
| C-09 | W-01、W-16 | D-01、D-02 | build/preview 可复跑 |
| C-10 | W-04 | D-07 | Vercel 风格落地 |
| C-11 | W-04 | D-07 | 配色 token |
| C-12 | W-04 | D-07 | Geist 字体 |
| C-13 | W-04 | D-07 | 间距/圆角/阴影 token |
| C-13a | W-04 | D-07 | 文档区宽度 token |
| C-14 | W-05、W-08 | D-08、D-11 | 导航与侧边栏 |
| C-15 | W-05、W-08 | D-11 | Hero + 特性卡片 |
| C-16 | W-05、W-13 | D-16 | 不引入同类框架 |
| C-17 | W-05 | D-07、D-09 | 终端风代码块 |
| C-18 | W-06、W-19 | D-09、D-25 | `<Example>` 形态 + 销毁句柄 |
| C-19 | W-06 | D-09 | `?raw` + import 同源 |
| C-20 | W-06、W-10 | D-09、D-25 | live demo 真实渲染 + 卸载清理 |
| C-21 | W-14 | D-17 | site/README |
| C-22 | W-07 | D-10 | 路由覆盖三页 |
| C-23 | W-07 | D-10 | 自建 history 路由 |
| C-24 | W-05、W-06 | D-08、D-09 | 展示组件用 axii |
| C-25 | W-08 | D-11 | Hero 结构 |
| C-26 | W-08 | D-11 | 特性卡片内容 |
| C-27 | W-09、W-17 | D-12、D-23 | 文档概念覆盖 |
| C-28 | W-09 | D-12 | 文字+代码片段 |
| C-29 | W-09 | D-12 | 代码片段与 src 一致 |
| C-30 | W-09 | D-12 | 事实源 |
| C-31 | W-10、W-17 | D-09、D-13、D-20、D-24 | 示例覆盖范围 |
| C-32 | W-10、W-17 | D-09、D-13、D-20 | 代码+效果同示 |
| C-33 | W-10、W-17 | D-13、D-20 | 示例可运行 |
| C-34 | W-11、W-17 | D-14、D-20 | 未导出项标注 |
| C-35 | W-11、W-17 | D-14、D-20 | 禁编造 API |
| C-36 | W-12、W-17 | D-15、D-20 | 无反模式 |
| C-37 | W-12、W-17 | D-15、D-20 | 事件语义正确 |
| C-38 | W-13 | D-16 | 高亮选型 |
| C-43 | W-13 | D-16 | Shiki 构建期 tokenize |
| C-44 | W-01、W-02 | D-01、D-22 | 站点 define.__DEV__（按 mode） |
| C-45 | W-02 | D-01、D-21 | 站点 data0 alias |
| C-46 | W-02 | D-01、D-21 | site/package.json 声明 data0 |
| C-47 | W-06、W-19 | D-25 | 示例 render 返回销毁句柄 + `<Example>` 卸载时调用 |
| C-39 | W-14 | D-17 | README 小节 |
| C-40 | W-15 | D-18 | 与 playground 隔离 |
| C-41 | W-15 | D-04、D-18 | 不改 gitignore |
| C-42 | W-16、W-17 | D-01、D-02、D-09、D-20、D-25 | 门禁可复跑 |

### 7. 风险与验收

**风险**：
- C-19（`?raw` 与 import 同源）：风险在于示例源文件既被 `?raw` 当字符串、又被 TS 编译为运行模块，需保证两路导入解析到同一物理文件。缓解：裁决轮 R1 已在 `__tests__` 浏览器环境实验求证 `?raw` 字符串与同文件 import 的 `render` 解析到同一物理文件且 `render(container)` 可挂载可交互子树（实验脚本已按环境清洁原则清理，记录见裁决记录 R1）；Vite `?raw` 为稳定官方特性；W-06 完成时由 D-09 作为后置门禁复验。
- C-23（自建路由）：风险在于 history API 在 preview 静态服务器下的回退行为。缓解：本机 `node_modules/vite/package.json` 实测 Vite 7.1.1，`vite preview` 默认 `appType: 'spa'`，对未命中的 history 路径回退到 `index.html`（Vite `appType: 'spa'` 行为，见 `node_modules/vite/dist/node/index.js` 的 SPA fallback 中间件），故 `pushState` 路由在 preview 下可直接工作；C-23 已约束 `site/vite.config.ts` 不得覆盖 `appType` 为非 `spa`；部署到 Vercel/Netlify 时配置 SPA rewrite 即可。保证 `popstate` 响应以处理浏览器前进/后退。
- C-12（Google Fonts 依赖）：风险在于构建产物依赖外网字体。缓解：fallback 系统字体栈保证离线可读；字体仅影响视觉不影响功能。
- C-11/C-13（token 命名）：风险在于与库 `src/DOM.ts` 的 `AUTO_ADD_UNIT_ATTR` 等 CSS 处理无冲突——站点 CSS 独立于库的 inline style 处理，无交叉。
- C-29/C-35（事实源）：风险在于文档误用未导出符号。缓解：D-12/D-14 机检脚本对照 `src/index.ts` 导出集。
- C-18/C-47（销毁句柄）：风险在于示例 `render` 不返回销毁句柄或 `<Example>` 不在 `ref(null)` 调用，致 inner `createRoot` 跨导航泄漏（W-06 复开根因）。缓解：D-25 用 headless 客户端导航校验卸载时序，断言 `[data-example-portal]`/`[data-example-root]` 归零；mutation check 已验证 detach 分支被禁用时 D-25 失败。

**验收**：
- 全部完成纪律「每轮必跑」条目（D-01、D-03、D-04、D-06、D-07、D-09、D-11、D-12、D-14、D-15、D-16、D-17、D-18、D-19、D-20、D-23、D-24、D-25）通过。
- 触发式门禁（D-02、D-05、D-08、D-10、D-13、D-21、D-22）按关联声明触发并通过。
- 所有工作项 closed 且挂接证据引用。

---

## 三、入口自检

### 1. 结构检查（机械可检）

- 四小节齐全且字段完整：✅ 进度账本（含 round 计数、工作项列表含全部字段）、完成纪律（每条含 a/b/c/d 四字段）、Backlog、争议项。
- 条款与工作项 ID 唯一且递增：规范性条款 C-01～C-13、C-13a、C-14～C-42、C-43、C-44、C-45、C-46、C-47（C-13a 为 C-13 的拆分档，C-43/C-44/C-45/C-46/C-47 依序追加于 C-42 之后，整体单调递增，ID 唯一不复用）；W-01～W-19 唯一；D-01～D-25 唯一。
- 文档内引用全部可解析：工作项引用 C-xx、D-xx 均存在；追溯矩阵覆盖全部规范性条款（含 C-13a、C-43、C-44、C-45、C-46、C-47）。
- 无重复陈述：每条约束仅在规范性条款处完整陈述一次，工作项/纪律/风险/验收处仅引用条款 ID。
- 追溯矩阵覆盖全部规范性条款：C-01～C-47（含 C-13a）均在矩阵中。✅
- 关键声明均有完成纪律条目覆盖：C-01→D-19/D-06、C-09→D-01/D-02、C-18→D-09/D-25、C-19→D-09、C-20→D-09/D-25、C-27→D-12/D-23、C-29→D-12、C-31→D-09/D-13/D-20/D-24、C-35→D-14、C-42→D-01/D-02/D-09/D-20/D-25、C-43→D-16、C-44→D-01/D-22、C-45→D-01/D-21、C-46→D-01/D-21、C-47→D-25。✅

### 2. 语义自检（按审查维度）

1. **致命设计错误**：方案为「库仓库内新增独立子工程」，不改库 `src/`、不改库构建脚本、tsconfig 天然隔离（库 include 不含 site）；与既有 `axiijs/site` 的关系由 DR-10 明确为替代/继任者，无重复造轮子或长期分叉方向风险。
2. **违背代码职责**：站点是库的消费者，不触及 `createHost`/`LightBindingEffect`/`RxListHost` 等热路径；示例用 axii 正确用法。
3. **违背功能/技术目标**：站点整体用 axii 渲染（C-16）；示例不示范反模式（C-36/C-37）；Shiki 构建期 tokenize 避免运行时重开销（C-43）；站点按 Vite `mode` 注入 `__DEV__`（C-44，dev=true/prod=false）与 data0 条件 alias（C-45）+ `site/package.json` 声明 `data0`（C-46）保证消费 `src/` 不崩溃、production 不带 dev 诊断路径、无 sibling 环境可回退；性能约束继承 AGENTS.md。
4. **违背设计文档规范**：四小节与正文结构齐全；单一事实源；跨轮动因引用裁决记录稳定 ID（`Rj-Fxx` 形态，如 R1-F04、R3-F01、R3-F02），不引用 review finding 编号；无评审叙事。
5. **完成纪律质量缺陷**：门禁命令可复跑——每轮必跑条目（D-01、D-03、D-04、D-06、D-07、D-09、D-11、D-12、D-14、D-15、D-16、D-17、D-18、D-19、D-20、D-23、D-24、D-25）均含 shell 可直接复跑命令；触发式门禁（D-02、D-05、D-08、D-10、D-13、D-21、D-22）的 (b) 均指向 `site/scripts/*.mjs` 固定脚本路径；D-02 已改为 headless 导航 preview 后断言根容器内有真实渲染内容，消除 `curl`-only 的 false-pass；D-07 (b) grep 集覆盖 C-11 全部 6 个配色 token、C-13 间距/圆角/阴影 token 与 Google Fonts 引入，消除「省略 token 或字体引入而门禁仍通过」的覆盖缺口；D-09 收紧为 live 根 `children.length > 0`（非空断言），消除「删除 render 调用」mutation 后空容器冒充通过；D-13 (b) 指定每类 mutation 必须命中的可观测失败类型；D-21 改为通过 `AXII_DATA0_FORCE_NPM` env 触发 npm 回退分支，不得重命名/移动/删除 `../data0` 兄弟目录，消除破坏兄弟 git 仓库的风险；D-23/D-24 枚举 C-27 的 12 类概念与 C-31 的 10 类示例并断言每类至少存在一处，消除「省略概念页/示例页而一致性门禁仍通过」的覆盖缺口（D-12/D-09 只校验已存在内容的一致性/质量，不校验集合完备性）；D-25 用 headless 客户端导航（站点自有 `history.pushState` 路由，非 `page.goto` 全页重载）校验示例卸载时序，断言 `[data-example-portal]` 与 `[data-example-root]` 全归零、`body.children.length===1`，消除「`<Example>` `ref(null)` 未销毁 inner root 致响应式图与 DOM 跨导航泄漏」的 false-pass（W-06 复开根因）；声明类型与门禁匹配（C-18 销毁句柄→D-25 客户端导航卸载、C-20 live demo 卸载清理→D-25、C-23 history 路由→D-10 headless 导航、C-19 同源→D-09 代码块+live 根非空、C-27 概念覆盖→D-23 枚举、C-29 事实源→D-12 对照导出集含正文裸用、C-31 示例覆盖→D-24 枚举、C-35→D-14、C-43→D-16、C-44→D-01/D-22、C-45→D-01/D-21、C-46→D-01/D-21、C-47→D-25）；机检断言载体由 W-17 登记产出（D-20，含 check-preview/check-data0-fallback/check-dev-flag/check-doc-coverage/check-examples-coverage/check-cleanup）。

入口自检通过。
