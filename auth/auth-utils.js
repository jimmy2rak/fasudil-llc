/* ========================================
   auth/auth-utils.js — JWT 签发/验证 + Cookie 工具
   ======================================== */
import { SignJWT, jwtVerify } from 'jose';

/** 获取 JWT 密钥 */
function getJWTSecret() {
  const secret = process.env.JWT_SECRET
    || process.env.NEXTAUTH_SECRET
    || 'fasudil-llc-analyzer-fallback-secret-2026';
  return new TextEncoder().encode(secret);
}

/** 签发 JWT */
export async function signJWT(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(getJWTSecret());
}

/** 验证 JWT，返回 payload 或 null */
export async function verifyJWT(token) {
  try {
    const { payload } = await jwtVerify(token, getJWTSecret());
    return payload;
  } catch {
    return null;
  }
}

/** 设置 auth_token HTTP-only Cookie */
export function setAuthCookie(res, token) {
  const cookie = `auth_token=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
  res.setHeader('Set-Cookie', cookie);
}

/** 清除 auth_token Cookie */
export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'auth_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

/** 从请求 Cookie 中解析用户（中间件用） */
export async function getUserFromCookie(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.auth_token;
  if (!token) return null;
  const payload = await verifyJWT(token);
  return payload || null;
}

function parseCookies(str) {
  const result = {};
  str.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.substring(0, idx).trim();
      const val = pair.substring(idx + 1).trim();
      result[key] = decodeURIComponent(val);
    }
  });
  return result;
}
