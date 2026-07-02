/* ========================================
   auth/db.js — Turso 数据库客户端
   建表初始化 + 通用查询/写入函数
   ======================================== */
import { createClient } from '@libsql/client';

let client = null;

function getClient() {
  if (client) return client;

  const provider = process.env.DATABASE_PROVIDER || 'sqlite';

  if (provider === 'turso') {
    const url = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error('[db] TURSO_DATABASE_URL 未设置');
    client = createClient({ url, authToken: token });
  } else if (provider === 'sqlite') {
    const url = process.env.DATABASE_URL || 'file:./dev.db';
    client = createClient({ url });
  } else {
    throw new Error(`[db] 不支持的数据库提供者: ${provider}，请设置 DATABASE_PROVIDER=turso 或 sqlite`);
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

/** 初始化数据库表 */
export async function initDatabase() {
  await execute(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await execute(`CREATE TABLE IF NOT EXISTS verification_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'otp',
    used INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_vt_email ON verification_tokens(email)`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_vt_token ON verification_tokens(token)`);

  await execute(`CREATE TABLE IF NOT EXISTS user_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    data_type TEXT NOT NULL,
    data_key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_ud_user ON user_data(user_id)`);
  await execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ud_lookup ON user_data(user_id, data_type, data_key)`);

  console.log('[db] 数据库表初始化完成');
}
