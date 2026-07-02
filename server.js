/* ========================================
   server.js — 本地开发服务器
   ⚠️ 仅用于本地测试。生产环境部署到 EdgeOne 后，
   API 请求由 cloud-functions/api/[[catchall]].js 处理
   ======================================== */
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { initDatabase, queryFirst, execute } from './auth/db.js';
import { signJWT, verifyJWT, getUserFromCookie, setAuthCookie, clearAuthCookie } from './auth/auth-utils.js';
import { sendOTPEmail } from './auth/brevo.js';
import { createOTP, consumeOTP } from './auth/otp.js';
import { handleDataRequest } from './api/user-data.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const ROOT = new URL('.', import.meta.url).pathname;

// MIME 类型映射
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.pdf':  'application/pdf',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv':  'text/csv; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
};

// 公开路径（无需 JWT 鉴权）
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/proxy'];

/** 读取请求 body */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** 发送 JSON 响应 */
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** 静态文件服务 */
function serveStatic(req, res) {
  let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);
  filePath = path.resolve(filePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
      }
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      res.end(content);
    }
  });
}

/** AI API 代理 */
async function proxyAIAPI(req, res) {
  const body = await readBody(req);
  let parsedBody;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    json(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const targetUrl = parsedBody.targetUrl;
  const targetHeaders = parsedBody.headers || {};
  const targetBody = parsedBody.body;

  if (!targetUrl) {
    json(res, 400, { error: 'Missing targetUrl' });
    return;
  }

  try {
    const proxyRes = await fetch(targetUrl, {
      method: 'POST',
      headers: targetHeaders,
      body: typeof targetBody === 'string' ? targetBody : JSON.stringify(targetBody)
    });

    const responseBody = await proxyRes.text();
    res.writeHead(proxyRes.status, {
      'Content-Type': proxyRes.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(responseBody);
  } catch (err) {
    json(res, 502, { error: 'Proxy request failed', message: err.message });
  }
}

// =====================
// Auth API 路由处理
// =====================

/** POST /api/auth/otp/send — 发送验证码 */
async function handleSendOTP(req, res) {
  const body = await readBody(req);
  let email;
  try {
    email = JSON.parse(body).email;
  } catch {
    json(res, 400, { error: '无效的请求体' });
    return;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    json(res, 400, { error: '请输入有效的邮箱地址' });
    return;
  }

  try {
    const otp = await createOTP(email);
    const result = await sendOTPEmail(email, otp);

    if (!result.success) {
      json(res, 500, { error: result.message || '邮件发送失败' });
      return;
    }

    json(res, 200, { success: true, message: '验证码已发送到您的邮箱' });
  } catch (err) {
    console.error('[SendOTP] 错误:', err);
    json(res, 500, { error: '发送验证码失败' });
  }
}

/** POST /api/auth/otp/verify — 验证 OTP 并登录 */
async function handleVerifyOTP(req, res) {
  const body = await readBody(req);
  let email, otp;
  try {
    const data = JSON.parse(body);
    email = data.email;
    otp = data.otp;
  } catch {
    json(res, 400, { error: '无效的请求体' });
    return;
  }

  if (!email || !otp) {
    json(res, 400, { error: '请提供邮箱和验证码' });
    return;
  }

  try {
    // 消费 OTP
    const valid = await consumeOTP(email, otp);
    if (!valid) {
      json(res, 401, { error: '验证码无效或已过期，请重新获取' });
      return;
    }

    // 查找或创建用户
    let user = await queryFirst('SELECT * FROM users WHERE email = ?', email);
    if (!user) {
      const id = crypto.randomUUID();
      await execute(
        'INSERT INTO users (id, email, name) VALUES (?, ?, ?)',
        id, email, email.split('@')[0]
      );
      user = { id, email, name: email.split('@')[0] };
    }

    // 签发 JWT
    const token = await signJWT({ userId: user.id, email: user.email, sub: user.id });

    // 设置 Cookie
    setAuthCookie(res, token);

    json(res, 200, {
      success: true,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (err) {
    console.error('[VerifyOTP] 错误:', err);
    json(res, 500, { error: '验证失败' });
  }
}

/** GET /api/auth/me — 获取当前用户 */
async function handleGetMe(req, res) {
  const user = await getUserFromCookie(req);
  if (!user) {
    json(res, 401, { error: '未登录' });
    return;
  }

  const dbUser = await queryFirst('SELECT id, email, name FROM users WHERE id = ?', user.userId || user.sub);
  if (!dbUser) {
    clearAuthCookie(res);
    json(res, 401, { error: '用户不存在' });
    return;
  }

  json(res, 200, {
    user: { id: dbUser.id, email: dbUser.email, name: dbUser.name }
  });
}

/** POST /api/auth/logout — 退出登录 */
function handleLogout(req, res) {
  clearAuthCookie(res);
  json(res, 200, { success: true, message: '已退出登录' });
}

// =====================
// 主请求处理
// =====================

const server = http.createServer(async (req, res) => {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  try {
    // === 1. Auth API 路由 ===
    if (urlPath === '/api/auth/otp/send' && req.method === 'POST') {
      await handleSendOTP(req, res);
      return;
    }
    if (urlPath === '/api/auth/otp/verify' && req.method === 'POST') {
      await handleVerifyOTP(req, res);
      return;
    }
    if (urlPath === '/api/auth/me' && req.method === 'GET') {
      await handleGetMe(req, res);
      return;
    }
    if (urlPath === '/api/auth/logout' && req.method === 'POST') {
      handleLogout(req, res);
      return;
    }

    // === 2. Data CRUD API ===
    if (urlPath.startsWith('/api/data/')) {
      const handled = await handleDataRequest(req, res, urlPath);
      if (handled) return;
    }

    // === 3. AI API 代理 ===
    if (urlPath === '/api/proxy' && req.method === 'POST') {
      await proxyAIAPI(req, res);
      return;
    }

    // === 4. 静态文件（含 JWT 鉴权） ===
    const isPublic = PUBLIC_PATHS.some(p => urlPath.startsWith(p));
    if (!isPublic && !urlPath.match(/\.\w+$/)) {
      // 非公开路径且不是静态资源 → 检查登录
      // 但静态资源（.js/.css/.png 等）直接放行，由前端控制路由
    }

    serveStatic(req, res);
  } catch (err) {
    console.error('[Server] 未捕获错误:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  }
});

// 初始化数据库后启动服务器
async function start() {
  try {
    await initDatabase();
    console.log('[Server] 数据库初始化成功');
  } catch (err) {
    console.warn('[Server] 数据库初始化失败（可能是本地无 Turso），服务器将以静态模式运行:', err.message);
  }

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`✅ Fasudil LLC Analyzer (EdgeOne) 服务器已启动`);
    console.log(`   访问地址: http://localhost:${PORT}`);
    console.log(`   API 端点:`);
    console.log(`     POST /api/auth/otp/send   — 发送验证码`);
    console.log(`     POST /api/auth/otp/verify — 验证登录`);
    console.log(`     GET  /api/auth/me         — 当前用户`);
    console.log(`     POST /api/auth/logout     — 退出登录`);
    console.log(`     GET/POST/PUT/DELETE /api/data/:type  — 数据 CRUD`);
    console.log(`     POST /api/proxy           — AI API 代理`);
    console.log(`   Node.js 版本: ${process.version}`);
  });
}

start();
