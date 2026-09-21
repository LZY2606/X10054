# Changelog — 纯 AST 套件与外部 dot adapter 的隔离可复现验证

## 概述

本次变更为 monorepo 增加一条**离线、可复现、本地与 CI 完全同命令**的核心验证入口，
只覆盖纯 TypeScript 依赖闭包 `@ts-graphviz/common → @ts-graphviz/ast → @ts-graphviz/core`，
并把会 spawn 本机 `dot` 的 `@ts-graphviz/adapter` 拆成**显式可选阶段**单独报告。

入口命令（本地与 CI 同一条，无子命令特判）：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @ts-graphviz/ast --filter @ts-graphviz/core --filter @ts-graphviz/common test
```

adapter 可选阶段：`corepack pnpm verify:adapter`
（单元测试必跑；本机/CI 没有 `dot` 时，真实冒烟**显式 SKIP 并带诊断**，不伪装成功也不污染核心结果）。

## 实现选择

### 1. 一个包一个 verifier，阶段顺序固定且失败即终止

- 每个纯包新增 `test` 脚本，统一调用 `tools/verify/package.mjs packages/<pkg>`。
- 阶段顺序：**codegen 新鲜度 → 干净构建 → 类型生成物消费检查 → 隔离 vitest（带覆盖率）→ 覆盖率门禁**。
- 所有子进程通过 `spawnSync(execPath, [bin, ...args], { stdio: 'inherit' })` 运行，
  非零退出立即以 `[stage]` 标签失败并保留完整命令与 cwd，**子命令失败必传递**；没有随机 sleep/重试。
- 工具二进制（peggy/vite/vitest/tsc）通过 `package.json` 的 `bin` 字段解析，不依赖 `PATH`，
  不使用本机绝对路径，安装内容全部来自 `--frozen-lockfile`。

### 2. codegen 新鲜度门禁（拒绝陈旧/脏生成物）

`packages/ast/src/dot-shim/parser/_parse.{js,d.ts}` 是 peggy 生成物（被目录内 `.gitignore`
忽略，CI 以前靠 codegen job 的 artifact 传递）。`tools/verify/codegen-check.mjs`：

- 读取 `package.json` 中**唯一**的 `codegen` 脚本（single source of truth，不复制参数），
  把 `-o` 重定向到临时目录重新生成，逐字节比对已存在的产物；
- 产物缺失（fresh checkout）→ 自动播种并继续；
- 产物存在但与全新生成不一致（陈旧/手工篡改）→ 立即失败，诊断给出 grammar 路径与应执行的命令；
- 经验证 peggy 5.0.6 对同一 grammar 的输出字节确定（连续两次生成 `diff` 为空）。

### 3. 类型生成物（typegen）验证

`tools/verify/typegen-check.mjs` 在 `vite build` 后，根据每个包的
`publishConfig.exports`：

- 校验每个 `types` 条件指向的 `.d.ts` 存在、非空且确为声明文件；
- 校验每个 runtime 条件指向的构建产物存在且非空（**exports 指向不存在文件即失败**）；
- 合成一个消费者工程（Node16 模块解析、`strict`、`skipLibCheck:false`），
  从每个运行时子路径 `import * as`，用根依赖的 `tsc --noEmit` 真正编译，
  证明 vite-plugin-dts 的 rollup 声明对外部消费者可用，而不是“文件在那里”。

### 4. 运行时隔离（核心阶段绝不能 spawn dot / 联网）

- `tools/verify/isolation-tripwire.mjs` 作为共享 setupFiles 注入：
  - 覆盖 `node:child_process` 的 `spawn/spawnSync/exec*/fork`；
  - 同步变体直接走内部 binding，因此额外拦截 `process.binding('spawn_sync').spawn`（fail-closed）；
  - 覆盖 `net.connect/createConnection`、`http(s).request/get` 与全局 `fetch`。
- `tools/verify/isolation-suite.ts` 是该 tripwire 的**回归用例**（每个纯包各一份），
  断言 spawn/fetch 被拒绝且错误含可诊断的 `isolation-tripwire` 上下文。
- 另有静态扫描（`contracts-helpers.ts#assertSourceIsPure`）扫描各包 `src`（排除
  `.test/.spec/.d.ts`，含 `.peggy`），禁止 `@ts-graphviz/adapter`、`node:child_process`、
  `node:net/http/https/dgram/dns` 的 import/require；扫描结果若为空集（零文件）也会失败。

### 5. 零收集门禁与覆盖率底线

`tools/verify/coverage-gate.mjs` 读取 vitest 的 `coverage-summary.json`：

- 报告缺失 / 列不出源文件 / 整包被执行语句数为 0 → 明确报“zero collection”失败
  （反制“测试跑了但没碰到包代码”的静默绿）；
- 整包语句覆盖率低于下限失败：ast 65%、common 75%、core 90%
  （基于现状基线 76.88% / 80% / 96.35%，留出小幅波动空间但能抓住实质退化）；
- 不对**单个**纯类型/re-export 文件（如 common 的 `types.ts`、`attribute.ts`）设零门槛，
  它们的正确性由 typegen 消费检查结构性保证，逐文件零会是误报。

### 6. parse-print-parse 内部 fixture 套件

`packages/ast/verify/parse-print-parse.test.ts` 通过**目录枚举**发现
`packages/ast/verify/fixtures/*.dot`（无 fixture 名称特判，新增文件即自动纳入）：

- 属性：`parse(dot)` 与 `parse(stringify(parse(dot)))` 在剔除 parser 的 `location`
  簿记字段后深等价；二次打印与一次打印完全一致（printer 不动点）；
- 每个 fixture 反证一类打印危险：语句边、边组、cluster 子图、HTML-like label、
  转义/引号、strict 与默认属性表、compass 端口、空图；
- 单独固定转义保真（`\n \t \" \\` 与分号入串）。

相邻语义退化保护：`packages/ast/verify/adjacent-semantics.test.ts`
固定 AST ↔ OO model 边界（`toModel/fromModel` 往返、directed 位）与
非法 DOT 必须抛出带 `name=DotSyntaxError` 与 parser `cause` 的命名错误。

### 7. 合同测试与单用例可定位

- `packages/{ast,core,common}/verify/package-contract.test.ts`：
  workspace `exports`（指向 `src`）与 `publishConfig.exports`（指向构建 `lib`）
  两套目标都必须存在；`types` 条件必须落到非空 `.d.ts`。
- 新用例全部为常规 vitest 文件，可单独定位，例如：
  `vitest run packages/ast/verify/parse-print-parse.test.ts -t 03-subgraph-cluster`，
  然后再跑完整的三包过滤命令。

### 8. CI 收敛

- 新增可复用 workflow `.github/workflows/.core-verify.yaml`：
  不下载 codegen artifact、不安装 Graphviz，只跑同一条 install + 三包 test 命令；
  harden-runner 对测试运行采用默认出站策略，真正的不联网保证由包内 tripwire 在进程内执行
  （install 的网络仅发生在安装步骤，测试阶段不产生外连）。
- `.github/workflows/.adapter-verify.yaml` 单独运行 adapter 阶段并如实报告 dot 冒烟可用性；
  `main.yaml` 增加 `core_verify`（release 门禁之一）与 `adapter_verify`（独立、可选、单独报告）。

## 原覆盖的空白

1. **三包此前没有包级 `test` 脚本**：根 `pnpm test` 把 adapter（spawn dot 语义）、
   react（jsdom）、聚合包与纯包混在一次 vitest 里，环境缺 dot 与核心退化无法区分。
2. **生成物新鲜度无校验**：`_parse.js/.d.ts` 不在版本库，陈旧产物或漏跑 codegen 不会被任何门禁发现。
3. **发布形态的 exports 从未被验证**：`publishConfig.exports` 指向的 `lib/*`
   与 vite 实际产物之间没有一致性检查，重命名入口后只有发布后才会暴露。
4. **类型生成物没有消费者视角验证**：构建成功不代表 rollup 后的 `.d.ts` 可被下游 strict 工程编译。
5. **“假绿”没有防线**：没有覆盖率报告或测试零收集时旧流程不会失败。
6. **纯闭包没有外部隔离约束**：没有任何测试阻止 core/ast/common 未来 import adapter 或 child_process。
7. **parse-print-parse 缺属性级保证**：旧用例多为单向快照，不检验 printer 对 parser 的可逆性与不动点性。

## 最危险反例与对应回归用例

| # | 最危险反例（设计假设被推翻的方式） | 直接抓住它的回归/门禁 |
|---|----------------------------------|----------------------|
| 1 | 核心 parse/print 链路偷偷 `spawn('dot')`：本地有 Graphviz 时一切“通过”，CI/他人机器却挂或结果取决于本机版本 | `isolation-tripwire.mjs`（含 `spawn_sync` binding 拦截）+ 每包 `isolation.test.ts`；纯包 `src` 静态 import 扫描合同测试 |
| 2 | 测试阶段外网被调用（静默下载/遥测/时间相关脆弱性） | tripwire 对 `net/http/https/fetch` 的运行时拦截 + `isolation.test.ts` 断言 |
| 3 | 改了 `dot.peggy` 但 `_parse.js/.d.ts` 未重新生成（陈旧产物进流程） | `codegen-check.mjs` 字节比对（实测篡改后 exit 1） |
| 4 | 发布的 `exports`/`types` 指向构建里不存在或为空的文件，发布即崩 | `typegen-check.mjs` + 每包 `package-contract.test.ts`（dev/publish 两套） |
| 5 | 测试存在但根本没 import 包代码（零收集假绿） | `coverage-gate.mjs` 缺报告/零执行语句失败（实测合成零报告 exit 1） |
| 6 | 子命令（build/tsc/vitest）失败被吞，外层仍报成功 | `run.mjs#spawnFileSync` 非零即以带 stage/cwd 的错误终止，pnpm 递归首个失败即非零（实测传递） |
| 7 | printer 对 parser 不可逆（转义丢失、边组/cluster/端口变形、迭代打印漂移） | `parse-print-parse.test.ts` 八个 fixture + 不动点断言 + 转义逐字断言 |

## 受影响文件

- 新增：`tools/verify/`（`run.mjs`、`package.mjs`、`codegen-check.mjs`、
  `typegen-check.mjs`、`coverage-gate.mjs`、`isolation-tripwire.mjs`、
  `isolation-suite.ts`、`contracts-helpers.ts`、`package-contract-suite.ts`、
  `vitest.verify.config.ts`、`vitest.adapter.config.ts`、`adapter.mjs`）。
- 新增：`packages/{ast,core,common}/verify/` 合同/隔离测试，
  及 `packages/ast/verify/fixtures/*.dot` 与 `packages/adapter/verify-smoke.mjs`。
- 修改：三个纯包与 adapter 的 `package.json`（`test` 脚本；ast 增加
  `@ts-graphviz/core` 为 devDependency 以显式表达其测试依赖）、根 `package.json`
  （`verify:core` / `verify:adapter` 便捷别名）、`pnpm-lock.yaml`、`.gitignore`、
  `.github/workflows/`（新增两个可复用 workflow 并接入 `main.yaml`）。
