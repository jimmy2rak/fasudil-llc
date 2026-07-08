/* ========================================
   api/auth/me.js — 获取当前登录用户信息
   GET /api/auth/me → { success, data: { id, email, name } }
   ======================================== */
import { getUserFromCookie, jsonResponse, errorResponse } from '../lib/auth-utils.js';
import { queryFirst, initDatabase } from '../../lib/turso.js';

let _dbInit = false;

export async function GET(req) {
  try {
    if (!_dbInit) { await initDatabase(); _dbInit = true; }

    const payload = await getUserFromCookie(req);
    if (!payload) {
      return errorResponse('未登录', 401);
    }

    const user = await queryFirst('SELECT id, email, name FROM users WHERE id = ?', payload.sub);
    if (!user) {
      return errorResponse('用户不存在', 401);
    }

    return jsonResponse({
      success: true,
      data: { id: user.id, email: user.email, name: user.name }
    });
  } catch (err) {
    console.error('[Auth/Me] 错误:', err.message);
    return errorResponse('服务器错误', 500);
  }
}
