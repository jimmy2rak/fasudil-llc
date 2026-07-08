/* ========================================
   api/lib/auth-utils.js — 认证工具库
   JWT 签发/验证 + Cookie 管理
   ======================================== */
import { SignJWT, jwtVerify } from 'jose';

/** 获取 JWT 密钥 */
function getJWTSecret() {
  const secret = process.env.JWT_SECRET
    || 'fasudil-llc-v2-fallback-secret-2026';
  return new TextEncoder().encode(secret);
}

/** 签发 JWT (HS256, 7天过期) */
export async function signJWT(payload) {
  const secret = getJWTSecret();
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(secret);
  return token;
}

/** 验证 JWT，返回 payload 或 null */
export async function verifyJWT(token) {
  try {
    const secret = getJWTSecret();
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

/** 设置 auth_token HttpOnly Cookie */
export function setAuthCookie(res, token) {
  const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const secureFlag = isProduction ? ' Secure;' : '';
  res.headers.set('Set-Cookie',
    `auth_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60};${secureFlag}`
  );
}

/** 清除 auth_token Cookie */
export function clearAuthCookie(res) {
  res.headers.set('Set-Cookie',
    'auth_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
  );
}

/** 从请求 Cookie 中解析用户 */
export async function getUserFromCookie(req) {
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(/auth_token=([^;]+)/);
  if (!match) return null;
  const payload = await verifyJWT(match[1]);
  return payload;
}

/** JSON 响应辅助 */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
    }
  });
}

/** 错误响应辅助 */
export function errorResponse(message, status = 400) {
  return jsonResponse({ success: false, error: message }, status);
}

/** 成功响应辅助 */
export function successResponse(data, status = 200) {
  return jsonResponse({ success: true, data }, status);
}
