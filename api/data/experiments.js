/* ========================================
   api/data/experiments.js — 实验组 CRUD
   GET    → 列出当前用户所有实验组
   POST   → 创建新实验组（含 samples + release_data）
   PUT    → 更新实验组（含 samples 更新）
   DELETE → 删除实验组（CASCADE自动删除关联数据）
   ======================================== */
import { getUserFromCookie, jsonResponse, errorResponse, successResponse } from '../lib/auth-utils.js';
import { execute, queryAll, queryFirst, initDatabase } from '../../lib/turso.js';

// 自动初始化数据库（首次调用时建表）
let _dbInitialized = false;
async function ensureDB() {
  if (!_dbInitialized) {
    await initDatabase();
    _dbInitialized = true;
  }
}

/** 获取当前登录用户（拦截未登录） */
async function getAuthUser(req) {
  await ensureDB();
  const payload = await getUserFromCookie(req);
  if (!payload) return null;
  return payload;
}

/** GET /api/data/experiments?name=xxx — 查询实验组列表（含样品） */
export async function GET(req) {
  try {
    const user = await getAuthUser(req);
    if (!user) return errorResponse('未登录', 401);

    const url = new URL(req.url);
    const nameFilter = url.searchParams.get('name');

    let sql = 'SELECT * FROM experiments WHERE user_id = ?';
    const params = [user.sub];

    if (nameFilter) {
      sql += ' AND name LIKE ?';
      params.push('%' + nameFilter + '%');
    }
    sql += ' ORDER BY created_at DESC';

    const rows = await queryAll(sql, ...params);
    const experiments = rows.map(r => ({
      ...r,
      formulations: JSON.parse(r.formulations || '[]'),
      samples: []
    }));

    // 批量加载所有样品
    if (experiments.length > 0) {
      const expIds = experiments.map(e => e.id);
      const placeholders = expIds.map(() => '?').join(',');
      const sampleRows = await queryAll(
        `SELECT * FROM samples WHERE experiment_id IN (${placeholders}) AND user_id = ? ORDER BY created_at`,
        ...expIds, user.sub
      );

      // 按实验组ID分组
      const samplesByExp = {};
      for (const s of sampleRows) {
        const sample = {
          ...s,
          formulationComponents: JSON.parse(s.formulation_components || '{}')
        };
        if (!samplesByExp[s.experiment_id]) samplesByExp[s.experiment_id] = [];
        samplesByExp[s.experiment_id].push(sample);
      }

      for (const exp of experiments) {
        exp.samples = samplesByExp[exp.id] || [];
      }
    }

    return successResponse(experiments);
  } catch (err) {
    console.error('[API/Experiments] GET 错误:', err.message);
    return errorResponse('服务器错误', 500);
  }
}

/** POST /api/data/experiments — 创建实验组（含samples） */
export async function POST(req) {
  try {
    const user = await getAuthUser(req);
    if (!user) return errorResponse('未登录', 401);

    const data = await req.json();
    const now = Date.now();
    const expId = 'exp-' + now + '-' + Math.random().toString(36).slice(2, 7);

    // 插入实验组
    await execute(
      `INSERT INTO experiments (id, user_id, name, date, template_id, formulations, drug_amount, drug_conc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      expId,
      user.sub,
      data.name || '',
      data.date || '',
      data.templateId || '',
      JSON.stringify(data.formulations || []),
      data.drugAmount || 0,
      data.drugConc || 0,
      now,
      now
    );

    // 插入样品
    const samples = data.samples || [];
    for (const s of samples) {
      await execute(
        `INSERT INTO samples (id, experiment_id, user_id, formulation, formulation_components, formulation_total,
         total_drug, density, take_volume, exp_drug_amount, group_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s.id, expId, user.sub,
        s.formulation || '',
        JSON.stringify(s.formulationComponents || {}),
        s.formulationTotal || 0,
        s.totalDrug || 0,
        s.density || 0,
        s.takeVolume || 0,
        s.expDrugAmount || 0,
        s.group || '',
        now, now
      );
    }

    return successResponse({ id: expId, sampleCount: samples.length }, 201);
  } catch (err) {
    console.error('[API/Experiments] POST 错误:', err.message);
    return errorResponse('服务器错误', 500);
  }
}

/** PUT /api/data/experiments — 更新实验组 */
export async function PUT(req) {
  try {
    const user = await getAuthUser(req);
    if (!user) return errorResponse('未登录', 401);

    const data = await req.json();
    const now = Date.now();

    // 验证所有权
    const existing = await queryFirst('SELECT id FROM experiments WHERE id = ? AND user_id = ?', data.id, user.sub);
    if (!existing) return errorResponse('实验组不存在或无权限', 404);

    // 更新实验组
    await execute(
      `UPDATE experiments SET name=?, date=?, template_id=?, formulations=?, drug_amount=?, drug_conc=?, updated_at=?
       WHERE id=? AND user_id=?`,
      data.name || '', data.date || '', data.templateId || '',
      JSON.stringify(data.formulations || []), data.drugAmount || 0, data.drugConc || 0,
      now, data.id, user.sub
    );

    // 更新样品：先清空再重新插入
    await execute('DELETE FROM samples WHERE experiment_id = ? AND user_id = ?', data.id, user.sub);
    const samples = data.samples || [];
    for (const s of samples) {
      await execute(
        `INSERT INTO samples (id, experiment_id, user_id, formulation, formulation_components, formulation_total,
         total_drug, density, take_volume, exp_drug_amount, group_name, final_rate,
         residual_abs, residual_amount, residual_rate, total_recovery, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s.id, data.id, user.sub,
        s.formulation || '', JSON.stringify(s.formulationComponents || {}),
        s.formulationTotal || 0, s.totalDrug || 0, s.density || 0,
        s.takeVolume || 0, s.expDrugAmount || 0, s.group || '',
        s.finalRate || 0, s.residualAbs || 0, s.residualAmount || 0,
        s.residualRate || 0, s.totalRecovery || 0,
        now, now
      );
    }

    return successResponse({ id: data.id, sampleCount: samples.length });
  } catch (err) {
    console.error('[API/Experiments] PUT 错误:', err.message);
    return errorResponse('服务器错误', 500);
  }
}

/** DELETE /api/data/experiments?id=xxx — 删除实验组（CASCADE） */
export async function DELETE(req) {
  try {
    const user = await getAuthUser(req);
    if (!user) return errorResponse('未登录', 401);

    const url = new URL(req.url);
    const expId = url.searchParams.get('id');

    if (!expId) return errorResponse('缺少实验组ID');

    const existing = await queryFirst('SELECT id FROM experiments WHERE id = ? AND user_id = ?', expId, user.sub);
    if (!existing) return errorResponse('实验组不存在或无权限', 404);

    await execute('DELETE FROM experiments WHERE id = ? AND user_id = ?', expId, user.sub);

    return successResponse({ deleted: true });
  } catch (err) {
    console.error('[API/Experiments] DELETE 错误:', err.message);
    return errorResponse('服务器错误', 500);
  }
}
