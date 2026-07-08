/* ========================================
   api/data/samples.js — 样品 CRUD
   GET    → 查询样品列表（按实验组或全部）
   PUT    → 更新单个样品
   ======================================== */
import { getUserFromCookie, jsonResponse, errorResponse, successResponse } from '../lib/auth-utils.js';
import { execute, queryAll, queryFirst } from '../../lib/turso.js';

export async function GET(req) {
  try {
    const user = await getUserFromCookie(req);
    if (!user) return errorResponse('未登录', 401);

    const url = new URL(req.url);
    const expId = url.searchParams.get('experimentId');

    let sql, params;
    if (expId) {
      sql = 'SELECT * FROM samples WHERE experiment_id = ? AND user_id = ? ORDER BY created_at';
      params = [expId, user.sub];
    } else {
      sql = 'SELECT * FROM samples WHERE user_id = ? ORDER BY created_at DESC';
      params = [user.sub];
    }

    const rows = await queryAll(sql, ...params);
    const samples = rows.map(r => ({
      ...r,
      formulation_components: JSON.parse(r.formulation_components || '{}')
    }));

    return successResponse(samples);
  } catch (err) {
    return errorResponse('服务器错误', 500);
  }
}

export async function PUT(req) {
  try {
    const user = await getUserFromCookie(req);
    if (!user) return errorResponse('未登录', 401);

    const data = await req.json();
    const now = Date.now();

    await execute(
      `UPDATE samples SET formulation=?, formulation_components=?, formulation_total=?,
       total_drug=?, density=?, take_volume=?, exp_drug_amount=?, group_name=?,
       final_rate=?, residual_abs=?, residual_amount=?, residual_rate=?, total_recovery=?,
       updated_at=?
       WHERE id=? AND experiment_id=? AND user_id=?`,
      data.formulation || '', JSON.stringify(data.formulationComponents || {}),
      data.formulationTotal || 0, data.totalDrug || 0, data.density || 0,
      data.takeVolume || 0, data.expDrugAmount || 0, data.group || '',
      data.finalRate || 0, data.residualAbs || 0, data.residualAmount || 0,
      data.residualRate || 0, data.totalRecovery || 0,
      now, data.id, data.experimentId, user.sub
    );

    return successResponse({ updated: true });
  } catch (err) {
    return errorResponse('服务器错误', 500);
  }
}
