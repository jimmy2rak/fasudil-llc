/* ========================================
   lib/turso.js — Turso 数据库连接单例
   V2: 每次请求新建连接（Serverless环境）
   ======================================== */

import { createClient } from '@libsql/client';

let client = null;
let _tablesReady = false;

/**
 * 获取数据库客户端（单例复用）
 * Vercel Serverless Functions 在单个实例内复用连接
 */
function getClient() {
  if (client) return client;

  const provider = process.env.DATABASE_PROVIDER || 'turso';

  if (provider === 'turso') {
    const url = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error('[Turso] TURSO_DATABASE_URL 未设置');
    client = createClient({
      url,
      authToken: token
    });
  } else if (provider === 'sqlite') {
    const url = process.env.DATABASE_URL || 'file:./dev.db';
    client = createClient({ url });
  } else {
    throw new Error(`[Turso] 不支持的数据库提供者: ${provider}`);
  }

  return client;
}

/** 查询多条记录 */
export async function queryAll(sql, ...params) {
  const c = getClient();
  const rs = await c.execute({ sql, args: params });
  return rs.rows;
}

/** 查询单条记录 */
export async function queryFirst(sql, ...params) {
  const rows = await queryAll(sql, ...params);
  return rows.length > 0 ? rows[0] : null;
}

/** 执行写入操作（INSERT/UPDATE/DELETE），返回结果 */
export async function execute(sql, ...params) {
  const c = getClient();
  const rs = await c.execute({ sql, args: params });
  return rs;
}

/** 初始化数据库表（9张表 + 索引） */
export async function initDatabase() {
  console.log('[Turso] 初始化数据库表...');

  // 1. users
  await execute(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);

  // 2. verification_tokens
  await execute(`CREATE TABLE IF NOT EXISTS verification_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'otp',
    used INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_vt_email ON verification_tokens(email)`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_vt_token ON verification_tokens(token)`);

  // 3. experiments
  await execute(`CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    date TEXT DEFAULT '',
    template_id TEXT DEFAULT '',
    formulations TEXT NOT NULL DEFAULT '[]',
    drug_amount REAL DEFAULT 0,
    drug_conc REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_experiments_user ON experiments(user_id)`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_experiments_date ON experiments(date)`);

  // 4. samples
  await execute(`CREATE TABLE IF NOT EXISTS samples (
    id TEXT NOT NULL,
    experiment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    formulation TEXT DEFAULT '',
    formulation_components TEXT DEFAULT '{}',
    formulation_total REAL DEFAULT 0,
    total_drug REAL DEFAULT 0,
    density REAL DEFAULT 0,
    take_volume REAL DEFAULT 0,
    exp_drug_amount REAL DEFAULT 0,
    group_name TEXT DEFAULT '',
    final_rate REAL DEFAULT 0,
    residual_abs REAL DEFAULT 0,
    residual_amount REAL DEFAULT 0,
    residual_rate REAL DEFAULT 0,
    total_recovery REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (id, experiment_id),
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_samples_user ON samples(user_id)`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_samples_experiment ON samples(experiment_id)`);

  // 5. release_data
  await execute(`CREATE TABLE IF NOT EXISTS release_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id TEXT NOT NULL,
    experiment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    time_point TEXT DEFAULT '',
    absorbance REAL DEFAULT 0,
    sample_vol REAL DEFAULT 2,
    total_vol REAL DEFAULT 30,
    concentration REAL DEFAULT 0,
    cumulative_release REAL DEFAULT 0,
    release_rate REAL DEFAULT 0,
    row_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (sample_id, experiment_id) REFERENCES samples(id, experiment_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_release_sample ON release_data(sample_id, experiment_id)`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_release_user ON release_data(user_id)`);

  // 6. reports
  await execute(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id TEXT NOT NULL,
    experiment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT DEFAULT '',
    result TEXT DEFAULT '{}',
    timestamp TEXT NOT NULL,
    FOREIGN KEY (sample_id, experiment_id) REFERENCES samples(id, experiment_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id)`);

  // 7. user_templates
  await execute(`CREATE TABLE IF NOT EXISTS user_templates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    columns TEXT NOT NULL DEFAULT '[]',
    builtin INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_templates_user ON user_templates(user_id)`);

  // 8. user_preferences
  await execute(`CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    default_template_id TEXT DEFAULT 'system_default',
    theme TEXT DEFAULT 'light',
    api_configs TEXT DEFAULT '[]',
    active_api TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // 9. knowledge_entries
  await execute(`CREATE TABLE IF NOT EXISTS knowledge_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'literature',
    title TEXT DEFAULT '',
    content TEXT DEFAULT '{}',
    tags TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_knowledge_user ON knowledge_entries(user_id)`);

  console.log('[Turso] 数据库表初始化完成');
}
