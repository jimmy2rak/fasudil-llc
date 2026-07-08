# Fasudil-LLC Analyzer V2 — 整体架构分析文档

> 版本：v2.0.0
> 重构方向：本地存储 → 云端数据库；本地文件系统 → 纯API驱动；EdgeOne → Vercel + Cloudflare

---

## 一、整体技术栈架构

### 1.1 前后端架构

```
┌─────────────────────────────────────────────────┐
│                  前端 SPA                        │
│    index.html + app.js + experiment-cards.js     │
│    Material Icons Outlined / Chart.js / SheetJS  │
│         无框架纯原生JS · 部署 Vercel Static       │
├─────────────────────────────────────────────────┤
│            Vercel Serverless Functions           │
│    API 路由层：/api/auth/* + /api/data/*         │
│    Node.js 18+ ESM · 自动集成 CI/CD             │
├─────────────────────────────────────────────────┤
│                  Turso 数据库                    │
│    SQLite 兼容 · 边缘部署 · 全球低延迟           │
│    8张业务表 · 用户UID外键隔离                   │
└─────────────────────────────────────────────────┘
```

**架构类型**：前后端同构（同一项目目录部署），前端静态 + 后端 Serverless Functions

### 1.2 依赖复用说明

| 模块 | 来源 | V2处理方式 |
|------|------|-----------|
| `libs/xlsx.full.min.js` | 原项目 | 直接拷贝，无需重装 |
| `libs/chart.umd.js` | 原项目 | 直接拷贝，无需重装 |
| `libs/pdf.min.js` + worker | 原项目 | 直接拷贝，无需重装 |
| `libs/mammoth.min.js` | 原项目 | 直接拷贝，无需重装 |
| `js/calc.js` | 原项目 | 直接拷贝，零修改 |
| `js/charts.js` | 原项目 | 直接拷贝，零修改 |
| `js/ui.js` | 原项目 | 直接拷贝，零修改 |
| `js/ml.js` | 原项目 | 直接拷贝，零修改 |
| `js/parser.js` | 原项目 | 直接拷贝，零修改 |
| `css/app.css` | 原项目 | 直接拷贝，零修改 |
| `js/experiment-cards-data.js` | 原项目 | **完全重写**：localStorage → Turso API |
| `js/experiment-cards.js` | 原项目 | **改造**：同步接口 → 异步API调用 |
| `js/app.js` | 原项目 | **完全重写**：去FSManager依赖 |
| `server.js` | 原项目 | **废弃**：由Vercel Functions替代 |
| `fs-manager.js` | 原项目 | **废弃**：File System API不再需要 |

**npm依赖（仅2个包）**：
- `@libsql/client` — Turso数据库连接
- `jose` — JWT签发验证（复用EdgeOne认证体系）
- `nodemailer` — 邮件发送（可选，适配非Brevo方案时）

### 1.3 Vercel Functions 与 EdgeOne Cloud Functions 差异

| 维度 | EdgeOne | Vercel |
|------|---------|--------|
| 路由定义 | `[[catchall]].js` 捕获通配 | 文件系统路由：`api/xxx.js` |
| 请求/响应 | Web API（Request/Response） | Node.js + Web API 混合 |
| 部署 | 手动 GitHub Action | Git Push 自动触发 |
| 冷启动 | 较快 | 较快 |
| 限制 | 10s执行时间 | 10s maxDuration（可配置） |
| 静态资源 | EdgeOne边缘节点 | Vercel Edge Network |

---

## 二、Turso数据库表结构设计

### 2.1 核心设计原则

1. **用户UID隔离**：所有业务表通过 `user_id` 外键关联用户，数据按用户独立访问
2. **CASCADE删除**：删除实验组时自动级联删除关联样品、释放数据、报告
3. **JSON字段**：非频繁查询的结构化数据（如配方components、报告result）存储为JSON文本
4. **时间戳统一**：使用 Unix 毫秒时间戳（INTEGER）避免时区问题
5. **索引覆盖**：每个表至少一个用户级索引

### 2.2 完整建表SQL

```sql
-- ============================================================
-- 表1: users — 用户账号
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- 用户UID: user-{timestamp}-{random}
  email TEXT UNIQUE NOT NULL,     -- 登录邮箱
  name TEXT DEFAULT '',           -- 显示名称
  created_at INTEGER NOT NULL,    -- 创建时间戳(ms)
  updated_at INTEGER NOT NULL     -- 更新时间戳(ms)
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================
-- 表2: verification_tokens — OTP验证码
-- ============================================================
CREATE TABLE IF NOT EXISTS verification_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token TEXT NOT NULL,            -- 6位数字验证码
  type TEXT NOT NULL DEFAULT 'otp',
  used INTEGER NOT NULL DEFAULT 0, -- 0=未使用 1=已使用
  expires_at INTEGER NOT NULL,     -- 过期时间戳(ms)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vt_email ON verification_tokens(email);
CREATE INDEX IF NOT EXISTS idx_vt_token ON verification_tokens(token);

-- ============================================================
-- 表3: experiments — 实验组
-- ============================================================
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,               -- exp-{timestamp}-{random}
  user_id TEXT NOT NULL,             -- 用户UID
  name TEXT NOT NULL,                -- 实验组名称
  date TEXT DEFAULT '',              -- 实验日期
  template_id TEXT DEFAULT '',       -- 使用的模板ID
  formulations TEXT NOT NULL DEFAULT '[]',  -- JSON: 处方数组
  drug_amount REAL DEFAULT 0,        -- 总加入药量(mg)
  drug_conc REAL DEFAULT 0,          -- 平均载药浓度(mg/ml)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_experiments_user ON experiments(user_id);
CREATE INDEX IF NOT EXISTS idx_experiments_date ON experiments(date);

-- ============================================================
-- 表4: samples — 样品
-- ============================================================
CREATE TABLE IF NOT EXISTS samples (
  id TEXT NOT NULL,                   -- 样品ID
  experiment_id TEXT NOT NULL,        -- 所属实验组
  user_id TEXT NOT NULL,              -- 用户UID
  formulation TEXT DEFAULT '',        -- 处方名称
  formulation_components TEXT DEFAULT '{}',  -- JSON: 处方组分
  formulation_total REAL DEFAULT 0,   -- 处方总重(g)
  total_drug REAL DEFAULT 0,          -- 总药量(mg)
  density REAL DEFAULT 0,             -- 密度(g/ml)
  take_volume REAL DEFAULT 0,         -- 取用体积(μL)
  exp_drug_amount REAL DEFAULT 0,     -- 实验药量(mg)
  group_name TEXT DEFAULT '',         -- 所属组名
  final_rate REAL DEFAULT 0,         -- 最终释放率(%)
  residual_abs REAL DEFAULT 0,       -- 残留吸光度
  residual_amount REAL DEFAULT 0,    -- 残留药量(mg)
  residual_rate REAL DEFAULT 0,      -- 残留率(%)
  total_recovery REAL DEFAULT 0,     -- 总回收率(%)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (id, experiment_id),
  FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_samples_user ON samples(user_id);
CREATE INDEX IF NOT EXISTS idx_samples_experiment ON samples(experiment_id);

-- ============================================================
-- 表5: release_data — 释放曲线数据
-- ============================================================
CREATE TABLE IF NOT EXISTS release_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  time_point TEXT DEFAULT '',         -- 时间点(可含单位)
  absorbance REAL DEFAULT 0,         -- 吸光度
  sample_vol REAL DEFAULT 2,         -- 取样体积(mL)
  total_vol REAL DEFAULT 30,         -- 总体积(mL)
  concentration REAL DEFAULT 0,      -- 自动计算浓度(μg/mL)
  cumulative_release REAL DEFAULT 0, -- 自动计算累计释放量(mg)
  release_rate REAL DEFAULT 0,       -- 自动计算释放率(%)
  row_order INTEGER NOT NULL DEFAULT 0, -- 行顺序：0索引
  FOREIGN KEY (sample_id, experiment_id) REFERENCES samples(id, experiment_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_release_sample ON release_data(sample_id, experiment_id);
CREATE INDEX IF NOT EXISTS idx_release_user ON release_data(user_id);

-- ============================================================
-- 表6: reports — 分析报告
-- ============================================================
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT DEFAULT '',
  result TEXT DEFAULT '{}',          -- JSON: 报告完整内容
  timestamp TEXT NOT NULL,           -- 时间戳: ISO字符串
  FOREIGN KEY (sample_id, experiment_id) REFERENCES samples(id, experiment_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);

-- ============================================================
-- 表7: user_templates — 用户自定义模板
-- ============================================================
CREATE TABLE IF NOT EXISTS user_templates (
  id TEXT PRIMARY KEY,               -- tpl-{timestamp}-{random}
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  columns TEXT NOT NULL DEFAULT '[]', -- JSON: 列定义数组
  builtin INTEGER DEFAULT 0,         -- 0=自定义 1=内置(不进DB)
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_templates_user ON user_templates(user_id);

-- ============================================================
-- 表8: user_preferences — 用户偏好设置
-- ============================================================
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  default_template_id TEXT DEFAULT 'system_default',
  theme TEXT DEFAULT 'light',
  api_configs TEXT DEFAULT '[]',      -- JSON: API配置数组
  active_api TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 表9: knowledge_entries — 知识库条目
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'literature',  -- literature/experience/comparison
  title TEXT DEFAULT '',
  content TEXT DEFAULT '{}',          -- JSON: 完整数据
  tags TEXT DEFAULT '[]',             -- JSON: 标签数组
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_knowledge_user ON knowledge_entries(user_id);
```

---

## 三、前端页面路由架构 & 鉴权

### 3.1 页面路由（8页）

| 路由路径 | 页面名称 | 数据来源 | 页面说明 |
|----------|---------|---------|---------|
| `/dashboard` | 首页总览 | `/api/data/experiments` | 统计卡片+最近实验列表 |
| `/upload` | 上传分析 | 本地文件+`/api/data/experiments` | 文件解析+导入实验 |
| `/experiments` | 实验记录 | `/api/data/experiments` | 卡片网格+样品总览 |
| `/tools` | 小工具 | 纯前端计算(Calc模块) | 6个计算器 |
| `/knowledge` | 知识库 | `/api/data/knowledge` | 文献/经验/对比 |
| `/prescription` | 处方管理 | `/api/data/experiments` | 处方汇总表 |
| `/sample` | 样本管理 | `/api/data/samples` | 样品汇总表 |
| `/settings` | 设置 | `/api/data/preferences` + `/api/data/templates` | API配置+模板管理 |

### 3.2 鉴权流程

```
页面加载
    │
    ├─ localStorage 有 auth_user ? ──→ 乐观显示主应用骨架
    │       │                                │
    │       │                        并行发起 Promise.all：
    │       │                          ├─ fetch('/api/auth/me')
    │       │                          ├─ 模板缓存预加载
    │       │                          └─ ML规则加载
    │       │                                │
    │       ├─ 鉴权通过 (200) ─────────→ 预渲染所有页面 → 导航首页
    │       │
    │       └─ 鉴权失败 (401) ────────→ forceLogout()
    │                                        │
    └─ 无 auth_user ──────────────────→ 显示登录页
                                                │
                                          OTP登录流程：
                                          1. 输入邮箱 → POST /api/auth/otp/send
                                          2. 输入6位码 → POST /api/auth/otp/verify
                                          3. 成功 → 写入 auth_user → 刷新页面
```

### 3.3 首屏渲染优化（根治白屏）

| 优化项 | 方案 | 效果 |
|--------|------|------|
| 接口串行 | `Promise.all` 并行发起 | 减少白屏50ms→10ms |
| DOM重建 | `_pageCache` 只切display | 页面切换0ms |
| 模板查询 | `queueMicrotask`异步 + 全局缓存 | 弹窗即开 |
| 字体加载 | preconnect + preload + visibility hidden | 杜绝乱码 |
| favicon | `href="data:,"` | 消除404阻塞 |
| 崩溃兜底 | 全局 try/catch + 终极兜底HTML | 永不白屏 |

---

## 四、GitHub + Vercel CI/CD 自动部署

### 4.1 Vercel配置（vercel.json）

```json
{
  "version": 2,
  "buildCommand": null,
  "outputDirectory": ".",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/libs/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/js/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/css/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ],
  "functions": {
    "api/**/*.js": {
      "maxDuration": 10
    }
  },
  "env": {
    "TURSO_DATABASE_URL": "@turso_database_url",
    "TURSO_AUTH_TOKEN": "@turso_auth_token",
    "JWT_SECRET": "@jwt_secret",
    "BREVO_API_KEY": "@brevo_api_key",
    "BREVO_SENDER_EMAIL": "@brevo_sender_email"
  }
}
```

### 4.2 自动部署流程

```
Git Push → GitHub仓库更新
    → Vercel检测到main分支变更
    → Vercel自动运行：npm install（仅/api目录）
    → 部署静态资源（index.html, css/, js/, libs/）
    → 部署Serverless Functions（api/*.js）
    → 更新边缘节点CDN
    → 域名(fasudil.yourdomain.com)上线
```

---

## 五、Cloudflare域名接入方案

### 5.1 DNS解析

1. 登录 Cloudflare Dashboard → 选择域名
2. DNS → Records → Add Record
3. 添加 CNAME 记录：

| Type | Name | Target | Proxy Status | TTL |
|------|------|--------|-------------|-----|
| CNAME | fasudil | cname.vercel-dns.com | Proxied (橙色云朵) | Auto |

### 5.2 SSL/TLS配置

1. SSL/TLS → Overview → 选择 **Full (strict)**
2. SSL/TLS → Edge Certificates → 开启 **Always Use HTTPS**
3. 可选：开启 **Automatic HTTPS Rewrites**

### 5.3 缓存策略（Page Rules）

创建5条页面规则：

| 序号 | URL | 设置 |
|------|-----|------|
| 1 | `fasudil.yourdomain.com/libs/*` | Cache Everything + Edge TTL 1 month |
| 2 | `fasudil.yourdomain.com/js/*` | Cache Everything + Edge TTL 1 month |
| 3 | `fasudil.yourdomain.com/css/*` | Cache Everything + Edge TTL 1 month |
| 4 | `fasudil.yourdomain.com/api/*` | Cache Level: Bypass |
| 5 | `fasudil.yourdomain.com/api/*` | Disable Performance: Email Obfuscation, Rocket Loader |

### 5.4 Vercel对接步骤

1. Vercel Dashboard → Project → Settings → Domains
2. 输入 `fasudil.yourdomain.com`
3. Vercel 自动验证 DNS 并分配 Let's Encrypt 证书
4. Cloudflare Full (strict) 自动信任 Vercel 边缘证书

---

## 六、V2核心优化点 & 风险规避

### 6.1 核心优化

| 优化项 | V1问题 | V2方案 |
|--------|--------|--------|
| 数据持久化 | localStorage → 登出丢失 | Turso云端 → UID隔离 |
| 多设备同步 | 不支持 | 同一账号自动同步 |
| 首页加载 | 接口串行+无缓存→10s白屏 | 并行+预缓存→200ms |
| 页面切换 | 重建DOM→卡顿 | DOM缓存→瞬间切换 |
| 模板加载 | 每次弹窗查库→延迟 | 全局缓存→即时 |
| 部署流程 | GitHub Action→EdgeOne | Git Push→Vercel自动 |
| 静态缓存 | 无 | 30天不可变缓存 |
| 安全性 | 无HTTPS强制 | Full(strict)+安全头 |

### 6.2 风险规避

| 风险 | 说明 | 规避措施 |
|------|------|---------|
| FSManager废弃 | File System API本地读写不再可用 | 所有文件操作为API→后端存储 |
| Old数据迁移 | localStorage存量数据 | 提供导入脚本或浏览器工具 |
| Turso连接复用 | Serverless Functions短生命周期 | 每次请求新建连接/连接池 |
| Vercel超时 | 10s执行上限 | 批量操作拆分、索引优化 |
| 文件存储 | 图片/上传文件无本地目录 | Turso存base64或Vercel Blob |
| CORS | Vercel跨域策略 | `credentials: same-origin` + CORS头 |
| 旧数据兼容 | perRow*、expDrugAmount降级 | 保留undefined检测 |
