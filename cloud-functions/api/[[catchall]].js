/* ========================================
   cloud-functions/api/[[catchall]].js
   EdgeOne Cloud Functions — 全部 API 路由处理
   路由: /api/auth/*, /api/data/*, /api/proxy
   ======================================== */
import { initDatabase, queryFirst, execute } from '../../auth/db.js';
import { signJWT, verifyJWT, setAuthCookie, clearAuthCookie } from '../../auth/auth-utils.js';
import { sendOTPEmail } from '../../auth/brevo.js';
import { createOTP, consumeOTP } from '../../auth/otp.js';

// 有效 data_type 列表
const VALID_TYPES = ['experiment', 'report', 'knowledge', 'prescription', 'sample', 'settings', 'rules', 'calculation', 'app_state'];

// ===================== 工具函数 =====================

/** 读取请求体 JSON */
async function readJSON(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** JSON 响应（含无缓存头，防止 EdgeOne CDN 缓存带会话的数据） */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    }
  });
}

/** 从 Cookie 获取 JWT 用户 */
async function getUserFromRequest(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/auth_token=([^;]+)/);
  if (!match) return null;
  try {
    const payload = await verifyJWT(decodeURIComponent(match[1]));
    return payload;
  } catch {
    return null;
  }
}

/** 设置 Cookie 头 */
function setCookieHeader(cookieStr) {
  return new Headers({
    'Set-Cookie': cookieStr,
    'Content-Type': 'application/json; charset=utf-8'
  });
}

// ===================== 数据库初始化 =====================
let dbInitialized = false;

async function ensureDB() {
  if (!dbInitialized) {
    try {
      await initDatabase();
      dbInitialized = true;
    } catch (err) {
      console.error('[DB] 初始化失败:', err.message);
    }
  }
}

// ===================== 路由处理器 =====================

async function handleSendOTP(request) {
  const body = await readJSON(request);
  const email = body?.email;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: '请输入有效的邮箱地址' }, 400);
  }
  try {
    await ensureDB();
    const otp = await createOTP(email);
    const result = await sendOTPEmail(email, otp);
    if (!result.success) {
      return json({ error: result.message || '邮件发送失败' }, 500);
    }
    return json({ success: true, message: '验证码已发送到您的邮箱' });
  } catch (err) {
    console.error('[SendOTP]', err);
    return json({ error: '发送验证码失败' }, 500);
  }
}

async function handleVerifyOTP(request) {
  const body = await readJSON(request);
  const email = body?.email;
  const otp = body?.otp;
  if (!email || !otp) {
    return json({ error: '请提供邮箱和验证码' }, 400);
  }
  try {
    await ensureDB();
    const valid = await consumeOTP(email, otp);
    if (!valid) {
      return json({ error: '验证码无效或已过期，请重新获取' }, 401);
    }
    let user = await queryFirst('SELECT * FROM users WHERE email = ?', email);
    if (!user) {
      const id = crypto.randomUUID();
      await execute('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', id, email, email.split('@')[0]);
      user = { id, email, name: email.split('@')[0] };
    }
    const token = await signJWT({ userId: user.id, email: user.email, sub: user.id });
    const cookie = `auth_token=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
    return new Response(JSON.stringify({
      success: true,
      user: { id: user.id, email: user.email, name: user.name }
    }), {
      status: 200,
      headers: setCookieHeader(cookie)
    });
  } catch (err) {
    console.error('[VerifyOTP]', err);
    return json({ error: '验证失败' }, 500);
  }
}

async function handleGetMe(request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: '未登录' }, 401);
  try {
    await ensureDB();
    const dbUser = await queryFirst('SELECT id, email, name FROM users WHERE id = ?', user.userId || user.sub);
    if (!dbUser) return json({ error: '用户不存在' }, 401);
    return json({ user: { id: dbUser.id, email: dbUser.email, name: dbUser.name } });
  } catch (err) {
    return json({ error: '查询失败' }, 500);
  }
}

/** 退出登录：清除 Cookie 后重定向到首页（支持 GET 和 POST） */
function handleLogout() {
  const headers = new Headers({
    'Set-Cookie': 'auth_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0',
    'Location': '/',
    'Content-Type': 'text/plain; charset=utf-8'
  });
  return new Response('Logged out', {
    status: 302,  // 重定向，浏览器原生跟随
    headers
  });
}

// ===================== 数据 CRUD =====================

async function handleDataGET(request, type, key) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: '未登录' }, 401);
  const userId = user.userId || user.sub;
  try {
    await ensureDB();
    if (key) {
      const record = await queryFirst(
        'SELECT * FROM user_data WHERE user_id = ? AND data_type = ? AND data_key = ?',
        userId, type, key
      );
      if (!record) return json({ data: null }); // 无数据返回200+null（替代404，前端不需要处理404）
      return json({ id: record.data_key, type: record.data_type, data: JSON.parse(record.value) });
    }
    const records = await queryAll(
      'SELECT * FROM user_data WHERE user_id = ? AND data_type = ? ORDER BY updated_at DESC',
      userId, type
    );
    const items = records.map(r => ({
      id: r.data_key, type: r.data_type, data: JSON.parse(r.value),
      createdAt: r.created_at, updatedAt: r.updated_at
    }));
    return json({ items });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

async function handleDataPOST(request, type) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: '未登录' }, 401);
  const userId = user.userId || user.sub;
  const body = await readJSON(request);
  if (!body || !body.key || body.value === undefined) {
    return json({ error: '缺少必填字段: key, value' }, 400);
  }
  try {
    await ensureDB();
    await execute(
      `INSERT INTO user_data (user_id, data_type, data_key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(user_id, data_type, data_key)
       DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      userId, type, body.key, JSON.stringify(body.value)
    );
    return json({ success: true, id: body.key, type });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

async function handleDataPUT(request, type, key) {
  if (!key) return json({ error: '缺少 data_key' }, 400);
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: '未登录' }, 401);
  const userId = user.userId || user.sub;
  const body = await readJSON(request);
  if (!body || body.value === undefined) return json({ error: '缺少 value' }, 400);
  try {
    await ensureDB();
    const existing = await queryFirst(
      'SELECT id FROM user_data WHERE user_id = ? AND data_type = ? AND data_key = ?',
      userId, type, key
    );
    if (!existing) {
      await execute(
        `INSERT INTO user_data (user_id, data_type, data_key, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
        userId, type, key, JSON.stringify(body.value)
      );
    } else {
      await execute(
        "UPDATE user_data SET value = ?, updated_at = datetime('now') WHERE user_id = ? AND data_type = ? AND data_key = ?",
        JSON.stringify(body.value), userId, type, key
      );
    }
    return json({ success: true, id: key, type });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

async function handleDataDELETE(request, type, key) {
  if (!key) return json({ error: '缺少 data_key' }, 400);
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: '未登录' }, 401);
  const userId = user.userId || user.sub;
  try {
    await ensureDB();
    await execute(
      'DELETE FROM user_data WHERE user_id = ? AND data_type = ? AND data_key = ?',
      userId, type, key
    );
    return json({ success: true });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

// ===================== AI API 代理 =====================

async function handleProxy(request) {
  const body = await readJSON(request);
  if (!body || !body.targetUrl) return json({ error: 'Missing targetUrl' }, 400);
  try {
    const proxyRes = await fetch(body.targetUrl, {
      method: 'POST',
      headers: body.headers || {},
      body: typeof body.body === 'string' ? body.body : JSON.stringify(body.body)
    });
    const responseBody = await proxyRes.text();
    return new Response(responseBody, {
      status: proxyRes.status,
      headers: {
        'Content-Type': proxyRes.headers.get('content-type') || 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return json({ error: 'Proxy request failed', message: err.message }, 502);
  }
}

// ===================== 主入口 =====================

/**
 * 路由分发 — 所有 /api/* 请求由此处理
 * context.params.catchall 包含 URL 路径段数组
 * 例如 /api/auth/otp/send → ['auth', 'otp', 'send']
 */
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const method = request.method;
  const segments = context.params?.catchall || [];

  // CORS 预检
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  try {
    // === Auth 路由 ===
    // POST /api/auth/otp/send
    if (segments.length === 3 && segments[0] === 'auth' && segments[1] === 'otp' && segments[2] === 'send' && method === 'POST') {
      return handleSendOTP(request);
    }
    // POST /api/auth/otp/verify
    if (segments.length === 3 && segments[0] === 'auth' && segments[1] === 'otp' && segments[2] === 'verify' && method === 'POST') {
      return handleVerifyOTP(request);
    }
    // GET /api/auth/me
    if (segments.length === 2 && segments[0] === 'auth' && segments[1] === 'me' && method === 'GET') {
      return handleGetMe(request);
    }
    // POST /api/auth/logout 或 GET /api/auth/logout（浏览器直接跳转）
    if (segments.length === 2 && segments[0] === 'auth' && segments[1] === 'logout' && (method === 'POST' || method === 'GET')) {
      return handleLogout();
    }

    // === Data CRUD 路由 ===
    // /api/data/:type 或 /api/data/:type/:key
    if (segments.length >= 2 && segments[0] === 'data') {
      const type = segments[1];
      const key = segments.length >= 3 ? segments.slice(2).join('/') : null;

      if (!VALID_TYPES.includes(type)) {
        return json({ error: `不支持的数据类型: ${type}` }, 400);
      }

      switch (method) {
        case 'GET': return handleDataGET(request, type, key);
        case 'POST': return handleDataPOST(request, type);
        case 'PUT': return handleDataPUT(request, type, key);
        case 'DELETE': return handleDataDELETE(request, type, key);
        default: return json({ error: '不支持的请求方法' }, 405);
      }
    }

    // === AI API 代理 ===
    if (segments.length === 1 && segments[0] === 'proxy' && method === 'POST') {
      return handleProxy(request);
    }

    // 未知路由
    return json({ error: 'Not Found', path: segments.join('/') }, 404);

  } catch (err) {
    console.error('[API] 未捕获错误:', err);
    return json({ error: 'Internal Server Error', message: err.message }, 500);
  }
}
