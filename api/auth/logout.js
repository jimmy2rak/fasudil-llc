/* ========================================
   api/auth/logout.js — 退出登录
   POST|GET /api/auth/logout → 清除 Cookie → 302 跳转首页
   ======================================== */
import { clearAuthCookie } from '../lib/auth-utils.js';

export async function GET(req) {
  return handleLogout(req);
}

export async function POST(req) {
  return handleLogout(req);
}

function handleLogout(req) {
  const res = new Response(null, {
    status: 302,
    headers: {
      'Location': '/'
    }
  });
  clearAuthCookie(res);
  return res;
}
