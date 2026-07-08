/* ========================================
   lib/data-handler.js — 数据 CRUD 合并
   experiments / samples / release / reports
   templates / preferences / knowledge
   ======================================== */
import { ensureDB, getUserFromCookie, execute, queryAll, queryFirst,
         errorResponse, successResponse } from './auth-handler.js';

// ========== 实验组 ==========
async function handleExperiments(req, user) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const nameFilter = url.searchParams.get('name');
    let sql = 'SELECT * FROM experiments WHERE user_id = ?';
    const params = [user.sub];
    if (nameFilter) { sql += ' AND name LIKE ?'; params.push('%' + nameFilter + '%'); }
    sql += ' ORDER BY created_at DESC';

    const rows = await queryAll(sql, ...params);
    const experiments = rows.map(r => ({ ...r, formulations: JSON.parse(r.formulations || '[]'), samples: [] }));

    if (experiments.length > 0) {
      const expIds = experiments.map(e => e.id);
      const ph = expIds.map(() => '?').join(',');
      const sampleRows = await queryAll(
        `SELECT * FROM samples WHERE experiment_id IN (${ph}) AND user_id = ? ORDER BY created_at`,
        ...expIds, user.sub
      );
      const byExp = {};
      for (const s of sampleRows) {
        const sample = { ...s, formulationComponents: JSON.parse(s.formulation_components || '{}') };
        (byExp[s.experiment_id] ||= []).push(sample);
      }
      for (const exp of experiments) exp.samples = byExp[exp.id] || [];
    }
    return successResponse(experiments);
  }

  if (req.method === 'POST') {
    const data = await req.json();
    const now = Date.now();
    const expId = data.id || ('exp-' + now + '-' + Math.random().toString(36).slice(2, 7));

    await execute(
      `INSERT INTO experiments (id, user_id, name, date, template_id, formulations, drug_amount, drug_conc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      expId, user.sub, data.name || '', data.date || '', data.templateId || '',
      JSON.stringify(data.formulations || []), data.drugAmount || 0, data.drugConc || 0, now, now
    );

    const samples = data.samples || [];
    for (const s of samples) {
      await execute(
        `INSERT INTO samples (id, experiment_id, user_id, formulation, formulation_components, formulation_total,
         total_drug, density, take_volume, exp_drug_amount, group_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s.id, expId, user.sub, s.formulation || '', JSON.stringify(s.formulationComponents || {}),
        s.formulationTotal || 0, s.totalDrug || 0, s.density || 0, s.takeVolume || 0,
        s.expDrugAmount || 0, s.group || '', now, now
      );
    }
    return successResponse({ id: expId, sampleCount: samples.length }, 201);
  }

  if (req.method === 'PUT') {
    const data = await req.json();
    const now = Date.now();
    const existing = await queryFirst('SELECT id FROM experiments WHERE id = ? AND user_id = ?', data.id, user.sub);
    if (!existing) return errorResponse('实验组不存在或无权限', 404);

    await execute(
      `UPDATE experiments SET name=?, date=?, template_id=?, formulations=?, drug_amount=?, drug_conc=?, updated_at=?
       WHERE id=? AND user_id=?`,
      data.name || '', data.date || '', data.templateId || '',
      JSON.stringify(data.formulations || []), data.drugAmount || 0, data.drugConc || 0,
      now, data.id, user.sub
    );

    await execute('DELETE FROM samples WHERE experiment_id = ? AND user_id = ?', data.id, user.sub);
    const samples = data.samples || [];
    for (const s of samples) {
      await execute(
        `INSERT INTO samples (id, experiment_id, user_id, formulation, formulation_components, formulation_total,
         total_drug, density, take_volume, exp_drug_amount, group_name, final_rate,
         residual_abs, residual_amount, residual_rate, total_recovery, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s.id, data.id, user.sub, s.formulation || '', JSON.stringify(s.formulationComponents || {}),
        s.formulationTotal || 0, s.totalDrug || 0, s.density || 0, s.takeVolume || 0,
        s.expDrugAmount || 0, s.group || '', s.finalRate || 0, s.residualAbs || 0,
        s.residualAmount || 0, s.residualRate || 0, s.totalRecovery || 0, now, now
      );
    }
    return successResponse({ id: data.id, sampleCount: samples.length });
  }

  if (req.method === 'DELETE') {
    const expId = url.searchParams.get('id');
    if (!expId) return errorResponse('缺少实验组ID');
    await execute('DELETE FROM experiments WHERE id = ? AND user_id = ?', expId, user.sub);
    return successResponse({ deleted: true });
  }

  return errorResponse('不支持的方法', 405);
}

// ========== 释放数据 ==========
async function handleRelease(req, user) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const sampleId = url.searchParams.get('sampleId');
    const expId = url.searchParams.get('experimentId');
    if (!sampleId || !expId) return errorResponse('缺少参数');

    const rows = await queryAll(
      'SELECT * FROM release_data WHERE sample_id = ? AND experiment_id = ? AND user_id = ? ORDER BY row_order ASC',
      sampleId, expId, user.sub
    );
    return successResponse({
      timePoints: rows.map(r => r.time_point),
      absorbance: rows.map(r => r.absorbance),
      sampleVols: rows.map(r => r.sample_vol),
      totalVols: rows.map(r => r.total_vol)
    });
  }

  if (req.method === 'POST') {
    const data = await req.json();
    const { sampleId, experimentId, rows } = data;
    if (!sampleId || !experimentId || !rows) return errorResponse('缺少参数');

    await execute('DELETE FROM release_data WHERE sample_id = ? AND experiment_id = ? AND user_id = ?',
      sampleId, experimentId, user.sub);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      await execute(
        `INSERT INTO release_data (sample_id, experiment_id, user_id, time_point, absorbance, sample_vol, total_vol, row_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        sampleId, experimentId, user.sub, r.time || '', r.absorbance || 0, r.sampleVol || 2, r.totalVol || 30, i
      );
    }
    return successResponse({ saved: rows.length });
  }

  return errorResponse('不支持的方法', 405);
}

// ========== 报告 ==========
async function handleReports(req, user) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const sampleId = url.searchParams.get('sampleId');
    const expId = url.searchParams.get('experimentId');
    let sql = 'SELECT * FROM reports WHERE user_id = ?';
    const params = [user.sub];
    if (sampleId) { sql += ' AND sample_id = ?'; params.push(sampleId); }
    if (expId) { sql += ' AND experiment_id = ?'; params.push(expId); }
    sql += ' ORDER BY rowid DESC';

    const rows = await queryAll(sql, ...params);
    return successResponse(rows.map(r => ({ ...r, result: JSON.parse(r.result || '{}') })));
  }

  if (req.method === 'POST') {
    const data = await req.json();
    if (!data.sampleId || !data.experimentId) return errorResponse('缺少参数');
    await execute(
      `INSERT INTO reports (sample_id, experiment_id, user_id, title, result, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
      data.sampleId, data.experimentId, user.sub, data.title || '',
      JSON.stringify(data.result || {}), data.timestamp || new Date().toISOString()
    );
    return successResponse({ saved: true }, 201);
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return errorResponse('缺少报告ID');
    await execute('DELETE FROM reports WHERE id = ? AND user_id = ?', parseInt(id), user.sub);
    return successResponse({ deleted: true });
  }

  return errorResponse('不支持的方法', 405);
}

// ========== 模板 ==========
async function handleTemplates(req, user) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const rows = await queryAll('SELECT * FROM user_templates WHERE user_id = ? ORDER BY created_at DESC', user.sub);
    return successResponse(rows.map(r => ({ ...r, columns: JSON.parse(r.columns || '[]') })));
  }

  if (req.method === 'POST') {
    const data = await req.json();
    const now = Date.now();
    if (data.id) {
      await execute(
        `UPDATE user_templates SET name=?, description=?, columns=?, updated_at=? WHERE id=? AND user_id=?`,
        data.name || '', data.description || '', JSON.stringify(data.columns || '[]'), now, data.id, user.sub
      );
      return successResponse({ id: data.id });
    } else {
      const tplId = 'tpl-' + now + '-' + Math.random().toString(36).slice(2, 6);
      await execute(
        `INSERT INTO user_templates (id, user_id, name, description, columns, builtin, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
        tplId, user.sub, data.name || '', data.description || '',
        JSON.stringify(data.columns || '[]'), now, now
      );
      return successResponse({ id: tplId }, 201);
    }
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return errorResponse('缺少模板ID');
    await execute('DELETE FROM user_templates WHERE id = ? AND user_id = ?', id, user.sub);
    return successResponse({ deleted: true });
  }

  return errorResponse('不支持的方法', 405);
}

// ========== 偏好 ==========
async function handlePreferences(req, user) {
  if (req.method === 'GET') {
    let pref = await queryFirst('SELECT * FROM user_preferences WHERE user_id = ?', user.sub);
    if (!pref) {
      pref = { user_id: user.sub, default_template_id: 'system_default', theme: 'light', api_configs: '[]', active_api: '' };
    }
    return successResponse({
      defaultTemplateId: pref.default_template_id || 'system_default',
      theme: pref.theme || 'light',
      apiConfigs: JSON.parse(pref.api_configs || '[]'),
      activeApi: pref.active_api || ''
    });
  }

  if (req.method === 'POST') {
    const data = await req.json();
    const now = Date.now();
    await execute(
      `INSERT INTO user_preferences (user_id, default_template_id, theme, api_configs, active_api, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         default_template_id=COALESCE(?, default_template_id), theme=COALESCE(?, theme),
         api_configs=COALESCE(?, api_configs), active_api=COALESCE(?, active_api), updated_at=?`,
      user.sub, data.defaultTemplateId || 'system_default', data.theme || 'light',
      JSON.stringify(data.apiConfigs || []), data.activeApi || '', now, now,
      data.defaultTemplateId || null, data.theme || null,
      JSON.stringify(data.apiConfigs || null), data.activeApi || null, now
    );
    return successResponse({ saved: true });
  }

  return errorResponse('不支持的方法', 405);
}

// ========== 知识库 ==========
async function handleKnowledge(req, user) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const type = url.searchParams.get('type');
    let sql = 'SELECT * FROM knowledge_entries WHERE user_id = ?';
    const params = [user.sub];
    if (type) { sql += ' AND type = ?'; params.push(type); }
    sql += ' ORDER BY created_at DESC';
    const rows = await queryAll(sql, ...params);
    return successResponse(rows.map(r => ({ ...r, content: JSON.parse(r.content || '{}'), tags: JSON.parse(r.tags || '[]') })));
  }

  if (req.method === 'POST') {
    const data = await req.json();
    const now = Date.now();
    if (data.id) {
      await execute(
        `UPDATE knowledge_entries SET title=?, content=?, tags=?, updated_at=? WHERE id=? AND user_id=?`,
        data.title || '', JSON.stringify(data.content || {}), JSON.stringify(data.tags || []), now, data.id, user.sub
      );
      return successResponse({ id: data.id });
    } else {
      const entryId = 'lit-' + now + '-' + Math.random().toString(36).slice(2, 6);
      await execute(
        `INSERT INTO knowledge_entries (id, user_id, type, title, content, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        entryId, user.sub, data.type || 'literature', data.title || '',
        JSON.stringify(data.content || {}), JSON.stringify(data.tags || []), now, now
      );
      return successResponse({ id: entryId }, 201);
    }
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return errorResponse('缺少条目ID');
    await execute('DELETE FROM knowledge_entries WHERE id = ? AND user_id = ?', id, user.sub);
    return successResponse({ deleted: true });
  }

  return errorResponse('不支持的方法', 405);
}

// ========== 数据路由分发 ==========
export async function handleData(path, req) {
  await ensureDB();
  const user = await getUserFromCookie(req);
  if (!user) return errorResponse('未登录', 401);

  switch (path) {
    case 'experiments':  return handleExperiments(req, user);
    case 'release':      return handleRelease(req, user);
    case 'reports':      return handleReports(req, user);
    case 'templates':    return handleTemplates(req, user);
    case 'preferences':  return handlePreferences(req, user);
    case 'knowledge':    return handleKnowledge(req, user);
    default:             return errorResponse('数据接口不存在', 404);
  }
}
