/* ========================================
   api/data/knowledge.js — 知识库条目 CRUD
   GET    → 查询知识库列表
   POST   → 创建/更新条目
   DELETE → 删除条目
   ======================================== */
import { getUserFromCookie, jsonResponse, errorResponse, successResponse } from '../lib/auth-utils.js';
import { execute, queryAll, queryFirst } from '../../lib/turso.js';

export async function GET(req) {
  try {
    const user = await getUserFromCookie(req);
    if (!user) return errorResponse('未登录', 401);

    const url = new URL(req.url);
    const type = url.searchParams.get('type');

    let sql = 'SELECT * FROM knowledge_entries WHERE user_id = ?';
    let params = [user.sub];

    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = await queryAll(sql, ...params);
    const entries = rows.map(r => ({
      ...r,
      content: JSON.parse(r.content || '{}'),
      tags: JSON.parse(r.tags || '[]')
    }));

    return successResponse(entries);
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
        `UPDATE knowledge_entries SET title=?, content=?, tags=?, updated_at=?
         WHERE id=? AND user_id=?`,
        data.title || '',
        JSON.stringify(data.content || {}),
        JSON.stringify(data.tags || []),
        now, data.id, user.sub
      );
      return successResponse({ id: data.id });
    } else {
      // 创建
      const entryId = 'lit-' + now + '-' + Math.random().toString(36).slice(2, 6);
      await execute(
        `INSERT INTO knowledge_entries (id, user_id, type, title, content, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        entryId, user.sub, data.type || 'literature',
        data.title || '',
        JSON.stringify(data.content || {}),
        JSON.stringify(data.tags || []),
        now, now
      );
      return successResponse({ id: entryId }, 201);
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

    if (!id) return errorResponse('缺少条目ID');

    await execute('DELETE FROM knowledge_entries WHERE id = ? AND user_id = ?', id, user.sub);

    return successResponse({ deleted: true });
  } catch (err) {
    return errorResponse('服务器错误', 500);
  }
}
