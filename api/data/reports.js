/* ========================================
   api/data/reports.js — 分析报告 CRUD
   GET    → 查询指定样品的报告列表
   POST   → 创建报告
   DELETE → 删除报告
   ======================================== */
import { getUserFromCookie, jsonResponse, errorResponse, successResponse } from '../lib/auth-utils.js';
import { execute, queryAll, queryFirst } from '../../lib/turso.js';

export async function GET(req) {
  try {
    const user = await getUserFromCookie(req);
    if (!user) return errorResponse('未登录', 401);

    const url = new URL(req.url);
    const sampleId = url.searchParams.get('sampleId');
    const expId = url.searchParams.get('experimentId');

    let sql = 'SELECT * FROM reports WHERE user_id = ?';
    let params = [user.sub];

    if (sampleId) { sql += ' AND sample_id = ?'; params.push(sampleId); }
    if (expId) { sql += ' AND experiment_id = ?'; params.push(expId); }

    sql += ' ORDER BY rowid DESC';

    const rows = await queryAll(sql, ...params);
    const reports = rows.map(r => ({
      ...r,
      result: JSON.parse(r.result || '{}')
    }));

    return successResponse(reports);
  } catch (err) {
    return errorResponse('服务器错误', 500);
  }
}

export async function POST(req) {
  try {
    const user = await getUserFromCookie(req);
    if (!user) return errorResponse('未登录', 401);

    const data = await req.json();

    if (!data.sampleId || !data.experimentId) {
      return errorResponse('缺少必要参数');
    }

    await execute(
      `INSERT INTO reports (sample_id, experiment_id, user_id, title, result, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      data.sampleId, data.experimentId, user.sub,
      data.title || '', JSON.stringify(data.result || {}),
      data.timestamp || new Date().toISOString()
    );

    return successResponse({ saved: true }, 201);
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

    if (!id) return errorResponse('缺少报告ID');

    await execute('DELETE FROM reports WHERE id = ? AND user_id = ?', parseInt(id), user.sub);

    return successResponse({ deleted: true });
  } catch (err) {
    return errorResponse('服务器错误', 500);
  }
}
