/* ========================================
   api/user-data.js — user_data CRUD 路由处理
   所有操作需 JWT 鉴权，自动从 Cookie 解析 user_id
   ======================================== */
import { queryAll, queryFirst, execute } from '../auth/db.js';
import { getUserFromCookie } from '../auth/auth-utils.js';

/** 解析 URL 路径，提取 data_type 和 data_key */
function parsePath(pathname) {
  // /api/data/:type 或 /api/data/:type/:key
  const parts = pathname.split('/').filter(Boolean);
  // parts: ['api', 'data', 'type'] 或 ['api', 'data', 'type', 'key']
  if (parts.length >= 3 && parts[0] === 'api' && parts[1] === 'data') {
    return { type: parts[2], key: parts[3] || null };
  }
  return null;
}

const VALID_TYPES = ['experiment', 'report', 'knowledge', 'prescription', 'sample', 'settings', 'rules', 'calculation'];

/**
 * 处理 /api/data/* 请求
 * @returns {boolean} 是否匹配到此路由
 */
export async function handleDataRequest(req, res, urlPath) {
  // 仅处理 /api/data/ 开头的请求
  if (!urlPath.startsWith('/api/data/')) return false;

  const parsed = parsePath(urlPath);
  if (!parsed) return false;

  const { type, key } = parsed;

  // 验证 data_type 是否合法
  if (!VALID_TYPES.includes(type)) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: `不支持的数据类型: ${type}，可用: ${VALID_TYPES.join(', ')}` }));
    return true;
  }

  // JWT 鉴权
  const user = await getUserFromCookie(req);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '未登录' }));
    return true;
  }
  const userId = user.userId || user.sub;

  try {
    switch (req.method) {
      case 'GET':
        return await handleGET(res, userId, type, key);
      case 'POST':
        return await handlePOST(req, res, userId, type);
      case 'PUT':
        return await handlePUT(req, res, userId, type, key);
      case 'DELETE':
        return await handleDELETE(res, userId, type, key);
      default:
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '不支持的请求方法' }));
        return true;
    }
  } catch (err) {
    console.error(`[data-api] 错误:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '服务器内部错误', message: err.message }));
    return true;
  }
}

/** GET /api/data/:type 或 /api/data/:type/:key */
async function handleGET(res, userId, type, key) {
  if (key) {
    // 获取单条
    const record = await queryFirst(
      'SELECT * FROM user_data WHERE user_id = ? AND data_type = ? AND data_key = ?',
      userId, type, key
    );
    if (!record) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '数据不存在' }));
      return true;
    }
    const data = JSON.parse(record.value);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ id: record.data_key, type: record.data_type, data }));
    return true;
  }

  // 获取全部
  const records = await queryAll(
    'SELECT * FROM user_data WHERE user_id = ? AND data_type = ? ORDER BY updated_at DESC',
    userId, type
  );
  const items = records.map(r => ({
    id: r.data_key,
    type: r.data_type,
    data: JSON.parse(r.value),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ items }));
  return true;
}

/** POST /api/data/:type — 创建/覆盖 */
async function handlePOST(req, res, userId, type) {
  const body = await readJSON(req);
  const { key, value } = body;
  if (!key || !value) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '缺少必填字段: key, value' }));
    return true;
  }

  // UPSERT: INSERT OR REPLACE
  await execute(
    `INSERT INTO user_data (user_id, data_type, data_key, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(user_id, data_type, data_key)
     DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    userId, type, key, JSON.stringify(value)
  );

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: true, id: key, type }));
  return true;
}

/** PUT /api/data/:type/:key — 更新 */
async function handlePUT(req, res, userId, type, key) {
  if (!key) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '缺少 data_key' }));
    return true;
  }

  const body = await readJSON(req);
  const { value } = body;
  if (value === undefined) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '缺少必填字段: value' }));
    return true;
  }

  const existing = await queryFirst(
    'SELECT id FROM user_data WHERE user_id = ? AND data_type = ? AND data_key = ?',
    userId, type, key
  );

  if (!existing) {
    // 不存在则创建
    await execute(
      `INSERT INTO user_data (user_id, data_type, data_key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      userId, type, key, JSON.stringify(value)
    );
  } else {
    await execute(
      'UPDATE user_data SET value = ?, updated_at = datetime(\'now\') WHERE user_id = ? AND data_type = ? AND data_key = ?',
      JSON.stringify(value), userId, type, key
    );
  }

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: true, id: key, type }));
  return true;
}

/** DELETE /api/data/:type/:key */
async function handleDELETE(res, userId, type, key) {
  if (!key) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '缺少 data_key' }));
    return true;
  }

  await execute(
    'DELETE FROM user_data WHERE user_id = ? AND data_type = ? AND data_key = ?',
    userId, type, key
  );

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: true }));
  return true;
}

/** 辅助：从请求流中读取 JSON body */
function readJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('请求体不是有效的 JSON'));
      }
    });
    req.on('error', reject);
  });
}
