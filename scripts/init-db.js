/* ========================================
   scripts/init-db.js — Turso 数据库建表脚本
   用法: node scripts/init-db.js
   需要环境变量: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
   ======================================== */
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.error('❌ 请设置 TURSO_DATABASE_URL 环境变量');
  process.exit(1);
}

const db = createClient({ url, authToken: token });

const statements = [
  // 1. users 表
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // 2. verification_tokens 表
  `CREATE TABLE IF NOT EXISTS verification_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'otp',
    used INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vt_email ON verification_tokens(email)`,
  `CREATE INDEX IF NOT EXISTS idx_vt_token ON verification_tokens(token)`,

  // 3. user_data 表（所有业务数据以 JSON 存储）
  `CREATE TABLE IF NOT EXISTS user_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    data_type TEXT NOT NULL,
    data_key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ud_user ON user_data(user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ud_lookup ON user_data(user_id, data_type, data_key)`,
];

async function main() {
  console.log('🚀 开始初始化数据库表...\n');

  for (const sql of statements) {
    try {
      await db.execute(sql);
      const label = sql.split('\n')[0].replace(/CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX)\s+(IF NOT EXISTS\s+)?/i, '').trim();
      console.log(`  ✅ ${label}`);
    } catch (err) {
      console.log(`  ❌ ${err.message}`);
    }
  }

  console.log('\n📋 验证表结构...');
  const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  for (const row of tables.rows) {
    console.log(`  ✅ 表: ${row.name}`);
  }

  console.log('\n🎉 数据库初始化完成！');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ 初始化失败:', err.message);
  process.exit(1);
});
