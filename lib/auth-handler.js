/* ========================================
   lib/auth-handler.js — 认证逻辑合并
   JWT + OTP + Brevo + 路由处理
   ======================================== */
import { SignJWT, jwtVerify } from 'jose';
import * as crypto from 'crypto';
import { createClient } from '@libsql/client';

// ========== 数据库连接 ==========
let _client = null;
function getDB() {
  if (_client) return _client;
  const provider = process.env.DATABASE_PROVIDER || 'turso';
  if (provider === 'turso') {
    const url = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error('[DB] TURSO_DATABASE_URL 未设置');
    _client = createClient({ url, authToken: token });
  } else {
    const url = process.env.DATABASE_URL || 'file:./dev.db';
    _client = createClient({ url });
  }
  return _client;
}

export async function queryAll(sql, ...params) {
  const c = getDB();
  const rs = await c.execute({ sql, args: params });
  return rs.rows;
}

export async function queryFirst(sql, ...params) {
  const rows = await queryAll(sql, ...params);
  return rows.length > 0 ? rows[0] : null;
}

export async function execute(sql, ...params) {
  const c = getDB();
  return await c.execute({ sql, args: params });
}

// ========== 数据库初始化 ==========
let _dbReady = false;
export async function ensureDB() {
  if (_dbReady) return;
  await initDatabase();
  _dbReady = true;
}

async function initDatabase() {
  await execute(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS verification_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, token TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'otp', used INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY, default_template_id TEXT DEFAULT 'system_default',
    theme TEXT DEFAULT 'light', api_configs TEXT DEFAULT '[]', active_api TEXT DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
}

// ========== JWT ==========
function getJWTSecret() {
  const secret = process.env.JWT_SECRET || 'fasudil-llc-v2-fallback-secret-2026';
  return new TextEncoder().encode(secret);
}

async function signJWT(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(getJWTSecret());
}

async function verifyJWT(token) {
  try {
    const { payload } = await jwtVerify(token, getJWTSecret());
    return payload;
  } catch { return null; }
}

// ========== Cookie ==========
function setAuthCookie(res, token) {
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const secure = isProd ? ' Secure;' : '';
  res.headers.set('Set-Cookie',
    `auth_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7*24*60*60};${secure}`);
}

function clearAuthCookie(res) {
  res.headers.set('Set-Cookie',
    'auth_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

export async function getUserFromCookie(req) {
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(/auth_token=([^;]+)/);
  if (!match) return null;
  return verifyJWT(match[1]);
}

// ========== 响应工具 ==========
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
export function errorResponse(msg, status = 400) { return jsonResponse({ success: false, error: msg }, status); }
export function successResponse(data, status = 200) { return jsonResponse({ success: true, data }, status); }

// ========== OTP ==========
function generateOTP() {
  const buf = crypto.randomBytes(4);
  return String(buf.readUInt32BE(0) % 1000000).padStart(6, '0');
}

async function createOTP(email) {
  await execute('UPDATE verification_tokens SET used = 1 WHERE email = ? AND used = 0', email);
  const token = generateOTP();
  const now = Date.now();
  await execute(
    'INSERT INTO verification_tokens (email, token, type, used, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)',
    email, token, 'otp', now + 10*60*1000, now
  );
  return token;
}

async function consumeOTP(email, token) {
  const record = await queryFirst(
    'SELECT * FROM verification_tokens WHERE email = ? AND token = ? AND type = ? AND used = 0',
    email, token, 'otp'
  );
  if (!record || Date.now() > record.expires_at) return false;
  await execute('UPDATE verification_tokens SET used = 1 WHERE id = ?', record.id);
  return true;
}

// ========== Brevo 邮件 ==========
async function sendOTPEmail(email, otp) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'noreply@fasudil-llc.app';
  if (!apiKey) return { success: false, message: '邮件服务未配置' };
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { email: senderEmail, name: 'Fasudil-LLC Analyzer' },
        to: [{ email }],
        subject: '您的登录验证码',
        htmlContent: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#1e3a5f">Fasudil-LLC Analyzer</h2>
          <p>您的登录验证码为：</p>
          <div style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:20px;background:#f4f6f8;border-radius:8px;margin:16px 0;color:#1e3a5f">${otp}</div>
          <p style="color:#666">验证码有效期为 10 分钟，请尽快登录。</p>
        </div>`
      })
    });
    if (!res.ok) return { success: false, message: `邮件发送失败 (${res.status})` };
    return { success: true };
  } catch (e) {
    return { success: false, message: '邮件服务网络错误' };
  }
}

// ========== 路由处理 ==========
export async function handleAuth(path, req) {
  await ensureDB();

  // GET /api/auth/me
  if (path === 'me' && req.method === 'GET') {
    const payload = await getUserFromCookie(req);
    if (!payload) return errorResponse('未登录', 401);
    const user = await queryFirst('SELECT id, email, name FROM users WHERE id = ?', payload.sub);
    if (!user) return errorResponse('用户不存在', 401);
    return jsonResponse({ success: true, data: { id: user.id, email: user.email, name: user.name } });
  }

  // GET/POST /api/auth/logout
  if (path === 'logout') {
    const res = new Response(null, { status: 302, headers: { Location: '/' } });
    clearAuthCookie(res);
    return res;
  }

  // POST /api/auth/otp/send
  if (path === 'otp/send' && req.method === 'POST') {
    const body = await req.json();
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return errorResponse('请输入有效邮箱');
    const otp = await createOTP(email);
    const result = await sendOTPEmail(email, otp);
    if (!result.success) return errorResponse(result.message || '邮件发送失败');
    return jsonResponse({ success: true, data: { sent: true } });
  }

  // POST /api/auth/otp/verify
  if (path === 'otp/verify' && req.method === 'POST') {
    const body = await req.json();
    const email = (body.email || '').trim().toLowerCase();
    const otp = (body.otp || '').trim();
    if (!email || !otp) return errorResponse('邮箱和验证码不能为空');
    const valid = await consumeOTP(email, otp);
    if (!valid) return errorResponse('验证码无效或已过期');

    let user = await queryFirst('SELECT id, email, name FROM users WHERE email = ?', email);
    if (!user) {
      const now = Date.now();
      const userId = 'user-' + now + '-' + Math.random().toString(36).slice(2, 7);
      await execute('INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        userId, email, email.split('@')[0], now, now);
      await execute('INSERT INTO user_preferences (user_id, default_template_id, theme, api_configs, active_api, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        userId, 'system_default', 'light', '[]', '', now, now);
      user = { id: userId, email, name: email.split('@')[0] };
    }

    const token = await signJWT({ sub: user.id, email: user.email });
    const res = jsonResponse({ success: true, data: { user: { id: user.id, email: user.email, name: user.name } } });
    setAuthCookie(res, token);
    return res;
  }

  return errorResponse('认证接口不存在', 404);
}
