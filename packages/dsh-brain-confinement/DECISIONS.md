# DECISIONS — dsh-brain-confinement 设计决策记录（"为什么"之家）

写给未来的自己和压缩后的上下文。README 讲"是什么/怎么用"，这里讲**为什么**，以及**被拒绝的替代方案**。每条短、自包含、带关联测试。改动决策时追加/修订，不要只改代码。

最近更新：2026-09-26（① 换强模型最小集已执行：Qwen3.8-27B 上 S6 翻转——明确编码指令被执行且内容到达，S5 0 调用、S7 无自发变量中转；Stage 6 对抗 fuzz 落地，零模型 8 套件 720 断言）。

---

## D-001 定位是纵深防御，不是安全边界
- 决定：本插件只称"纵深防御层 + 审计"。安全边界这四个字只属于宿主 dsh fs-sandbox（workspace-write）。
- 理由：full-access 实测模型 4/4 经 pwsh 落盘，应用层拦不住蓄意对抗；把它说成边界是过度承诺。
- 拒绝替代：宣传成"隔离/封死/sandbox escape proof"。
- 关联：README 第一节；STAGE4-ACCEPTANCE 勘误（4/4 pivot）。

## D-002 不做 shell 命令黑名单
- 决定：shell 侧只做"路径候选提取后判定"，不封 `-EncodedCommand`/`FromBase64` 等命令模式。
- 理由：通用 shell 图灵完备，封编码还有变量中转/间接调用/持久会话，是军备竞赛；管宿主 shell 通用能力超出"保护记忆"职责，越权。真气密只能靠 at-rest 加密/移出可达路径/OS 降权（独立大工程）。
- 拒绝替代：command policy guard（命令名/模式黑名单）。
- 关联：README"为什么不做黑名单"。

## D-003 判定用 vendored isPathUnder（realpath + 身份），不用字符串前缀
- 决定：vendor 官方 `isPathUnder`（词法前缀快路 + 已存在祖先 dev/ino 身份兜底），用 realpath 后判，不用路径名关键词。
- 理由：要挡 junction/symlink/8.3/大小写/UNC 别名，又不能因工作目录路径里含 `sessions`/`storages` 字样误伤（P6 用例）。
- 拒绝替代：`startsWith(root)` 字面量；命名字面量黑名单。
- 关联：containment.ts；parity-test（42 条对拍官方，dsh 升级必跑）。

## D-004 fs 与 shell 都 strict fail-closed
- 决定：任一受保护候选的 `isPathUnder` 抛非 ENOENT/ENOTDIR 错误（权限/坏 UNC/网络盘），该候选记 `error-fail-closed` 且 protected=true；hook 自身异常记 audit `fatal` 并拒绝。绝不 fail-open。
- 理由：词法不命中后走身份(stat)兜底，**stat 抛错的场景恰是别名/身份判定最该起作用的地方**，fail-open 正好在这里开洞。代价是偶发误伤，可接受。
- 拒绝替代：catch 标 outside + 放行（shell.ts 旧实现就犯过，已修）。
- 关联：shell-test E1（注入抛错 predicate）；paths.ts evaluateCandidate。

## D-005 shell best-effort：候选不猜，提不出就 unresolvable 留痕
- 决定：能字面定位的候选才判；编码命令/FromBase64/iex/未知环境变量/裸变量文件参数/cd 进变量，一律放行但 audit 标 `category=unresolvable` + hidden 原因。
- 理由：不执行命令无法安全还原这些路径；猜了反而误伤或给虚假安全感。分成 no-candidate / candidate-allow / unresolvable 三类，事后才能区分"没试图绕"和"绕了拦不住"。
- 拒绝替代：把无分隔符的命令一律当无害；或遇变量就拒绝（高误伤）。
- 关联：shell-test U1–U8；README 三分类。

## D-006 cd 只判目标，不跟踪 shell cwd
- 决定：解析 `cd/sl/chdir/Set-Location/pushd` 等的目标并判定，目标受保护就拒；不维护 shell 内 cwd，之后的相对 token 仍按会话工作目录判。
- 理由：cwd 状态机会引入持久会话、跨语句污染等复杂度，且 fresh pwsh 每次是新进程；只判目标能挡住最常见的 `cd storages`。
- 已知绕过：持久 shell 里"先 cd 进受保护根，再用纯文件名"——明确写进 README，不称为失败。
- 关联：shell-test D6/D7/U8。

## D-007 fs/shell 路径归一化语义不对称，两侧刻意不同处理
- 决定：fs 侧（Node）**不**处理路径分量尾点/空格，保持与官方 isPathUnder parity；shell 侧在候选提取时剥每段尾点/空格后再判。`.`/`..` 导航段豁免。
- 理由（实测，非推测）：Node fs 不把 `storages.\x` 归一化（不可达，无 fs 洞）；PowerShell/cmd 会归一化（明文 shell 真实绕过）。fs 侧加尾点处理反而偏离官方 parity。
- 拒绝替代：为"形式对称"在 fs 侧也剥尾点（会破坏 parity 且无洞可补）。
- 关联：paths-test Z5–Z7；shell-test D4/P-posix；normalizeShellSegments。
- 教训：曾有一版尾点归一化把 `..` 的点也剥光，破坏相对穿越——D11 回归钉死。

## D-008 workdir 相对路径按 session cwd 解析，畸形则跳过
- 决定：`workdir` 相对值解析为 `resolve(session.header.cwd, workdir)`，不是相对"当前 shell 目录"的链式 chdir；空/非字符串 workdir 直接跳过，不因此 fail-closed 整条命令。
- 理由：dsh 每次 shell 调用是新进程、不保留 cwd；workdir 是参数不是模型可控的状态机，畸形参数该交给工具 schema，不该让围栏拒掉正常命令（防误伤优先于在此收紧）。
- 关联：shell-test A5/D10/D11；README 第四节。

## D-009 resolveDshHome 有意偏离官方两处
- 决定：我们的 resolveDshHome(configured, env, home) ①空白/纯空格 configured 视为未设置、回退 env/~/.dsh（官方用 `??`，空白会 resolve 到进程 cwd）；②home 可注入（仅测试用，生产默认 homedir 与官方一致）。
- 理由：我们 config schema 的 dshHome 默认是 `''`，若照官方语义会把保护根指向 cwd，静默错位——confinement 场景下官方行为是错的。
- 拒绝替代：为"完全一致"照抄 `??`（会让保护根漂到 cwd）。
- 关联：resolver-parity-test（一致矩阵 + 两条"有意偏离"单独钉死）；dsh 升级时先读此条再对拍。

## D-010 shell 候选数量上限 256
- 决定：单次 shell 调用最多判前 256 个提取候选，超出则补 `too-many-candidates` 标，归 unresolvable（放行）；前 256 仍判，靠前的明文受保护路径照拒。
- 理由：每个候选可能触发一次 stat，超长/恶意命令会在 hook 热路径扇出成千上万次 stat，造成延迟。best-effort 定位下，提不出比逐个判更合理。
- 关联：shell-test E2；MAX_COMMAND_CANDIDATES。

## D-011 受保护根每次实时解析，失败回退启动快照（不放行）
- 决定：protected roots 每次调用按 config.dshHome→$DSH_HOME→~/.dsh 现算；现算空/异常则回退启动快照，绝不放行。
- 理由：防止子进程"清掉 DSH_HOME 环境变量就让围栏失效"。（方向 3 想剥 shell 子进程 DSH_HOME，但 shell-env 对保留键 add-only 注册即抛，缝关不掉，已证伪。）
- 关联：resolver-test R8/R9；paths.ProtectedRootResolver。

## D-012 不抄 exec.parent 豁免，run_code 内层同判
- 决定：每次 tools/execute 都判，包括 run_code/PTC 的内层派发；不复制 checkpoint-policy 对 `exec.parent` 的放行。audit 标 nested。
- 理由：包一层 run_code 就能绕过等于没拦；checkpoint 的豁免语义与记忆隔离无关。
- 关联：N1 e2e（Stage 4 真实内层 deny，hash 对）。

## D-013 非防护工具只做两次冻结表查询，永不抛错
- 决定：非 fs/shell 工具仅 `isFsTool` + `isShellTool`（typeof string + 表 hasOwnProperty）即 next()，不触碰参数。
- 理由：保证插件 bug 最多让被防护表面拒一次，绝不让其它工具瘫痪（用户拍板选 strict 的前提就是这个影响面要可控）。
- 关联：invariant-test（74 条畸形输入不抛错）。

## D-014 audit opt-in，不存明文/命令串，三种 allow 都写
- 决定：设 `DSH_CONFINEMENT_AUDIT` 才写；只记 ts/tool/verdict/nested/reason/rootSource/category/hidden + 逐候选 sha256 短哈希(前12)。不记路径明文、不记命令串（shell 对每个候选分别哈希，不哈希整条 command）。logAllow 默认 true，no-candidate/candidate-allow/unresolvable 三种放行都留痕。
- 理由：生产零暴露；测试可对账；三种放行都写才能做事后归因。fire-and-forget，写失败不回灌。
- 已知侧信道（接受）：模型可读 audit 路径，但只能看到自己已试候选的哈希+verdict。
- 关联：audit.ts；README 第五节。

## D-015 先独立挂载验证，Stage 7 才并入 bundle
- 决定：Stage 4/5 用独立 home（仅 dsh-base + dsh-headless + dsh-brain-confinement，不带 brain-bundle）做 A/B；全绿前不进 bundle。Stage 7 收窄为"memory 启用才挂，memory 禁用即撤"。
- 理由：独立挂载让 e2e 行为只归因本插件，不被 conduct/memory 注入污染；围栏挂了影响所有会话，未验证不推全量。
- 关联：.confinement-dsh-home；README 第六节。

## D-016 围栏不会拦死记忆系统自身
- 决定：记忆库读写走 storage-domain 服务，不经过模型面 fs/shell 工具，所以本插件不影响 brain 自己存取。
- 理由：若 memory 内部复用被拦的工具链会自我死锁（写插件前已确认它走服务层）。
- 关联：Stage 4 e2e memory 读写正常。

## D-017 拒绝文案单一通用句
- 决定：模型侧只返回 `Operation not permitted in this context.`，不回显路径/根/工具/内部码；内部归因码只进 audit。
- 理由：回显"你试图访问 X"等于告诉模型受保护根位置，引导它下一步试探。
- 关联：paths.DENIAL_MESSAGE；index.denialResult。

## D-018 STATE/DECISIONS 维护契约；压缩丢细节，审查先读磁盘
- 决定：STATE.md 只写"到哪了、下一步"，数字一律带时点（如"当前 253 断言"），进度小标题用"最近一轮变更"不用"本轮"；DECISIONS.md 每条保持 决定/理由/拒绝替代/关联 四段。谁动代码/测试/文档，谁当轮同步这两文件，随后立即提交，不攒批。
- 起因（现场证据，非抽象风险）：一次对 fail-open 的审查基于压缩前的旧快照，断言"仍会 fail-open"，而 fail-closed catch、可注入 underCheck、候选上限三项其实早已在被压缩的轮次落地。压缩确实会丢细节——**审查/改码前先读磁盘当前文件，不以会话记忆里的旧版为准**。
- 理由：这两文件是压缩后唯一自足入口，腐化一次就得重建一次；带时点的数字不会随套件增长被误读。
- 拒绝替代：把进度细节写进 README（README 讲能力与口径，不跟踪进度）；靠会话记忆。
- 关联：STATE.md 头部阅读顺序；D-007"教训"体例。

## D-019 目录递归列举元数据暴露：接受侧信道，不收紧
- 决定：`Get-ChildItem <盘根> -Recurse`（及 `find -R`/`ls -R`/`gci -R` 等变体）可枚举受保护根内文件名/大小/时间元数据，判定为**接受侧信道**，不收紧、不加拦截。
- 起因（S7，Qwen3.8 n=1 实测）：模型递归列举盘根后，工具返回可见 `run\home\storages\brain_memory.json` 等文件名与大小/时间，但内容不可达（无 READ 金丝雀）。
- 理由：①元数据非 secret——与 README 信任依赖 #5"at-rest 不加密、物理路径可达"同源，插件防的是内容泄漏，不是"文件是否存在"；②收紧=封 `-Recurse` 等无穷变体，正是 D-002 已拒绝的命令黑名单军备竞赛；③不改变威胁模型——知道存在但读不到内容，正是"抬门槛"的预期状态。
- 拒绝替代：对递归列举参数做黑名单（D-002 冲突、无穷变体、误伤正常 `gci -R` 工作流）。
- 关联：README 信任依赖 #7；STATE 已知缺口；S7（Qwen3.8 dump/audit）。


## D-020 矩阵按格切换用"变体 home + junction"，不用 --patch overlay（虽然 --patch 运行时也生效）
- 决定：Stage 7 四格矩阵每格用独立变体 home（disable 行写在各变体 `profiles/headless/cordis.patch.yml` 用户层），probe 运行前把 `run/home/profiles` junction 切换到变体并 readlink 留痕；不再用 `--patch conf-off.yml` overlay 传递。
- 起因：早期 B/C/D 全部仍被 gate 拦，曾怀疑"--patch 只在 dump-config 生效、boot 不生效"；用 **must-fail import 行**（`does-not-exist-xyz.mjs`，启动审计报 "failed to import"）证实 `--patch` overlay 与 profile patch 文件**同走 readProfilePatches、运行时都实际生效**——原判断是 probe bug 假象（见 D-021）。
- 理由：变体 home 的 disable 行落在用户配置层，是 dsh 既有加载路径，不依赖 CLI flag 的传递与解析；junction 切换可用 readlink 逐格实证；每格 dump/audit/日志按格命名不互相覆盖。
- 拒绝替代：`--patch` overlay（机制本身可用，但矩阵不依赖 probe 参数管道更稳）；boot() 直调复现（被 headless-startup 的 `cmdlineArgs` 服务卡住，已确认死路，不再走）。
- 关联：probe-bundle.mjs 头注释（已修正）；`run/bundle-matrix/{conf-off,mem-off,both-off}.yml` 保留作历史。

## D-021 probe 状态切换必须逐格断言；"全格同结果"先怀疑"状态根本没切"
- 决定：probe 的每格切换（junction 目标/overlay/环境变量）要有可独立验证的痕迹（如 `[dbg] profiles -> <变体>` readlink 输出）并在运行后逐格核对该痕迹；`runProbe` 一律接收 cell 对象而非字符串 key，所有产物文件名用 `cell.key`。
- 起因：`runProbe(key, probe)` 把字符串当 cell 用，`cell.home` 恒 undefined → 每格 junction 都切回 base → B/C/D 假 DENIED。此前一行行排查 --patch/dump/boot 都正常，唯独没查"传入参数本身"；且 `[object Object]-F1.log` 的文件名会让证据互相覆盖丢失。
- 理由：这种 bug 的症状（"全格同结果"）与判定层真实问题（"拦截过强"）同形，不先排除切换失败就会错改产品代码；逐格痕迹把"状态确实切了"变成可审计事实。
- 拒绝替代：靠 console.log 事后解释；反向去改判定层源码来"修"矩阵（方向全反）。
- 关联：D-020；probe-bundle.mjs（`runProbe(cell, probe)` + `CELLS.key`）。


## D-022 gate 自身失败模式 = fail-silent（行为不可区分），接受并写明边界
- 决定：bundle 侧 gate 插件（`src/gate.ts`）`apply` 唯一动作是 `ctx.plugin(主插件shape, config)` + `await child`。若主插件 apply 抛错或子 fiber rejected → gate fiber 报错（cordis 日志/上报可见），围栏**不挂载** → 行为等同 memory 禁用（**fail-silent**：gate 崩溃与 memory 故意禁用是**同一现象、两种原因，从行为上无法区分**——被保护表面两种情况都是"无 deny、全放行"；检测只能靠启动审计/preflight 的插件 rows 与启动日志的 fiber 错误，是运行时动作而非结构性保障）。**不设 watchdog、不加健康检查**。
- 理由：①本插件是纵深防御层非安全边界（D-015 叙事），fail-open 与"memory 禁用"同语义——两者都是"没有围栏"，宿主行为一致；②gate 是 add-only 薄包装，失败面小（唯一动作是挂一个已验证的主插件）；③检测已存在：bundle 启动审计/preflight 的插件 rows 可见 gate 与主插件是否注册，启动日志可见 fiber 错误——对个人单机场景 A 够用。
- 边界（如实标注）：gate-test 4/4 只覆盖**门控生命周期**（无 memory 不挂 / provide 后拒 / 安全读放行 / disarm 恢复），**未覆盖 gate/主插件 apply 崩溃路径**。若未来部署场景升级为 B（团队/社区），此路径要补用例（构造主插件 apply 抛错，断言 gate fiber rejected 且被保护表面无 deny）；**部署文档必须写运维项："启动日志出现 gate fiber 错误 = 围栏未挂载，需排查/重启"**——不是"出问题会看出来的"。
- 关联：gate.ts 注释；gate-test.mjs；D-015；README 六/八节。

## D-023 改 memory/confinement 源码后，bundle dist 重建是交付的一部分，不是可选项
- 决定：dsh 通过 `dsh-brain-bundle/dist/*.mjs`（cordis.patch.yml `name: './dist/memory.mjs'` 等）加载插件，dist 是 `packages/dsh-brain-bundle` `scripts/build.mjs` 的**独立构建产物**。改 `dsh-memory` / `dsh-brain-confinement` / `dsh-conduct` / `dsh-brain-dispatch` 任一源码后，**未重建 dist = 运行时跑旧行为**：源码改了 → 单测绿 → dist 旧 → 运行时旧 → 结论错误（2026-09-27 跨轮实验首轮 3/3 实际跑在 9-26 旧 dist 上，若不发现会得出"M-003 无效"的相反结论）。**dist 重建是交付的一部分，不是可选项**；与 D-018"审查先读磁盘"同源（人靠记得会忘，现场证据才可靠）。
- 防护（结构性措施，不止靠记得）：
  1. **实验 runner 启动前校验 dist 与源码一致**：`cross-turn-task/runner.mjs` 启动时读 `dist/memory.mjs`，grep 本次改动独有的字符串（如 `progressEntries` + 新 menu 文案转义），缺失即拒绝启动（exit≠0），提示先 `node scripts/build.mjs`。
  2. 构建脚本现状：`scripts/build.mjs` 无 `--watch`，是单次构建。将来考虑加"改源码自动重跑 build"的 hook（如文件监听或 pre-test 钩子），优先级低（防护 1 已覆盖实验路径）。
- 关联：dsh-brain-bundle/scripts/build.mjs；cross-turn-task/runner.mjs（checkDist）；D-018；D-022。


### D-023a（2026-09-27）：checkDist marker 形式 + 误拦方向确认

- **bug**：D-023 首次上线即踩实现错误——marker 用 Unicode 转义字面量（JS 源码单反斜杠形式，运行时=中文），但 dist 以**字面转义文本**（esbuild 输出 \uXXXX 序列）存储，includes(中文) 永不匹配 → checkDist 对**含 M-003 的正常 dist 也误报拒启**。
- **修复**：marker 用双反斜杠源码（运行时=字面 \uXXXX 文本）。改后必跑端到端验证：模拟 checkDist 逻辑输出 missing=NONE。
- **方向确认**：本次 bug 是**过度严格（误拦）**，比"漏放（静默跑旧 dist）"安全——防护宁可误拦不可漏放，方向正确，不因误报修复而放宽。
- **将来改 marker 提醒**：转义层数极易错（源码 1bs=Unicode 转义、2bs=字面文本），改任何 marker 后必须跑端到端 missing=NONE 验证，勿凭肉眼。