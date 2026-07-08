# Fasudil-LLC Analyzer V2 — 执行清单 (todo.md)

> 版本：v2.0.0
> 共 7 大阶段，47 个最小可执行任务项

---

## 阶段1：项目目录初始化 & 环境复用（P0）

- [ ] **1.1** 创建 `v2/` 目录完整结构：`{js,css,libs,api/{auth/otp,data},lib}`
- [ ] **1.2** 拷贝 `libs/`：xlsx.full.min.js / chart.umd.js / pdf.min.js / pdf.worker.min.js / mammoth.min.js
- [ ] **1.3** 拷贝 `css/app.css`
- [ ] **1.4** 拷贝 `js/calc.js`、`js/charts.js`、`js/ml.js`、`js/ui.js`、`js/parser.js`（零修改复用）
- [ ] **1.5** 创建 `v2/package.json`（仅 @libsql/client + jose + nodemailer）
- [ ] **1.6** 创建 `v2/vercel.json`（完整配置含rewrites/headers/functions）
- [ ] **1.7** 创建 `v2/index.html`（沿用原骨架，含登录页/主应用/图标CDN/字体兜底）
- [ ] **1.8** 创建或关联 Turso 数据库，获取 `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
- [ ] **1.9** 执行建表SQL（9张表：users/verification_tokens/experiments/samples/release_data/reports/user_templates/user_preferences/knowledge_entries）

---

## 阶段2：后端API层 — Turso + Auth + CRUD（P0）

- [ ] **2.1** 创建 `v2/lib/turso.js`：数据库连接单例（支持Turso/本地SQLite双模式）
- [ ] **2.2** 创建 `v2/api/auth/me.js`：GET — 验证JWT Cookie → 返回用户信息
- [ ] **2.3** 创建 `v2/api/auth/otp/send.js`：POST — 生成OTP → 写入DB → 发送邮件
- [ ] **2.4** 创建 `v2/api/auth/otp/verify.js`：POST — 验证OTP → 签发JWT写入Cookie → 返回用户
- [ ] **2.5** 创建 `v2/api/auth/logout.js`：POST/GET — 清除Cookie → 302跳转首页
- [ ] **2.6** 创建 `v2/api/data/experiments.js`：GET/POST/PUT/DELETE 实验组CRUD
- [ ] **2.7** 创建 `v2/api/data/samples.js`：GET/POST/PUT/DELETE 样品CRUD
- [ ] **2.8** 创建 `v2/api/data/release.js`：GET/POST/PUT 释放曲线数据CRUD
- [ ] **2.9** 创建 `v2/api/data/reports.js`：GET/POST/DELETE 报告CRUD
- [ ] **2.10** 创建 `v2/api/data/templates.js`：GET/POST/PUT/DELETE 模板CRUD
- [ ] **2.11** 创建 `v2/api/data/preferences.js`：GET/POST 用户偏好
- [ ] **2.12** 创建 `v2/api/data/knowledge.js`：GET/POST/PUT/DELETE 知识库CRUD
- [ ] **2.13** 所有数据端点统一 user_id 鉴权校验 + 401拦截

---

## 阶段3：前端核心业务逻辑迁移&重构（P0）

- [ ] **3.1** 重写 `js/experiment-cards-data.js`：
  - 所有 CRUD 从 localStorage 改为 fetch 调用 `/api/data/*` API
  - 保留完整：14列模板结构（SYSTEM_DEFAULT_TEMPLATE）
  - 保留完整：模板管理函数（getUserTemplates/saveUserTemplates/cloneTemplate等）
  - 保留完整：旧数据兼容字段（perRowDrugAmount/perRowDrugConc/perRowDensity等）
  - 保留端 API：`_saveToStorage()` 改为 `_saveToApi()`，`_loadFromStorage()` 改为 `_loadFromApi()`
- [ ] **3.2** 改造 `js/experiment-cards.js`：
  - 所有 ExperimentData 调用从同步改为 async/await
  - 保留完整：创建VS编辑弹窗差异化逻辑（文本输入/复选多选）
  - 保留完整：释放曲线自动计算（标曲公式：2*(Abs-0.00414128)/0.0136697）
  - 保留完整：累计释放量迭代累加公式、释放率公式
  - 保留完整：载药浓度/实验药量公式计算顺序
  - 保留完整：模板预加载缓存机制
- [ ] **3.3** 重写 `js/app.js`：
  - 去除 FSManager 依赖（所有文件/设置操作改为API调用）
  - 保留完整：8个页面路由（dashboard/upload/experiments/tools/knowledge/prescription/sample/settings）
  - 保留完整：init() 启动流程（乐观渲染→并行鉴权→预渲染）
  - 保留完整：forceLogout() 清除逻辑
  - 保留完整：上传分析页（上传→解析→预览→保存到实验）
  - 保留完整：6个计算器全部逻辑
  - 保留完整：API配置管理（设置页面）
  - 保留完整：主题切换、页面刷新
- [ ] **3.4** 去除 `server.js` 依赖（不再需要本地开发服务器）

---

## 阶段4：鉴权体系 & 数据绑定用户UID（P0）

- [ ] **4.1** init() 启动：检测 localStorage `auth_user` → 有则乐观显示骨架 → 并行发 `/api/auth/me`
- [ ] **4.2** 401 全局拦截（apiFetch 封装）：收到 401 → forceLogout()
- [ ] **4.3** 登录成功：`auth_user` 写入 localStorage → 刷新页面进入主应用
- [ ] **4.4** 所有 API 请求自动附带 Cookie（`credentials: 'same-origin'`）
- [ ] **4.5** 退出登录：`localStorage.clear()` → `document.cookie` 清除 → window.location.replace('/api/auth/logout')
- [ ] **4.6** 多设备同步：所有用户数据存储于 Turso，每台设备登录自动拉取最新数据

---

## 阶段5：UI层标准化统一落地（P1）

- [ ] **5.1** Google Material Icons Outlined 字体 CDN 配置
  - `<link rel="preconnect">` ×2（googleapis + gstatic）
  - `<link rel="preload" as="style">` 最高优先级
  - `<link rel="stylesheet">` 加载
- [ ] **5.2** 字体加载兜底
  - `.material-icons-outlined { visibility: hidden; }`
  - `.fonts-loaded .material-icons-outlined { visibility: visible; }`
  - JS 监听 `document.fonts.ready` + 3秒 setTimeout 强制显示
- [ ] **5.3** 侧边栏图标 CSS 修复
  - `.nav-item` 全部 `!important`：`flex-direction:row`、`width:100%`、`gap:8px`
  - 图标固定宽度24px、字号24px
- [ ] **5.4** 前端表单无障碍规范
  - 所有 `<input>` / `<select>` 携带唯一 `name` + `id`
  - `<label>` 通过 `for` 绑定对应输入框
- [ ] **5.5** 边框样式修复
  - `showModal()` 后调用 `void offsetHeight` 强制 reflow
- [ ] **5.6** favicon 404 预防：`<link rel="icon" href="data:,">`
- [ ] **5.7** 全局兜底：app.js 所有关键 switch-case / try-catch / 终极兜底HTML

---

## 阶段6：GitHub + Vercel + Cloudflare 部署（P0）

- [ ] **6.1** Vercel Dashboard 创建项目，关联 GitHub 仓库（fasudil-llc，`v2/` 目录）
- [ ] **6.2** Vercel 配置系统环境变量：
  - `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
  - `JWT_SECRET`
  - `BREVO_API_KEY` + `BREVO_SENDER_EMAIL`
- [ ] **6.3** Vercel 设置 Root Directory 为 `v2/`，Framework Preset 选 Other
- [ ] **6.4** Vercel 添加自定义域名（二级域名如 `fasudil.yourdomain.com`）
- [ ] **6.5** Cloudflare DNS 添加 CNAME 记录指向 `cname.vercel-dns.com`
- [ ] **6.6** Cloudflare SSL/TLS → Full (strict) + Always Use HTTPS
- [ ] **6.7** Cloudflare Page Rules 配置缓存策略（静态资源1个月，API绕开）
- [ ] **6.8** Git Push 到 main → 确认 Vercel 自动触发部署 → 验证域名可用

---

## 阶段7：全量回归测试 & 旧数据迁移（P2）

- [ ] **7.1** 登录/登出/自动跳转流程完整测试
- [ ] **7.2** 8个页面导航渲染 + 首屏200ms内显示
- [ ] **7.3** 创建实验组完整流程（模板选择 → 多处方行 → 空格分隔多样品 → 保存）
- [ ] **7.4** 编辑实验组完整流程（复选样品 → 保留释放数据 → 只重算）
- [ ] **7.5** 释放曲线完整操作（添加/删除行 → 输入数据 → 自动计算 → 实时图表 → 保存）
- [ ] **7.6** 6个计算器所有计算类型（EE/DL/累积释放/模型拟合/f2/残留率）
- [ ] **7.7** 模板管理（创建/编辑/复制/删除/设为首选/重名校验）
- [ ] **7.8** 上传分析（xlsx/csv/pdf/docx/pzfx/图片 → 解析预览 → 导入实验）
- [ ] **7.9** 知识库（文献添加/经验/对比分析 CRUD）
- [ ] **7.10** 处方管理 + 样本管理 汇总页
- [ ] **7.11** 设置页面（API配置添加/切换/删除 + 模板管理 + 主题切换）
- [ ] **7.12** 退出登录 → 重新登录 → 所有数据完整保留
- [ ] **7.13** 无浏览器控制台表单警告（所有input/select校验通过）
- [ ] **7.14** 无字体乱码、无边框样式丢失、无404请求
- [ ] **7.15** 旧数据迁移工具：localStorage → Turso 批量导入

---

## 检查清单：历史BUG黑名单防回归

| 历史BUG | V2检查项 |
|---------|---------|
| 刷新页面长时白屏 | 并行 Promise.all + 乐观渲染 + DOM缓存 |
| 设置页10s白屏 | 预渲染 + `_pageCache` |
| 编辑实验清空样品/释放数据 | updateExperiment 保留手动数据 |
| 模板切换边框丢失 | `void offsetHeight` 强制 reflow |
| favicon.ico 404阻塞 | `href="data:,"` |
| 字体乱码文字 | visibility hidden + fonts.ready + 3s兜底 |
| app.js语法错误白屏 | 全局 try/catch + 终极兜底HTML |
