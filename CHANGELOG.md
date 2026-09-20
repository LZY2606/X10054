# Changelog

## Unreleased — 隔离纯 AST 套件与外部 dot adapter 的可复现验证

### 背景

ts-graphviz monorepo 同时包含纯 TypeScript 包（`@ts-graphviz/ast`、`@ts-graphviz/core`、`@ts-graphviz/common`）
和会 spawn 本机 `dot` 进程的 `@ts-graphviz/adapter`。此前根级 `pnpm test` 把两者混在一起：
没有安装 Graphviz 的机器上，adapter 及 `media/` 快照测试的环境性失败会掩盖核心包的真实退化。

### 实现选择

- **单一离线入口 `corepack pnpm verify:core`**（`scripts/verify/core.mjs`），本地与 CI 执行完全相同的命令
  （`.github/workflows/.verify-core.yaml`）。四个阶段按序执行，任一子命令失败即以子命令退出码中止：
  1. **codegen 新鲜度**（`scripts/verify/codegen-fresh.mjs`）：对 gitignore 的生成物
     `_parse.js` / `_parse.d.ts` 先取 sha256、重跑包自身的 `codegen` 脚本（参数唯一来源）、再比对。
     已存在但不一致的生成物判定为陈旧，拒绝整个运行并打印前后哈希；缺失则生成后继续。
  2. **构建核心闭包**：`vite build` + `vite-plugin-dts`，实际演练类型生成（`lib/*.d.ts`）。
  3. **exports 完整性**（`scripts/verify/lib/exports-check.mjs`）：展开 `exports` 与构建后的
     `publishConfig.exports` 的全部条件链，每个叶子路径必须解析到真实文件，违规携带
     包名 / subpath / 条件链 / 缺失路径上下文。
  4. **包级测试**：`corepack pnpm --filter @ts-graphviz/ast --filter @ts-graphviz/core
     --filter @ts-graphviz/common test`，与验收命令逐字一致。运行前先断言每个核心包
     都声明了 `test` 脚本——pnpm 会静默跳过没有该脚本的包，摘要上与全绿无法区分。
- **adapter 为显式可选阶段** `corepack pnpm verify:adapter`（`scripts/verify/adapter.mjs`）：
  探测到 `dot` 才运行 adapter 套件，否则明确报告 SKIPPED 并以 0 退出；永不混入核心阶段。
- **每个核心包获得独立 `test` 脚本与 `vitest.config.ts`**：显式 `include` + `passWithNoTests: false`，
  零收集即失败；`@ts-graphviz/ast` 以 `pretest` 保证解析器生成物存在，过滤命令在干净检出上自足。
- **不引入**随机 sleep、真实外网访问、本机绝对路径或 fixture 名称特判：fixture 通过扫描
  `test/dot/*.dot` 目录发现，路径全部从 `import.meta.url` 相对推导。

### 新增验收用例（每个都可单独定位，且各自反证一条设计假设）

- `packages/ast/src/dot-shim/parse-print-parse.test.ts`：对仓库内全部 DOT fixture 做
  parse-print-parse。反证“打印器输出一定能重新解析为等价 AST”。注释属于非语义 trivia，
  打印器会把相邻注释行合并为单个块，因此比较前对相邻 Comment 节点做归并、剥离 `location`，
  注释内容仍逐字比较；另断言打印不动点 `stringify(parse(printed)) === printed`。
- `packages/ast/src/dot-shim/parser/generated-parser.test.ts`：反证“类型生成是解析器产物契约的一部分”。
  `_parse.d.ts` 必须存在、声明 `parse` 入口，且运行时导出（`parse`、`SyntaxError`）与类型一致；
  从 codegen 命令中去掉 `--dts` 会立刻在此失败。
- `packages/common/tests/no-external-process.test.ts`：反证“核心闭包永远 hermetic”。
  静态扫描三个核心包的 `src/**`，出现 `child_process` / `execa` / `node:http(s)` / `fetch(` 等
  进程或网络原语即失败，并给出文件与行号。
- `packages/{ast,core,common}` 各自的 `package-exports.test.ts`：反证“exports 永远指向真实文件”，
  与 verify 第三阶段共用同一实现（`scripts/verify/lib/exports-check.mjs`），任一包独立失败。

### 原覆盖的空白

- 根套件只做单向快照（`test/real-world.test.ts` 的 parse→snapshot），从未验证打印输出的可重解析性；
  打印器回归可以绕过全部快照。
- 生成物 `_parse.js` / `_parse.d.ts` 被 gitignore 且由 CI 构件传递，没有任何机制拒绝陈旧产物。
- 包级 `exports` 指向不存在文件时，只有消费者安装后才会暴露，仓库内无任何检查。
- “核心包不 spawn 进程、不访问网络”此前只是口头约定，adapter 的 `dot` 依赖随时可能渗入核心包。
- 包没有自己的 `test` 脚本，无法在不触发 adapter 的前提下单独运行核心闭包。

### 相邻语义的退化保护

- 根级 `pnpm test`、`pnpm build`、`pnpm codegen` 行为不变；新增脚本均为纯增量。
- ast 的 model-shim 测试依赖下游 `@ts-graphviz/core`（core 依赖 ast，反向不成立），
  根套件靠 tsconfig paths 掩盖了这一点。隔离运行在 `packages/ast/vitest.config.ts` 中用显式
  `resolve.alias` 指向 workspace 源码，而不是在 package.json 里声明循环依赖。
- 注释归并只发生在测试的归一化函数中，parser/printer 行为本身未改动。
- 根套件中 `media/media-snapshot.test.ts` 在无 `dot` 环境下的 5 个失败为既有环境依赖，
  正是本入口要隔离的对象，未做掩盖或跳过。

### 最危险反例与对应回归用例

- **TypeScript monorepo**：`packages/ast` 的 model-shim 测试 import 了下游包 `@ts-graphviz/core`，
  在根 tsconfig paths 下一切正常，一旦按包隔离安装/运行即 `Cannot find package`——依赖方向被
  测试静默反转是最危险的形态，因为它不破坏任何现有 CI。回归用例：三包各自的 `test` 脚本 +
  显式 `include` 的包级 vitest 配置，隔离运行必须零收集失败、全量通过。
- **外部工具隔离**：核心包若引入一次 `child_process`（哪怕只是“检测 dot 是否存在”），
  离线可复现性即告破产，且失败只出现在没有 Graphviz 的机器上。回归用例：
  `packages/common/tests/no-external-process.test.ts` 的静态守卫，把 hermetic 约定变成硬失败。
- **包导出**：`exports` 的条件链（如 adapter 的 `browser`/`deno`/`default`）中任何一个叶子指向
  被重命名的文件，单元测试全部通过而消费者解析失败。回归用例：各包 `package-exports.test.ts`
  与 verify 第三阶段，逐条件链校验每个叶子路径真实存在（含构建后的 `publishConfig.exports`）。
