/* ========================================
   api/data/templates.js — 用户自定义模板 CRUD
   GET    → 获取用户所有模板
   POST   → 创建/更新模板
   DELETE → 删除模板
   ======================================== */
import { getUserFromCookie, jsonResponse, errorResponse, successResponse } from '../lib/auth-utils.js';
import { execute, queryAll, queryFirst } from '../../lib/turso.js';

export async function GET(req) {
  try {
    const user = await getUserFromCookie(req);
    if (!user) return errorResponse('未登录', 401);

    const rows = await queryAll(
      'SELECT * FROM user_templates WHERE user_id = ? ORDER BY created_at DESC',
      user.sub
    );

    const templates = rows.map(r => ({
      ...r,
      columns: JSON.parse(r.columns || '[]')
    }));

    return successResponse(templates);
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

    if (data.id) {
      // 更新
      await execute(
        `UPDATE user_templates SET name=?, description=?, columns=?, updated_at=?
         WHERE id=? AND user_id=?`,
        data.name || '', data.description || '', JSON.stringify(data.columns || '[]'),
        now, data.id, user.sub
      );
      return successResponse({ id: data.id });
    } else {
      // 创建
      const tplId = 'tpl-' + now + '-' + Math.random().toString(36).slice(2, 6);
      await execute(
        `INSERT INTO user_templates (id, user_id, name, description, columns, builtin, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
        tplId, user.sub, data.name || '', data.description || '',
        JSON.stringify(data.columns || '[]'), now, now
      );
      return successResponse({ id: tplId }, 201);
    }
  } catch (err) {
    return errorResponse('服务器错误', 500);
  }
}

export async function DELETE(req) {
  try {
    const user = await getUserFromCookie(req);
    if (!user) return errorResponse('未登录', 401);

    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id) return errorResponse('缺少模板ID');

    await execute('DELETE FROM user_templates WHERE id = ? AND user_id = ?', id, user.sub);

    return successResponse({ deleted: true });
  } catch (err) {
    return errorResponse('服务器错误', 500);
  }
}
