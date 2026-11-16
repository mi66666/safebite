# SafeBite — 5 分钟现场演示脚本

> 用途：2026-11-25（周三）9:00–17:00 面向评阅老师。**必须到场**，缺席该项（10%）直接 0 分，且 app 功能分也在演示时打。
> 目标：5 分钟讲完，留 2–3 分钟答问。

---

## 演示前 10 分钟检查清单

- [ ] 手机装好 app：Chrome 打开 **https://mi66666.github.io/safebite/** → 菜单「安装应用/添加到主屏幕」，**从主屏幕图标启动**，不要从浏览器地址栏进
- [ ] 已登录一个账号，档案里勾好 **Milk + Tree nuts**，自定义关键词加 **coconut**
- [ ] **Settings → Open device check**：确认全部为 ok（尤其 `BarcodeDetector supported`、`Service worker active`）
- [ ] Device check → **Test camera**（2 秒）确认真机摄像头可用；再点 **Preload demo products**，必须显示 **3/3 已保存**（这一步防现场断网）
- [ ] **提前扫过 3 个商品**，让它们进缓存（离线演示要靠这个）
- [ ] 手机流量/Wi-Fi 可开关（离线环节要现场关）
- [ ] 音量开到能听清（语音朗读环节），但不要最大
- [ ] 备用：截图文件夹 `F:\dsh\tmp\shots\` 里 11 张全流程截图，若真机出问题立刻改用截图讲
- [ ] 带 4 件实物：**含牛奶的**、**标「may contain」的**、**含椰子/椰浆的**、**完全没问题的**

---

## 时间分配与逐句脚本

### 0:00–0:35　开场：问题
> "Two million people in the UK have a food allergy. Every one of them does the same thing in every shop: pick up a packet, turn it around, and try to read a paragraph of 6-point text before deciding. My app reduces that to one action."

### 0:35–1:10　是什么、给谁用
> "SafeBite. You record your allergens once — the 14 that UK law requires to be declared, plus any custom ingredient. Then you scan a barcode and get a verdict **about you**, not a generic product description: Avoid, Caution, No match, or Unknown."

一句话点出差异化：
> "Existing barcode apps tell you what the product is. SafeBite tells you whether **you** can eat it."

### 1:10–2:10　现场演示①：红色警告（核心功能）
1. **从主屏幕图标点开**（顺带说一句：已安装到主屏幕，独立窗口运行，像原生 app）
2. 点 **Start camera** → 扫**含牛奶**那件商品
3. 屏幕变红 → **Avoid — Contains Milk**，同时语音读出来

> "Notice it spoke the result. If I'm holding a basket, or if I'm partially sighted, I don't have to look at the screen."

4. 指一下 **Nutri-Score / NOVA** 徽章：

> "Secondary information: nutrition grade and how ultra-processed it is. Colour follows the official Nutri-Score scale — an E must not look like an A."

### 2:10–2:45　演示②：黄色谨慎（traces 区分）
扫那件标了 **may contain** 的：

> "This is the case most apps get wrong. It doesn't contain milk, but the factory handles milk on the same line. For someone with a milk allergy that difference is the entire decision, so the app has a separate amber state: **Caution — May contain traces of Milk**."

### 2:45–3:25　演示③：个性化（这是最抓人的一幕）
1. 进 **Profile**，快速划一下 14 类过敏原 chip
2. 展示自定义关键词 **coconut**
3. 扫**含椰子**那件 → 变红

> "No standard allergen taxonomy has 'coconut'. I added it myself as a custom keyword, and the app scans the ingredient text for it. That's what makes this personalised rather than a database lookup."

### 3:25–4:05　演示④：真离线
1. **现场关掉 Wi-Fi 和移动数据**
2. 底部 **History** → 点一条已扫记录 → 结果正常打开

> "Shops and basements have no signal. The app shell is cached by a service worker, and every product I've scanned is stored on the device. Same product, no network — and it tells me honestly that this is a saved copy, not a live fetch."

3. 再随手扫一个**没存过**的商品（或输入条码）→ 出现明确提示"no connection and not saved"

> "And it refuses to pretend. No data means it says so."

4. **恢复网络**

### 4:05–4:35　演示⑤：无障碍
1. **More → Settings**，把字号拉到 **160%**
2. 打开 **High contrast**
3. 回结果页，点 🔊 再听一次

> "Text scales to 160% and the whole layout derives from that size, so nothing breaks. High contrast mode is black and white. Results are announced through an ARIA live region for screen readers, and every control is at least 44 pixels."

### 4:35–5:00　收尾：技术决策
> "Three decisions worth mentioning. It's a PWA, not native — one codebase, installs without an app store, and updates instantly. I use Open Food Facts, which needs no API key: a key-based service failing during a live demo is a real risk I designed out. And it's tested by 36 unit tests, 16 automated browser checks including the offline behaviour you just saw, and an automated accessibility audit across light, dark, high-contrast and 160% text that reports zero violations."

---

## 预设问答（准备好被问到）

| 可能的问题 | 怎么答 |
| --- | --- |
| 为什么不做原生（Kotlin/Swift）？ | 单一代码库 + 免应用商店分发 + 即时更新；本功能集不需要原生独有 API。代价是无法用真正的原生传感器 API，这点我接受。 |
| 数据安全怎么做的？ | 密码不落盘：PBKDF2-SHA256、21 万次迭代、每用户 16 字节盐、恒定时间比较。过敏档案用 AES-GCM 加密，密钥由密码派生，且以**不可导出**的 `CryptoKey` 存放。摄像头画面只在内存处理，从不上传。 |
| 数据库错了怎么办？ | 每个结果都有免责声明：配方会变、社区数据可能不全。更重要的是设计上：**没有过敏原数据时返回 Unknown，绝不返回 Safe**。 |
| 如果数据库漏填了过敏原标签呢？ | 这是 Open Food Facts 的常见问题。所以引擎还有一层：**扫配料表文本**。比如条目没填 milk，但配料写着 "milk powder"，它会报 **Caution — Ingredient list mentions Milk**，并明确说明"该条目没有过敏原声明，已改为搜索配料文本，请看包装确认"。同时有排除规则避免误报（椰奶/燕麦奶不算乳制品、可可脂不算）。宁可让用户多看一眼包装，也绝不谎报安全。 |
| 你测试了什么？ | 36 个单元测试（校验位向量、过敏原别名匹配、配料文本兜底、traces 区分、加密往返、篡改检测）+ 16 项 CDP 自动化端到端（含真断网、设备自检）+ 无障碍自动审计（18 次页面审计、浅色/深色/高对比/160% 字号各一轮，0 违规，且审计器用注入缺陷自检 5/5）+ 真机测试日志。 |
| 无障碍怎么验证的？ | 不是靠"我觉得"。审计逐页测量：触控目标 ≥44px、可访问名称、图片 alt、标题层级、WCAG 对比度（普通 4.5:1／大字 3:1，按合成背景计算）、160% 字号下无横向溢出。首次审计抓出 40 处问题（缺 h1、4 个 50×29 的开关、4 个开关没有可访问名称），修完后归零。 |
| 用了 AI 吗？ | 用了一大篇幅在报告里披露（课程是 Green，允许但要声明）。我会具体说清哪些是 AI 起草、哪些判断是我做的——包括"unknown 不能等于 safe"这条是产品决策。 |
| 下一步做什么？ | 用 WebAssembly 的 ZXing 扩大浏览器支持；解析配料原文识别隐藏过敏原（如 casein 隐含牛奶）；从历史生成购物清单。 |
| 数据来源合法性？ | Open Food Facts，ODbL 开放数据库许可，README 和 app 内都注明。 |

---

## 出错时的兜底

| 情况 | 应对 |
| --- | --- |
| 摄像头打不开 | 直接用「手动输入条码」路径，并说明这是刻意设计的降级方案（不是 bug） |
| 现场 Wi-Fi 挂了 | 演示反而更好做：全部走缓存 → 正好讲离线设计 |
| 手机上 app 崩了 | 改用 `F:\dsh\tmp\shots\` 的截图走完流程，口述真机行为 |
| 语音没声音 | 说明是系统 TTS 引擎依赖，演示屏幕上的 aria-live 文本；或改用「Test voice」按钮定位问题 |
| 老师要求看代码 | 打开 GitHub 仓库，重点讲 `js/logic.js`（纯函数、可测试）和 `js/api.js`（缓存策略） |
