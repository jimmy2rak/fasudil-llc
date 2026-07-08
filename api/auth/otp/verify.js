/* ========================================
   api/auth/otp/verify.js — 验证 OTP 并登录
   POST /api/auth/otp/verify → { success, data: { user } } + Set-Cookie
   ======================================== */
import { consumeOTP } from '../../lib/otp.js';
import { signJWT, setAuthCookie, jsonResponse, errorResponse, successResponse } from '../../lib/auth-utils.js';
import { execute, queryFirst, initDatabase } from '../../lib/turso.js';

let _dbInit = false;

export async function POST(req) {
  try {
    if (!_dbInit) { await initDatabase(); _dbInit = true; }

    const body = await req.json();
    const email = (body.email || '').trim().toLowerCase();
    const otp = (body.otp || '').trim();

    if (!email || !otp) {
      return errorResponse('邮箱和验证码不能为空');
    }

    // 消费 OTP
    const valid = await consumeOTP(email, otp);
    if (!valid) {
      return errorResponse('验证码无效或已过期');
    }

    // 查找或创建用户
    let user = await queryFirst('SELECT id, email, name FROM users WHERE email = ?', email);
    if (!user) {
      const now = Date.now();
      const userId = 'user-' + now + '-' + Math.random().toString(36).slice(2, 7);
      await execute(
        'INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        userId, email, email.split('@')[0], now, now
      );
      user = { id: userId, email, name: email.split('@')[0] };

      // 为新用户创建默认偏好
      await execute(
        'INSERT INTO user_preferences (user_id, default_template_id, theme, api_configs, active_api, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        userId, 'system_default', 'light', '[]', '', now, now
      );
    }

    // 签发 JWT
    const token = await signJWT({ sub: user.id, email: user.email });

    // 构建响应 + 设置 Cookie
    const res = jsonResponse({
      success: true,
      data: { user: { id: user.id, email: user.email, name: user.name } }
    });
    setAuthCookie(res, token);

    return res;
  } catch (err) {
    console.error('[Auth/OTP/Verify] 错误:', err.message);
    return errorResponse('服务器错误', 500);
  }
}
