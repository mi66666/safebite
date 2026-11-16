# SafeBite — 测试记录表（真机部分需你填写）

> 用途：评分表「Testing and Debugging (20%)」要求**有测试证据**。本文件分三部分：
> A 部分是已自动完成的（可直接引用），B 部分需要你在安卓手机上跑一遍并记录，C 部分是缺陷清单。

---

## A. 自动化测试证据（已完成，可直接写进报告/答辩）

### A1. 单元测试 —— 36 项全部通过

运行：`npm test`（`node --test "tests/*.test.mjs"`）

| 覆盖范围 | 用例数 | 内容 |
| --- | --- | --- |
| 条码校验位 | 6 | EAN-13 真实商品向量（Nutella / Coca-Cola）、UPC-A 补零、校验位错误必须拒绝、非法长度与非数字、空输入 |
| 过敏原比对 | 14 | 声明过敏原→danger、坚果别名映射（`en:hazelnuts`→tree nuts）、traces→caution、无匹配→safe、无数据→unknown、自定义关键词命中、vegan 冲突、输入为 null 不崩溃；**配料文本兜底** 6 项：漏填标签但配料写 milk→caution、已声明优先于文本证据、椰奶/燕麦奶/豆奶/杏仁奶/米奶/腰果奶不算乳、可可脂与 shea butter 不算乳、"milk-free" 不误报、小麦粉→gluten 而米粉不算 |
| 展示与文案 | 3 | Nutri-Score 分级与兜底、NOVA 描述、过敏原标签人性化（长列表折叠） |
| 语音播报 | 2 | 生成可朗读整句（含 Warning / Contains / May contain）；文本兜底时的播报措辞 |
| 加密与安全 | 11 | Base64 往返、同盐同密码派生一致、异盐/异密码派生不同、档案加解密往返、密文不含明文、错误密钥拒绝解密、密文篡改被 AES-GCM 拒绝、恒定时间比较、密码规则 |

### A2. 端到端自动化 —— 16 项全部通过

运行：`node tools/cdp-check.mjs 5173 shots`（Chrome DevTools Protocol，390×844 手机视口）

| # | 检查项 | 结果 |
| --- | --- | --- |
| 1 | 登录页正常渲染 | PASS |
| 2 | 注册账号并进入扫码页 | PASS |
| 3 | 档案勾选生效（Milk / Tree nuts / Peanuts / Vegan） | PASS |
| 4 | 档案加密保存落库 | PASS |
| 5 | 真实 Open Food Facts 查询 + 结论渲染（Nutella → Avoid: Milk, Tree nuts） | PASS |
| 6 | 底部导航不遮挡内容（几何检测） | PASS |
| 7 | 扫码写入历史 | PASS |
| 8 | Service Worker 注册并激活 | PASS |
| 9 | 字号缩放（140% → 22.4px）与高对比模式生效 | PASS |
| 10 | 非法校验位条码有明确提示 | PASS |
| 11 | **断网后 app 外壳仍可打开**（SW 缓存） | PASS |
| 12 | **离线可查看已保存商品**（IndexedDB 缓存） | PASS |
| 13 | **离线查未保存商品有明确提示**（不伪造结论） | PASS |
| 14 | **漏填过敏原声明时用配料文本兜底**（合成条目：无 allergens_tags，配料含 milk powder）→ Caution + “Ingredient list mentions” | PASS |
| 15 | **设备自检页**报告条码/离线能力（12 行状态） | PASS |
| 16 | 无 console 异常 | PASS |

截图证据：`F:\dsh\tmp\shots\`（11 张，含高对比模式与离线态）

### A3. 无障碍自动审计 —— 18 次页面审计，0 违规

运行：`npm run a11y`（产物：`docs/Accessibility_Audit.md` + `docs/a11y-audit.json`）

| 检查项 | 标准 | 结果 |
| --- | --- | --- |
| 触控目标尺寸 | ≥ 44×44 px（WCAG 2.2 SC 2.5.8 要求 24px，本项目自设 44px） | 0 违规 |
| 可访问名称 | 每个按钮/链接/输入/开关都能解析出名称 | 0 违规 |
| 图片替代文本 | 每个 `<img>` 都有 alt | 0 违规 |
| 标题层级 | 不跳级 | 0 违规 |
| 页面结构 | `<main>`、`<h1>`、命名的 `<nav>`、`aria-live`、lang、title | 0 违规 |
| 文字对比度 | 普通文本 4.5:1／大字 3:1（对合成后的实际背景计算） | 0 违规 |
| 横向溢出 | 100% 与 160% 字号下都不出现横向滚动 | 0 违规 |

覆盖 4 种显示状态（**浅色、深色、高对比、160% 字号**）× 6 个页面（含设备自检页）。

**审计器自检（关键）**：一个永远报 0 违规的审计器毫无价值，因此注入了 5 类已知缺陷
（20×20 按钮、只有 `aria-hidden` 内容的按钮、无 alt 的 img、跳级标题、1.15:1 对比度文本），
审计器**5/5 全部检出**。第一次跑自检时只检出 4/5 —— 漏检的是"只有 `aria-hidden` 内容的按钮"，
因为名称计算误用了 `textContent`；修正为只统计未被 `aria-hidden` 隐藏的后代文本后通过。

### A4. 性能测量 —— 4× CPU 降速 + Fast 3G 弱网

运行：`npm run perf`（产物：`docs/Performance_Report.md`）

| 指标 | 冷启动（无缓存、无 SW） | 暖启动（Service Worker 已接管） |
| --- | --- | --- |
| TTFB | 151 ms | **3 ms** |
| 首次内容绘制 (FCP) | 1264 ms | **72 ms** |
| DOMContentLoaded | 1153 ms | **47 ms** |
| 请求数 | 14 | 14 |
| 传输字节 | 119 KB | **0 KB** |
| DOM 节点数 | 35 | 35 |
| JS 堆 | 1.51 MB | 1.86 MB |

结论：外壳被 Service Worker 预缓存后，首屏从 1.26 秒降到 **72 毫秒且零网络传输**——这就是
"商场地下室/弱网现场也能秒开"的技术依据。测量方法写进了报告，并附一条诚实的局限：
PBKDF2 派生（21 万次迭代）跑在主线程，在降速手机上约需数百毫秒。

### A5. 静态一致性校验 + CI —— 0 问题

运行：`npm run verify`（= `tools/verify-static.mjs` + 全部单元测试）

| 校验项 | 结果 |
| --- | --- |
| Service Worker 预缓存清单里的每个文件都真实存在 | 17 项全部存在 |
| `js/` 下每个模块都被预缓存（否则离线缺文件白屏） | 10/10 覆盖 |
| `manifest.json` 必填字段、图标存在、`start_url` 为相对路径、含 maskable 图标 | 通过 |
| `index.html` 引用 manifest 与 app.js、`lang` 属性、`viewport-fit=cover` | 通过 |
| 全部 JS 语法可解析 | 22 个文件，0 失败 |

**校验器自检**：故意移走 `icons/icon-512.png` → 正确报出 2 个问题（预缓存缺失 + manifest 图标不存在）；
故意从 `sw.js` 预缓存清单删掉 `js/voice.js` → 正确报出"未被预缓存"。

**CI**：`.github/workflows/verify.yml` 在每次 push 时自动跑上面两步（不需要浏览器，几十秒完成），
仓库主页会显示绿色对勾；需要 Chrome + CDP 的端到端/无障碍/性能三套留在本地跑。

---

## B. 真机测试（**请你在安卓手机上跑一遍并填写**）

手机型号：________________　Android 版本：____________　Chrome 版本：____________　日期：________

| # | 步骤 | 预期结果 | 实际结果 | 通过 |
| --- | --- | --- | --- | --- |
| B1 | Chrome 打开部署地址 | 显示登录页，无白屏 | | ☐ |
| B2 | 菜单 →「安装应用 / 添加到主屏幕」 | 出现安装提示，图标加到桌面 | | ☐ |
| B3 | 从桌面图标启动 | 独立窗口打开，无地址栏 | | ☐ |
| B4 | 注册账号（≥8 位含字母数字） | 直接进入扫码页 | | ☐ |
| B5 | Profile 勾选 Milk、Tree nuts，加关键词 coconut，保存 | 提示已加密保存 | | ☐ |
| B6 | Scan → Start camera，首次会请求摄像头权限 | 允许后出现取景画面 | | ☐ |
| B7 | 扫一件含牛奶的实物 | 红色 Avoid，并语音读出 | | ☐ |
| B8 | 扫一件标 may contain 的实物 | 黄色 Caution | | ☐ |
| B9 | 扫一件含椰子/椰浆的实物 | 红色（关键词命中） | | ☐ |
| B10 | 手动输入 3017620422003 → Look up | 显示 Nutella 结果 | | ☐ |
| B11 | 手动输入 3017620422004（校验位错） | 提示条码无效，不发起查询 | | ☐ |
| B12 | History 列表 | 能看到上面扫过的记录，缩略图正常 | | ☐ |
| B13 | **开启飞行模式**，从桌面图标冷启动 app | 仍能打开，底部提示离线 | | ☐ |
| B14 | 飞行模式下列表里点一条旧记录 | 正常显示结果，注脚为"saved copy" | | ☐ |
| B15 | 飞行模式下查一个新条码 | 明确提示无网络且未保存 | | ☐ |
| B16 | 关闭飞行模式 | 离线提示条消失 | | ☐ |
| B17 | Settings → 字号拉到 160% | 全局变大且不破版，底部导航不被挤出屏幕 | | ☐ |
| B18 | Settings → 高对比 | 变纯黑背景白字 | | ☐ |
| B19 | 结果页 🔊 朗读 | 能听清（需系统 TTS 引擎，如 Google 语音服务） | | ☐ |
| B20 | 横屏旋转 | 布局不塌，内容仍可读 | | ☐ |
| B21 | 开启 TalkBack（屏幕阅读器）走一遍扫码流程 | 每个控件都有可读标签，结论被朗读 | | ☐ |
| B22 | Settings → Export my data | 下载 JSON 文件 | | ☐ |
| B23 | Settings → Delete account | 确认后回到登录页，数据被清除 | | ☐ |
| B24 | 关闭 Wi-Fi 后用 History 连续翻 5 条 | 不卡顿、无崩溃 | | ☐ |
| B25 | Settings → Open device check | 各项状态全部显示 ok（BarcodeDetector supported、Service worker active、壳缓存 ≥10 文件） | | ☐ |
| B26 | Device check → Test camera (2 seconds) | 显示相机型号与分辨率，无报错 | | ☐ |
| B27 | Device check → Preload demo products | 提示 3/3 已保存；Products available offline 数字增加 | | ☐ |
| B28 | 飞行模式下从桌面图标冷启动 → 打开 Demo barcodes 里的 3017620422003 | 仍能显示 Nutella 结果（预热生效） | | ☐ |

**发现的问题记录**（按 B 编号填写）：

| 编号 | 现象 | 严重程度 | 处理 |
| --- | --- | --- | --- |
| | | | |

---

## C. 开发过程中修复的缺陷（报告里已写）

| # | 缺陷 | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | Nutri-Score 徽章全部显示为绿色 | 只用了一个通用"好评"色，E 级看起来和 A 级一样 | 引入官方五级配色；高对比模式下改用黑白徽章，不单靠颜色传达信息 |
| 2 | 不支持 BarcodeDetector 的浏览器上留下死黑取景区 | 摄像头容器无条件渲染 | 改为显式说明 + 突出手动输入，把降级路径变成主操作 |
| 3 | 端到端测试偶发卡在登录页 | 上一轮登录会话残留在浏览器 profile | 页面内 `deleteDatabase` 会被未关闭连接阻塞；改用 CDP `Storage.clearDataForOrigin` |
| 4 | console 断言被离线测试误伤 | 断网阶段产生的网络错误被当成真实错误 | 按阶段标记日志，仅在线阶段的错误判为失败 |
| 5 | 商品图加载失败时出现空白框 | 仅在 `onerror` 时替换占位图 | 改为缺字段即用首字母 SVG 占位，布局不塌 |
| 6 | 改文件名后 Service Worker 注册整段失败（`ServiceWorker script evaluation failed`） | 用 PowerShell `Set-Content` 做批量文本替换时，默认以 GBK 回写，把文件里的 UTF-8 中文注释写坏，`sw.js` 出现语法错误 | 从 Git 恢复文件，改用能保证 UTF-8 的编辑方式；并把 `.webmanifest` 一并改名为 `manifest.json`（GitHub Pages 不保证 `application/manifest+json` 的 MIME，类型错误会导致 Chrome 丢弃 manifest、装不上主屏幕） |
| 7 | 扫码过程中切换语音开关，预览变黑但相机指示灯常亮 | 语音按钮调用整页 `render()`，`<video>` 元素被替换，而摄像头流仍绑定在旧元素上 | 语音按钮改为就地更新自身状态；同时在 `render()` 开头统一 `stopScanner()`，任何整页重渲染前必定释放摄像头（也是隐私问题） |
| 8 | 无障碍审计器对"只有 `aria-hidden` 内容的按钮"漏报 | 计算可访问名称时用了 `element.textContent`，而该属性包含被 `aria-hidden` 隐藏的后代文本，与可访问名称算法不符 | 改为只收集未被 `aria-hidden="true"` 隐藏的后代文本；由审计器自检（注入已知缺陷）发现并验证 |
| 9 | **安全隐患**：数据库条目漏填 `allergens_tags` 时，配料表写着 "milk powder" 也会被判为 "No match / 安全" | 结论只依赖声明标签；Open Food Facts 是社区数据，漏填很常见 | 增加配料文本兜底：按过敏原关键词扫描配料表，并用排除规则避免误报（椰奶/燕麦奶不算乳、可可脂不算乳、"milk-free" 反向声明）；文本证据只降级为 **Caution** 并明确说明"该条目没有过敏原声明"，同时继续显示未知（绝不谎报安全）。新增 7 条单元测试锁定该行为 |
| 10 | 无障碍审计脚本在切换高对比模式那步崩溃 | 脚本隐式假设"上一阶段结束停在设置页"，而我给高对比阶段新增了诊断页作为末页 | 改为显式导航到 `#/settings` 并等待控件出现，去掉阶段间的隐式依赖 |
