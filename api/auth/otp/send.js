/* ========================================
   api/auth/otp/send.js — 发送邮箱验证码
   POST /api/auth/otp/send → { success, data: { sent: boolean } }
   ======================================== */
import { createOTP } from '../../lib/otp.js';
import { sendOTPEmail } from '../../lib/brevo.js';
import { jsonResponse, errorResponse } from '../../lib/auth-utils.js';
import { initDatabase } from '../../lib/turso.js';

let _dbInit = false;

export async function POST(req) {
  try {
    if (!_dbInit) { await initDatabase(); _dbInit = true; }

    const body = await req.json();
    const email = (body.email || '').trim().toLowerCase();

    if (!email || !email.includes('@')) {
      return errorResponse('请输入有效邮箱');
    }

    // 生成 OTP 并写入数据库
    const otp = await createOTP(email);

    // 发送邮件
    const result = await sendOTPEmail(email, otp);

    if (!result.success) {
      return errorResponse(result.message || '邮件发送失败');
    }

    return jsonResponse({ success: true, data: { sent: true } });
  } catch (err) {
    console.error('[Auth/OTP/Send] 错误:', err.message);
    return errorResponse('服务器错误', 500);
  }
}
