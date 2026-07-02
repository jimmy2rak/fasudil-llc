/* ========================================
   auth/brevo.js — Brevo 邮件发送
   ======================================== */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * 发送 OTP 验证码邮件
 * @param {string} email - 收件人邮箱
 * @param {string} otp - 6位验证码
 * @returns {{ success: boolean, message?: string }}
 */
export async function sendOTPEmail(email, otp) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'noreply@fasudil-llc.app';

  if (!apiKey) {
    console.error('[Brevo] BREVO_API_KEY 未配置');
    return { success: false, message: '邮件服务未配置' };
  }

  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: 'Fasudil-LLC Analyzer' },
        to: [{ email }],
        subject: '您的登录验证码',
        htmlContent: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #1e3a5f;">Fasudil-LLC Analyzer</h2>
            <p>您的登录验证码为：</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center;
                        padding: 20px; background: #f4f6f8; border-radius: 8px; margin: 16px 0;
                        color: #1e3a5f;">
              ${otp}
            </div>
            <p style="color: #666;">验证码有效期为 10 分钟，请尽快登录。</p>
            <p style="color: #999; font-size: 12px;">如果这不是您本人操作，请忽略此邮件。</p>
          </div>
        `,
      }),
    });

    const body = await res.text();

    if (!res.ok) {
      console.error(`[Brevo] API error ${res.status}: ${body}`);
      return { success: false, message: `邮件发送失败 (${res.status})` };
    }

    // 检测隐藏错误（发件人未验证等）
    try {
      const data = JSON.parse(body);
      if (data.code === 'domain_not_found' || data.code === 'sender_not_found') {
        return { success: false, message: '发件人邮箱未在 Brevo 后台验证，请先完成验证' };
      }
    } catch { /* 非 JSON 响应，忽略 */ }

    return { success: true };
  } catch (err) {
    console.error('[Brevo] 网络错误:', err.message);
    return { success: false, message: '邮件服务网络错误' };
  }
}
