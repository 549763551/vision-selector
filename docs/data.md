# 型号库与数据来源

型号数据全部来自品牌公开产品手册与官网产品页，由 `tools/` 下的脚本抽取生成。页面只读 `*-catalog.js`，**不要手改**这些文件——下一次重跑脚本会被覆盖。

## 型号库怎么来的、怎么换

型号库 `hikrobot-catalog.js` 由脚本从手册生成，不要手改：

```bash
# 1. 手册转文本（xpdf 的 pdftotext 默认 Latin1，必须显式 UTF-8）
pdftotext -enc UTF-8 -raw "机器视觉标准产品手册-2026.Q3.pdf" stdraw.txt
# 2. 抓光源型号（手册不含光源章节，取自官网产品列表）
node tools/fetch-lights.js > lights.json
# 3. 抓详细参数（动态范围/信噪比/曝光/PoE/功率/控制器，约 800 个请求、20 秒）
node tools/fetch-specs.js > specs.json
# 4. 生成型号库（webref.json 为官网型号对照，用于校正排版丢失的黑白/彩色与接口）
node tools/parse-catalog.js stdraw.txt webref.json lights.json specs.json > hikrobot-catalog.js
```

> **补录与重跑的关系**：主生成器的输入（pdftotext 文本、官网 webref / lights / specs）不在仓库里，重跑只会覆盖手册主表。
> 手册中主表漏掉的型号由 `tools/parse-hikrobot-gaps.py` 之类脚本抽成 `tools/_cache/*.json`，再用
> `tools/merge-catalog-add.py <型录.js> <补库.json> --map cameras=CAMERAS:cameras ...` 尾部追加：按型号去重、同步 `META` 计数，除新行外其余字节不动。

抽取逻辑要点：

- 按章节标题切分「CS / CU / CT / CH 系列 × GigE / USB3 / CameraLink / CoaXPress / 万兆网 / XoFLink」表格；
- 型号行可能被 PDF 排版拆成多行，脚本会向后合并最多 7 行再取分辨率、像元、帧率、快门；
- 靶面宽高不直接用「1/1.8"」这类标称值，而是 `分辨率 × 像元` 算出真实 mm（更准）；
- 黑白/彩色与接口用官网产品列表逐型号校正，避免手册排版串行。

要换自己的品牌/型号库：**保持 `CAMERAS` / `LENSES` 的字段结构**即可，引擎只依赖这些字段：

```js
// 相机
{ model, w, h, pxUm, sw, sh, size, fps, shutter:'Global'|'Rolling',
  iface:'GigE'|'USB3'|..., color:'黑白'|'彩色', mount:'C'|'M42'|'F'|'M58'|'M72', series }
// 镜头
{ model, focal, fmin, fmax, mount, ic /*像面直径mm，未知填null*/, mp /*解析力MP，未知null*/, series }
// 光源（可选，用于把灯具型号接入选型与备选标注）
{ model, type:'ring'|'bar'|'bar_array'|'backlight'|'backlight_parallel'|'backlight_hole'|'dome'|'coaxial'|'line'|'line_high'|'point'|'flat_shadowless',
  color:'white'|'red'|'blue'|'green'|'infrared', size:[宽mm, 高mm], power /*W，未知填null*/, brand }
// 光源控制器（可选）
{ model, channels /*通道数*/, brand }
```

改完跑一次 `node engine.test.js`，测试会告诉你有没有算歪；改公式口径还要跑 `node calc.test.js`。

### 选型链纳入口径（selection-catalog.js）

选型助手 `index.html` 与自定义搭配 `combo.html` 现在加载**六品牌全部在售型录**（主库 + 独立镜头 / 光源 / 控制器库），
由共用的 `selection-catalog.js` 合成一个目录，两页与测试用同一套口径：

- **纳入**：面阵 + 线阵相机、定焦 + 远心镜头、光源 + 配套控制器；相机 / 镜头 / 光源三类各自按品牌独立启停
  （线扫跟相机、远心跟镜头、控制器跟光源）。品牌筛选条只列出「清洗后仍有有效型号」的品牌。
- **排除退市**：两页也加载 `retired-catalog.js`，但只读型号清单做按型号排除，不展示退市条目。
  另有 4 款在售型录与退市库重名（`MV-CH089-10GM/GC`、`acA2000-165um/uc`）会被剔除。
- **必要参数硬门槛**：按引擎实际算路依赖校验，缺任一项即不纳入（`REQUIRED` 表见源码）。
  引擎已有 `null` 保护的字段（镜头 `ic`/`mp`、相机 `expMinUs` 等）不算必要。
- **参数复核（2026-11-20）**：把全部被排除条目逐条回查官网原始表、官方 PDF 与官网在线页，分三类处理，
  依据同时写在 `selection-catalog.js` 文件头：
  - **上游漏读，已补录**：奥普特 39 款光纤 / 程控图案光源官网明确列了「尺寸(mm)」「LED颜色」，
    而 `tools/build-opt-full.py` 原先只认「外形长度 / 宽度 / 直径」专用列，也没处理「多光谱」
    与没有 `LED颜色` 列时的型号颜色后缀；Basler 2 款控制器型号 `2C` / `4C` 是厂商明示的通道数，
    `tools/gen-basler-light-catalog.py` 却写死 `channels: null`。两个生成器已修，另删掉 1 条官网空占位行；
    `library.html` 增 `multi`（多光谱）颜色标签。
  - **厂商未公布 / 无结构化数值，维持排除**：康视达 53 台面阵相机官方《工业相机系列》PDF 面阵页
    与官网 `show/1651.html` 系列表都没有「镜头接口」列（同册线阵页有且已解析）；
    康视达 251 款光源官网分类表尺寸列全空（含 3 款新补的红外 850nm 派生 / 用户补充型号），系列型录只有按「安装图序号」共用的尺寸示意图、
    没有逐型号数值，按不推算原则不补。
  - **产品类型不适用该算路，维持排除**：奥普特 18 款变倍 / 显微镜头、康视达 1 款微距镜头
    （官网给的是放大倍率 / 工作距离 / NA，不是定焦镜头）、华睿 1 款远心（官网型号表只给型号）。
- **等价字段补齐**：信息本身存在、只是键名不完整的，搬运已有数值后照常参与，不推测不编造 ——
  线阵 `pxH ← pxUm`（康视达 8 台）、远心 `wdMax ← wdMin`（奥普特 619 款单值工作距离）。
- **不纳入**：3D / 智能相机 / 红外 / 工控机 / 非标产品，字段口径与「相机 + 镜头 + 光源」分离算路不兼容；
  退市库条目本身也不进。线阵相机与远心镜头在**自动选型**里参与（线扫方案 / 远心建议），
  **搭配台**沿用既有的面阵 + 定焦镜头评定公式，只列 `CAMERAS` / `LENSES`。

清洗后选型池：面阵 1982 / 线阵 118 / 定焦镜头 1144 / 远心 922 / 光源 4066 / 控制器 114 / 3D 轮廓 72；
排除退市 4 款、必要参数不全或不适用 324 款，等价字段补齐 627 处。改动在售型录后要同步 `engine.test.js` 的池数字断言。

照明子类 `polar` / `rgb` / `strobe` / `darkfield` / `flood` 等新增时，`library.html` 与 `engine.js` 两处 `LIGHT_TYPE_LABEL` 都要同步。

抓取链路（站点 `www.cstmv.com` 有 JS 挑战页、**去掉 www 直连 200**）：
`tools/fetch-cst.py discover`（BFS 分类树）→ `pages`（翻页）→ `collect`（汇总去重）→ `series`（相机/远心系列表）→ `details`（1605 个单品参数页）→ `tools/build-cst-catalog.py` 生成型录。
分类页表头与产品行偶有列错位，官网个别分类还只填 1,2,3… 占位序号，因此**规格以单品页的「标签—值」表为准**，分类页只用来发现型号、归属类目与补尺寸；生成器对占位行有检测。

## 官方资料清单（docs-data.js）

主页「官方资料」区列出六个品牌共 **211 条**品牌级 / 系列级手册与资料入口，按品牌分组、可搜索、可展开。每条默认指向**厂商官方直链**；勾选「优先本地副本」后改读本地 `manuals/` 目录（离线可用，偏好存 `localStorage`）。此前该区指向 `manuals/` 的 7 个链接在线上全是 404，现已修复。

- `docs-data.js` 由 `tools/build-docs-data.py` 生成，`return` 后是一段严格 JSON，页面读 `window.VISION_DOCS`，下载脚本也复用同一份数据，**勿手改**。
- `manuals/` 只存本地副本，被 `.gitignore` 忽略，**不入库不推送**：PDF 版权归各厂商，公开仓库只放链接；全量约 1 GB，直接入库也会顶到 GitHub Pages 站点的 1 GB 上限。
- 采集口径见 `tools/build-docs-data.py` 头部：海康 `Support/v2/DownCenter` 接口（`module=1` 是资料，`module=0` 是软件）、华睿 `/api/cn/download/downloadList?nav_id=31`、大恒产品型录页（阿里云 WAF，需真浏览器取 DOM 的 `downyz_click`）、康视达 `/list/30.html` 19 页。只收品牌级与系列级手册，**不收型号级规格书**。
- **Basler / 奥普特**的下载需登录或被 WAF 挡，没有公开文件直链，因此只登记官方资料中心入口，不伪造链接；奥普特入口已注明需登录。
- 大恒站点对脚本请求一律返回 23670 字节的 JS 挑战页，本地副本需 `node tools/cdp-download-daheng.js`（真浏览器打开下载页完成挑战后，同源 `fetch` 才能拿到真正的 PDF）；其余三家由下载脚本直接取。
- 更新流程：`python tools/build-docs-data.py` 重新生成清单 → `python tools/download-manuals.py` 断点续传下载 → `node tools/cdp-download-daheng.js` 补大恒。

## 目录结构

五个页面 + 两份引擎（选型引擎 / 公式引擎）+ 各品牌型录，全是静态文件，没有构建步骤。

| 文件 | 作用 |
|---|---|
| `home.html` | **主页**：五页统一入口、数据速览（实时统计型号库）、官方资料区（按品牌分组 / 搜索 / 本地副本切换） |
| `index.html` | 选型助手页面骨架 + 样式（无依赖），含顶栏「品牌范围」筛选 |
| `combo.html` | **自定义搭配评定页**：需求表单 + 相机/镜头/光源可搜索选择器 + 逐项评定与替换建议 |
| `combo.js` | 搭配页逻辑：经 `selection-catalog.js` 全量合并六品牌在售型录、解析品牌别名、调用 `evaluateCombo`、草稿与「应用到选型助手」交接 |
| `library.html` | **产品库**：8868 个型号、11 个页签（面阵 / 线阵 / 镜头 / 远心 / 光源 / 控制器 / 3D / 工控机 / 红外 + 收藏 + 全部）的分类筛选 / 关键词搜索（型号在别的类别时自动切页签，搜线阵 / 镜头 / 光源不会被当前页签挡成「库里没有」）/ 全参数详情 / 分页，同规格跨品牌自动互标备注，型号示意图按真实参数内联绘制（镜筒长随焦距、光源形状随类型、控制器旋钮随通道数），移动端卡片自适应 |
| `docs-data.js` | 主页官方资料清单（6 品牌 / 211 条），由 `tools/build-docs-data.py` 生成，勿手改；`return` 后是严格 JSON，下载脚本共用 |
| `manuals/` | 本地 PDF 副本，`.gitignore` 忽略、**不入库不推送**；PDF 版权归厂商，线上只走官方直链 |
| `selection-catalog.js` | **选型链目录合并（共用）**：型录源清单、按类目品牌启停、退市排除、必要参数硬门槛、等价字段补齐、`brandKeys()` / `merge()`；`index.html` / `combo.html` / `engine.test.js` 共用，保证三处口径一致 |
| `brands.js` | **品牌注册表**（品牌名 / logo / 全局变量名），接入新品牌先在这里登记，再到 `selection-catalog.js` 的 `SOURCES` 里登记型录来源 |
| `cst-catalog.js` | 康视达型号库 1676 款（面阵 53 / 线阵 8 / 镜头 91 / 远心 48 / 光源 1450 / 控制器 26），由 `tools/build-cst-catalog.py` 生成，勿手改。六品牌统一加载；面阵相机因缺卡口被必要参数门槛挡在选型链外，其余参与 |
| `cst-misc-catalog.js` | 康视达非标产品 54 款，按惯例只落盘备份、不挂任何页面 |
| `hikrobot-catalog.js` | 海康型号库（面阵/线扫/镜头/远心/光源），由脚本生成，勿手改 |
| `huarui-catalog.js` | 华睿型号库（面阵 / 线阵 / 镜头 / 光源 / 光源控制器），由 `tools/parse-huarui.py` + `tools/parse-huarui-linescan.py` + `tools/parse-huarui-lenses.py` + `tools/parse-huarui-lights.py` 生成，勿手改 |
| `basler-catalog.js` | Basler 型号库（面阵 + 线扫 racer 2），由 `tools/parse-basler.py` + `tools/fetch-basler-cams.js` 生成，勿手改 |
| `basler-lens-catalog.js` | Basler 镜头库（定焦 + 远心），由 `tools/fetch-basler-lenses.js` + `tools/gen-basler-lens-catalog.py` 生成，勿手改 |
| `basler-light-catalog.js` | Basler 灯光库（灯具 + 控制器），由 `tools/fetch-basler-lights.js` + `tools/gen-basler-light-catalog.py` 生成，勿手改 |
| `hikrobot-3d-catalog.js` | 海康 3D 传感器库（轮廓 / 结构光 / 物流 3D），由 `tools/parse-3d.py` 生成，勿手改 |
| `hikrobot-ipc-catalog.js` | 海康工控机库（整机机箱 + 主板），由 `tools/parse-ipc.py` 生成，勿手改 |
| `hikrobot-ir-catalog.js` | 海康工业红外相机库（CI 系列长波/短波），由 `tools/parse-hikrobot-ir.js` 生成，勿手改 |
| `daheng-catalog.js` | 大恒图像型号库（面阵 / 板级 + 镜头 + 远心），由 `tools/parse-daheng-cams-v2.py` + `tools/parse-daheng-lenses-all.py` + `tools/curate-daheng-lenses.py` 生成，勿手改 |
| `opt-catalog.js` | 奥普特相机库（面阵 118 + 线阵 24），由 `tools/parse-opt-list.py` → `tools/fetch-opt-detail.js` → `tools/parse-opt-detail.py` → `tools/build-opt-catalog.py` 生成，勿手改 |
| `opt-lens-catalog.js` | 奥普特镜头库（定焦 / 线扫 / 液态 / 显微 / 变倍 278 + 远心 619），由 `tools/build-opt-full.py` 生成，勿手改 |
| `opt-light-catalog.js` | 奥普特光源库（2133 支，16 个照明子类），由 `tools/build-opt-full.py` 生成，勿手改 |
| `opt-ctrl-catalog.js` | 奥普特光源控制器 43 款 + 视觉控制器 / 工控机 21 台，由 `tools/build-opt-full.py` 生成，勿手改 |
| `opt-misc-catalog.js` | 奥普特智能相机 / 读码器 145 + 传感器 1057 + 测量运控 26，由 `tools/build-opt-misc.py` 生成。**仅备份、未挂载**：产品库不扩张产品线类型，这几个类目暂不进页面 |
| `engine.js` | **选型算路引擎**，纯计算、无 DOM，浏览器和 Node 都能跑；暴露 `VisionEngineFactory` 便于按品牌重建 |
| `calc.html` | **工程计算器页面**：6 个组合计算器（面阵成像 / 运动曝光 / 接口安装 / 线扫 / 远心 / 速查），组内共享输入、能算的先算、缺的定位，公式 / 代入 / 结果 / 判定逐项展示，可复制、清空，纯前端离线可用 |
| `calc-engine.js` | **公式引擎**，纯计算、无 DOM、无隐式默认值；`FORMULAS`（17 式：输入定义 / 公式符号 / 判定 / `provides` 可传递量）、`COMBOS`（6 组：字段、小节、`fieldFrom` 跨式带入、`auto` 输入来源）、`compute(id, params)`、`computeCombo(id, params, seed)`、`defaults(id)` 与 `core` 底层口径；浏览器 `window.CalcEngine` / Node `require`。口径与 `engine.js` 一致 |
| `calc-app.js` | 计算器页面逻辑：按组合元数据生成空白输入、输入即算、自动带入标注、缺项定位、复制本组 / 单式、清空；不含任何公式 |
| `calc.test.js` | 41 个单元测试（元数据与缺参数拦截、k 表与接口带宽口径对照、17 式数值回归、6 组组合的共享输入 / 缺项根因 / 跨组带入 / 可选参数 / 覆盖完整性、边界与复制文本），`node calc.test.js` 运行 |
| `app.js` | 界面逻辑：读表单 → 调引擎 → 渲染；三类品牌筛选条由 `selection-catalog.js` 的 `brandKeys()` 生成，合并目录走 `merge()` |
| `engine.test.js` | 120 个单元测试（含多品牌合并 / 全量选型池清洗与品牌开关 / 镜头·线扫·光源三线双品牌 / 跨品牌等价 / 选优回归 / mount 完备性 / 线扫优先 / 镜头跨品牌选型 / 转接环与景深光圈 / 备选方案与镜头·光源备选标注 / 自定义搭配评定 / 现场参数与配套验收 / 选型依据对比），`node engine.test.js` 运行 |
| `tools/build-opt-series-index.py` | 解析官网首页产品导航的「产品线 → 分类 → 系列」三级树（179 个系列） |
| `tools/fetch-opt-tree.js` | 抓标准光源侧栏分类树（`item-id` 不可信，按文档顺序归属；交替正则会吞节点） |
| `tools/fetch-opt-ajax.js` | 按系列抓全量型号表（`ajax_series_<id>.html?pageSize=500`，并发 6） |
| `tools/parse-opt-all.py` | 通用「列名 → 值」解析（各系列列名/列数都不同，按 thead 对齐，不写死列位） |
| `tools/build-opt-full.py` | 生成奥普特镜头 / 光源 / 控制器 / 工控机型录（含照明类型、颜色、尺寸口径映射） |
| `tools/build-opt-misc.py` | 生成奥普特智能相机 / 读码器 / 传感器 / 测量运控型录（原始 spec 全保留） |
| `tools/build-docs-data.py` | 汇总四家可公开下载的手册清单，生成 `docs-data.js`（采集接口见脚本头部注释） |
| `tools/download-manuals.py` | 按清单把官方 PDF 下载到 `manuals/`，断点续传，支持 `--brand` / `--force` |
| `tools/cdp-download-daheng.js` | 大恒专用：官网阿里云 WAF 会挡脚本请求，用真浏览器过挑战后同源 `fetch` 取 PDF，分块回传写盘 |
| `tools/fetch-cst.py` | 康视达官网抓取器：BFS 分类树 / 翻页 / 系列表 / 单品详情页。注意用 `https://cstmv.com`（无 www）绕过 JS 挑战 |
| `tools/build-cst-catalog.py` | 把分类页 + 单品页 + 系列表组装成 `cst-catalog.js`；含占位行检测、型号差集校验与字段口径映射 |
| `tools/fetch-huarui-lens.py` | 华睿镜头 / 远心型号：站点是 React SPA，curl 抓 HTML 只有空壳，型号在 XHR 里，走 `/api/cn/vision/productListNew?id=<navId>`（面阵 122 / 线阵大面阵 187 / 远心 188） |
| `tools/build-huarui-lens-add.py` | 华睿官网 77 款与库内 63 支比对，产出 22 款增量（含像面「1.1''(φ17.6mm)」写法的解析、F 数越界置空） |
| `tools/write-huarui-lens-add.py` | 把增量写进 `huarui-catalog.js`（定焦进 LENSES、远心进 TELECENTRIC），可重复执行 |
| `tools/fetch-daheng-swir.py` | 大恒短波红外规格书解析（`label/label/value` 三元组去重）。核查结论：官网 24 款 SWIR **已全部在库**，无需补录 |
| `tools/parse-catalog.js` | 从手册 PDF 抽取海康相机/镜头/远心的生成脚本 |
| `tools/parse-huarui.py` | 从手册 PDF 抽取华睿面阵相机的生成脚本（含线阵合并） |
| `tools/parse-huarui-linescan.py` | 从华睿手册 p27-29 解析 26 台线阵相机（span 流 + 列名 x 边界 + 重复层过滤） |
| `tools/parse-huarui-lights.py` | 从华睿手册 p66-78 解析 262 款光源（按 W/R/B 拆色）+ 20 款光源控制器（span 流 + 全列登记边界 + 型号锚点行归属，兼容一页多表与单元格换行） |
| `tools/parse-basler.py` | 由检索整理的 Basler 规格表生成 `basler-catalog.js` |
| `tools/parse-daheng-cams.py` | 从《大恒图像产品型录》解析 275 台相机 |
| `tools/parse-daheng-lenses.py` | 从《大恒镜头产品型录》p5-8 解析 71 支 HN/HN-P 镜头（文本流 + 顺序模式匹配 + 压缩行拆分） |
| `tools/gen-daheng-catalog.py` | 把大恒相机/镜头中间 JSON 合成为 `daheng-catalog.js` |
| `tools/fetch-lights.js` | 从官网抓取光源型号的脚本 |
| `tools/fetch-specs.js` | 从官网逐型号抓取详细参数（动态范围/信噪比/曝光/PoE/功率/控制器） |
| `assets/hikrobot-logo.png` | 海康机器人 HIKROBOT 字标（仅用于标注数据来源） |
| `assets/huarui-logo.svg` `assets/basler-logo.svg` `assets/daheng-logo.svg` `assets/opt-logo.svg` `assets/cst-logo.svg` | 华睿 / Basler / 大恒 / 奥普特 / 康视达归属标（简化文字标，非官方商标图样） |
| `assets/favicon.ico` | 站点图标 |
| `assets/screenshot-index.png` | README 里的选型助手首屏截图 |
| `assets/qr-gzh.jpg` `assets/qr-mp.jpg` | 主页「关注与小程序」的公众号 / 小程序二维码 |
| `assets/logo/logo-{1024,512,144}.png` | 小程序 / App 图标（脚本生成） |
| `assets/logo/logo-wordmark.png` | 横版字标（图标 + 名称） |
| `tools/make-logo.py` | 生成上述 logo 的脚本（改色/改尺寸重跑即可） |
| `package.json` | 只用来跑 `npm test`，不是构建工程 |
| `.github/workflows/test.yml` | 每次 push / PR 自动跑测试 |
| `LICENSE` | MIT |
| `docs/` | 使用说明、算路口径、数据来源三份文档（README 里的链接指向这里） |
| `CHANGELOG.md` | 版本更新记录，按版本倒序 |

> 想改选型规则只动 `engine.js`；想换型号库只重跑对应 `tools/parse-*.py`；
> 想加新品牌：在 `brands.js` 登记 → 写一份 `*catalog.js`（UMD，挂到 `root.XxxCatalog`）→
> 在 `selection-catalog.js` 的 `SOURCES` 登记「全局变量名 → 品牌键」→ 四个页面脚本区引入；
> 想改界面只动 `index.html` / `app.js`（或 `combo.html` / `combo.js`）。
> 主页与产品库（`home.html` / `library.html`）通过 `brands.js` + 各 `*catalog.js` 读取型号库，
> 新品牌入库后两者的数据速览与产品列表会自动带上该品牌，无需另改。

### 接入新品牌的最小步骤

1. 在 `brands.js` 的 `BRANDS` 里加一项：`key / name / short / logo / color / global`（如 `daheng: { ..., global: 'DahengCatalog' }`）。
   若用官方字标图（字母占满画布），加 `logoScale: 0.8` 与自制归属标对齐视觉大小；自制归属标保持主文字占画布 ~80%。
2. 生成 `daheng-catalog.js`：UMD 包裹，把整库挂到 `root.DahengCatalog`（`brand` 字段可省，合并时按品牌键补）。
3. 在 `selection-catalog.js` 的 `SOURCES` 追加 `{ g: 'DahengCatalog', b: 'daheng' }`；四页脚本区各加一份
   `<script src="daheng-catalog.js"></script>`（放在 `engine.js` 之前）。独立镜头 / 光源 / 控制器库同样在
   `SOURCES` 里登记成同一品牌键即可，不必塞进主库。
4. 三条品牌筛选条会按「清洗后仍有有效型号」自动出现该品牌，无需改引擎或界面代码。
5. **必要参数是硬门槛**（`selection-catalog.js` 的 `REQUIRED`）：相机需 `model/w/h/pxUm/sw/sh/fps/iface/mount/color`，
   镜头需 `model/focal/mount/fmin`，光源需 `model/type/color/size`，远心需 `model/mount/magMin/magMax/wdMin/wdMax`，
   控制器需 `model/channels/mode`。缺任一项整条不进选型池（页面 `catalogNote` 会显示排除数量）。
   引擎已有 `null` 保护的字段（`ic`/`mp`/`expMinUs`/`power` 等）不算必要。
6. 若提供 `LINESCAN`（线阵：`{model,w,taps,pxH,pxV,lineRate,color,iface,mount,...}`），面阵不可行时自动进入线扫比选；
   表单勾选「优先线扫方案」后随时可看线阵建议。只有 `pxUm` 没有 `pxH` 时合并层会自动补齐。
7. 若提供 `LIGHTS` / `CONTROLLERS`，该品牌灯具会自动进入光源选型（与其它品牌同台比价，取刚好够用的最小规格）与「备选型号」；无需改引擎。
8. 改完跑 `node engine.test.js`，同步全量选型池的数字断言与 README / 本文的当前数量。

> 大恒的解析可作参考：`tools/parse-daheng-cams.py` 用「find_tables 定列区间 + 型号 span 锚点定行 + span 原文定值」的混合策略，
> 处理了型录里单元格文本垂直错位、行矩形跨行合并、靶面写成 `11.1 mm`、`M/C` 双 SKU 拆分等坑。

## 开发与发布

```bash
npm test                 # node engine.test.js（120 项）+ node calc.test.js（41 项），共 161 项
```

测试覆盖：型号库自洽性、分辨率与颜色/快门约束、型号与镜头像面/卡口/最近摄距匹配、
"取像素最少可行机型"、光学计算自洽（倍率/视场/像素精度）、景深、曝光、光源系列与 SKU、
线扫完整方案、远心工作距离校验、同系列参数分组、手动指定型号、精度预算合成、
安装空间判定、手册尺寸图长度、图示几何、精度不足降级、非法输入、
多品牌合并、镜头/线扫/光源三线双品牌、跨品牌等价、转接环与景深光圈、备选方案与镜头·光源备选标注、
自定义搭配评定（自动方案等价 / 卡口不符 / 解析力不足 / 光源缺失与族别）、
现场参数（光圈档位 / 曝光上下限 / 硬触发与频闪）、安装配套清单与空间判定自洽、验收清单与重点项、
选型依据六维对比与判定自洽（次优按同一口径重新算分）、推荐结果与运行环境 locale 无关。

- **CI**：`.github/workflows/test.yml`，push / PR 自动跑 `npm test`。
- **发布**：版本号见 `package.json` 与 Git tag（当前 `v2.2.0`），
  用 `gh release create` 打 Release。
- **部署**：GitHub Pages 从 `main` 分支根目录直接托管，纯静态无需构建；
  push 到 `main` 后几十秒自动更新。

需要发新版本时（型号总数比上次发布增加 500 以上才发，发版前先与维护者确认）：

```bash
VER=v2.2.0   # 改成实际版本号
git tag -a "$VER" -m "$VER" && git push origin "$VER"
gh release create "$VER" --title "$VER" --notes-file /tmp/release-notes.md
```
