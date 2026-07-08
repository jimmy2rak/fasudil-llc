/* ========================================
   api/data/release.js — 释放曲线数据 CRUD
   GET    → 查询指定样品的释放数据
   POST   → 批量保存释放数据（全量替换）
   ======================================== */
import { getUserFromCookie, jsonResponse, errorResponse, successResponse } from '../lib/auth-utils.js';
import { execute, queryAll } from '../../lib/turso.js';

export async function GET(req) {
  try {
    const user = await getUserFromCookie(req);
    if (!user) return errorResponse('未登录', 401);

    const url = new URL(req.url);
    const sampleId = url.searchParams.get('sampleId');
    const expId = url.searchParams.get('experimentId');

    if (!sampleId || !expId) {
      return errorResponse('缺少 sampleId 和 experimentId 参数');
    }

    const rows = await queryAll(
      `SELECT * FROM release_data WHERE sample_id = ? AND experiment_id = ? AND user_id = ? ORDER BY row_order ASC`,
      sampleId, expId, user.sub
    );

    // 格式化为前端需要的结构
    const result = {
      timePoints: rows.map(r => r.time_point),
      absorbance: rows.map(r => r.absorbance),
      sampleVols: rows.map(r => r.sample_vol),
      totalVols: rows.map(r => r.total_vol)
    };

    return successResponse(result);
  } catch (err) {
    return errorResponse('服务器错误', 500);
  }
}

export async function POST(req) {
  try {
    const user = await getUserFromCookie(req);
    if (!user) return errorResponse('未登录', 401);

    const data = await req.json();
    const { sampleId, experimentId, rows } = data;

    if (!sampleId || !experimentId || !rows) {
      return errorResponse('缺少必要参数');
    }

    // 先清空旧数据
    await execute(
      'DELETE FROM release_data WHERE sample_id = ? AND experiment_id = ? AND user_id = ?',
      sampleId, experimentId, user.sub
    );

    // 批量插入新数据
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      await execute(
        `INSERT INTO release_data (sample_id, experiment_id, user_id, time_point, absorbance,
         sample_vol, total_vol, row_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        sampleId, experimentId, user.sub,
        r.time || '', r.absorbance || 0,
        r.sampleVol || 2, r.totalVol || 30, i
      );
    }

    return successResponse({ saved: rows.length });
  } catch (err) {
    return errorResponse('服务器错误', 500);
  }
}
