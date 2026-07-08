/* ========================================
   api/data/preferences.js — 用户偏好 CRUD
   GET  → 获取用户偏好
   POST → 创建或更新用户偏好
   ======================================== */
import { getUserFromCookie, jsonResponse, errorResponse, successResponse } from '../lib/auth-utils.js';
import { execute, queryFirst } from '../../lib/turso.js';

export async function GET(req) {
  try {
    const user = await getUserFromCookie(req);
    if (!user) return errorResponse('未登录', 401);

    let pref = await queryFirst(
      'SELECT * FROM user_preferences WHERE user_id = ?',
      user.sub
    );

    if (!pref) {
      // 创建默认偏好
      const now = Date.now();
      pref = {
        user_id: user.sub,
        default_template_id: 'system_default',
        theme: 'light',
        api_configs: '[]',
        active_api: ''
      };
    }

    return successResponse({
      defaultTemplateId: pref.default_template_id || 'system_default',
      theme: pref.theme || 'light',
      apiConfigs: JSON.parse(pref.api_configs || '[]'),
      activeApi: pref.active_api || ''
    });
  } catch (err) {
    return errorResponse('服务器错误', 500);
  }
}

export async function POST(req) {
  try {
    const user = await getUserFromCookie(req);
    if (!user) return errorResponse('未登录', 401);

    const data = await req.json();
    const now = Date.now();

    await execute(
      `INSERT INTO user_preferences (user_id, default_template_id, theme, api_configs, active_api, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         default_template_id=COALESCE(?, default_template_id),
         theme=COALESCE(?, theme),
         api_configs=COALESCE(?, api_configs),
         active_api=COALESCE(?, active_api),
         updated_at=?`,
      user.sub,
      data.defaultTemplateId || 'system_default',
      data.theme || 'light',
      JSON.stringify(data.apiConfigs || []),
      data.activeApi || '',
      now, now,
      data.defaultTemplateId || null,
      data.theme || null,
      JSON.stringify(data.apiConfigs || null),
      data.activeApi || null,
      now
    );

    return successResponse({ saved: true });
  } catch (err) {
    return errorResponse('服务器错误', 500);
  }
}
