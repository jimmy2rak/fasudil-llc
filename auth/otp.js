/* ========================================
   auth/otp.js — OTP 生成/管理
   ======================================== */
import * as crypto from 'crypto';
import { execute, queryFirst } from './db.js';

/** 生成 6 位随机数字验证码 */
export function generateOTP() {
  const buf = crypto.randomBytes(4);
  const num = buf.readUInt32BE(0) % 1000000;
  return String(num).padStart(6, '0');
}

/** 创建 OTP：失效旧码 → 写入新码 */
export async function createOTP(email) {
  // 使该邮箱所有未使用的 OTP 失效
  await execute(
    'UPDATE verification_tokens SET used = 1 WHERE email = ? AND used = 0',
    email
  );

  const token = generateOTP();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10分钟过期

  await execute(
    'INSERT INTO verification_tokens (email, token, type, used, expires_at) VALUES (?, ?, ?, 0, ?)',
    email, token, 'otp', expiresAt.toISOString()
  );

  return token;
}

/** 消费 OTP：查询 → JS端时间比较 → 标记已使用 */
export async function consumeOTP(email, token) {
  const record = await queryFirst(
    'SELECT * FROM verification_tokens WHERE email = ? AND token = ? AND type = ? AND used = 0',
    email, token, 'otp'
  );

  if (!record) return false;

  // JS 端时间比较，彻底避免 SQL 字符串时区问题
  const expiresAt = Date.parse(record.expires_at);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

  // 标记已使用
  await execute(
    'UPDATE verification_tokens SET used = 1 WHERE id = ?',
    record.id
  );

  return true;
}
