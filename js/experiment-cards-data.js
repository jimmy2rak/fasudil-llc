/* ========================================
   experiment-cards-data.js — V2
   实验数据管理 — API驱动（Turso云端持久化）
   所有数据按用户UID隔离，退出登录不丢失
   ======================================== */

const ExperimentData = (() => {
  /* ============================================================
     系统内置标准模板（只读，前端硬编码）
     V2 保持完全一致，14列标准布局
     ============================================================ */
  const SYSTEM_DEFAULT_TEMPLATE = {
    id: 'system_default',
    name: '系统内置标准模板',
    description: '标准脂质体处方14列表格，含载药浓度、实验药量自动计算',
    builtin: true,
    enabled: true,
    columns: [
      { id:'formulationName', label:'处方名称',     type:'text',    width:'90px',  order:0, default:'' },
      { id:'spc',   label:'SPC',    type:'number', unit:'g',  width:'65px', order:1, default:0 },
      { id:'gmo',   label:'GMO',    type:'number', unit:'g',  width:'65px', order:2, default:0 },
      { id:'nmp',   label:'NMP',    type:'number', unit:'g',  width:'65px', order:3, default:0 },
      { id:'water', label:'水',      type:'number', unit:'g',  width:'55px', order:4, default:0 },
      { id:'etoh',  label:'EtOH',   type:'number', unit:'g',  width:'65px', order:5, default:0 },
      { id:'dopg',  label:'DOPG-Na',type:'number', unit:'g',  width:'75px', order:6, default:0 },
      { id:'rowTotal',  label:'本行总重', type:'computed', width:'65px', order:7,
        formula:'spc+gmo+nmp+water+etoh+dopg', formulaDescription:'SPC+GMO+NMP+水+EtOH+DOPG-Na之和' },
      { id:'drugAmount', label:'本行加入药量', type:'number', unit:'mg', width:'85px', order:8, default:0 },
      { id:'density', label:'密度', type:'number', unit:'g/ml', width:'70px', order:9, default:0 },
      { id:'drugConc', label:'本行载药浓度', type:'computed', width:'95px', order:10,
        formula:'drugAmount/(rowTotal*1000+drugAmount)*density*1000',
        formulaDescription:'本行加入药量 ÷ (本行总重×1000 + 本行加入药量) × 密度(g/ml) × 1000' },
      { id:'takeVolume', label:'取用体积', type:'number', unit:'μL', width:'70px', order:11, default:0 },
      { id:'expDrugAmount', label:'实验药量', type:'computed', width:'75px', order:12,
        formula:'drugConc*takeVolume/1000', formulaDescription:'载药浓度×取用体积÷1000' },
      { id:'samples', label:'对应样品', type:'text', width:'115px', order:13, default:'' },
    ]
  };

  // ========== 内存缓存 ==========
  let _userExperiments = [];   // 所有用户实验组
  let _dataOverrides = {};     // 释放数据缓存: { experimentId: { sampleId: {timePoints:[],...} } }
  let _savedReports = {};      // 报告缓存: { experimentId: { sampleId: [{title, timestamp, result}] } }

  // ========== API 基路径 ==========
  const API_BASE = '/api/data';

  // ========== 通用 API 封装 ==========
  async function _apiFetch(url, options = {}) {
    try {
      const res = await fetch(url, {
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          ...(options.headers || {})
        },
        ...options
      });
      if (res.status === 401) {
        if (typeof App !== 'undefined' && App.forceLogout) {
          App.forceLogout();
        }
        return null;
      }
      return res;
    } catch {
      return null;
    }
  }

  async function _apiGet(path) {
    const res = await _apiFetch(API_BASE + path);
    if (!res || !res.ok) return null;
    const data = await res.json();
    return data.success ? data.data : null;
  }

  async function _apiPost(path, body) {
    const res = await _apiFetch(API_BASE + path, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    return data.success ? (data.data || true) : null;
  }

  async function _apiPut(path, body) {
    const res = await _apiFetch(API_BASE + path, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    return data.success ? (data.data || true) : null;
  }

  async function _apiDelete(path) {
    const res = await _apiFetch(API_BASE + path, {
      method: 'DELETE'
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    return data.success ? (data.data || true) : null;
  }

  // ========== 实验组 CRUD ==========
  async function getAllExperiments() {
    // 先查缓存，没有则从API加载
    if (_userExperiments.length > 0) return _userExperiments;
    return await _loadExperimentsFromAPI();
  }

  async function _loadExperimentsFromAPI() {
    const experiments = await _apiGet('/experiments');
    if (experiments && Array.isArray(experiments)) {
      _userExperiments = experiments;
      // 同时加载释放数据
      for (const exp of experiments) {
        if (exp.samples) {
          for (const s of exp.samples) {
            const saved = await _apiGet(`/release?sampleId=${encodeURIComponent(s.id)}&experimentId=${encodeURIComponent(exp.id)}`);
            if (saved) {
              if (!_dataOverrides[exp.id]) _dataOverrides[exp.id] = {};
              _dataOverrides[exp.id][s.id] = saved;
            }
          }
        }
      }
      return _userExperiments;
    }
    return [];
  }

  function getExperiment(experimentId) {
    return _userExperiments.find(e => e.id === experimentId) || null;
  }

  async function createExperiment(data) {
    const id = 'exp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const samples = [];
    const formulations = data.formulations || [];
    const rows = data.rows || [];

    for (let fi = 0; fi < formulations.length; fi++) {
      const f = formulations[fi];
      const rowData = rows[fi] || {};

      const rowDrugAmount = rowData.drugAmount !== undefined
        ? parseFloat(rowData.drugAmount) || 0
        : (parseFloat(data.totalDrug) || 0) * (f.samples || []).length;

      const rowDrugConc = rowData.drugConc !== undefined
        ? parseFloat(rowData.drugConc) || 0
        : (parseFloat(data.drugConc) || 0);

      const rowDensity = parseFloat(rowData.density) || 0;
      const rowTakeVolume = parseFloat(rowData.takeVolume) || 0;
      const rowExpDrugAmount = parseFloat(rowData.expDrugAmount) || 0;
      const sampleTotalDrug = rowData.expDrugAmount !== undefined ? rowExpDrugAmount : rowDrugAmount;

      for (const sid of (f.samples || [])) {
        const sample = {
          id: sid,
          experimentId: id,
          formulation: f.name,
          formulationComponents: f.components,
          formulationTotal: f.total,
          totalDrug: sampleTotalDrug,
          density: rowDensity,
          takeVolume: rowTakeVolume,
          expDrugAmount: rowExpDrugAmount,
          group: data.groupName || data.experimentName || '',
          finalRate: 0, residualAbs: 0, residualAmount: 0,
          residualRate: 0, totalRecovery: 0
        };
        samples.push(sample);
      }

      f.perRowDrugAmount = rowDrugAmount;
      f.perRowDrugConc = rowDrugConc;
      f.perRowDensity = rowDensity;
      f.perRowTakeVolume = rowTakeVolume;
      f.perRowExpDrugAmount = rowExpDrugAmount;
      if (rowData._values) f._rowData = rowData._values;
    }

    const group = {
      id,
      name: data.experimentName || '',
      date: data.date || '',
      drugAmount: data.drugAmount || 0,
      drugConc: data.drugConc || 0,
      templateId: data.templateId || '',
      formulations,
      samples,
      createdAt: Date.now()
    };

    // 保存到API
    const result = await _apiPost('/experiments', {
      id, name: group.name, date: group.date,
      templateId: group.templateId,
      formulations: group.formulations,
      drugAmount: group.drugAmount, drugConc: group.drugConc,
      samples: group.samples
    });

    if (result) {
      _userExperiments.unshift(group);
    }
    return group;
  }

  async function updateExperiment(experimentId, data) {
    const group = _userExperiments.find(e => e.id === experimentId);
    if (!group) return null;

    const existingSamples = group.samples || [];
    const formulations = data.formulations || [];
    const rows = data.rows || [];
    const updatedSampleIds = new Set();

    for (let fi = 0; fi < formulations.length; fi++) {
      const f = formulations[fi];
      const rowData = rows[fi] || {};

      const rowDrugAmount = rowData.drugAmount !== undefined
        ? parseFloat(rowData.drugAmount) || 0
        : (parseFloat(data.totalDrug) || 0) * (f.samples || []).length;

      const rowExpDrugAmount = parseFloat(rowData.expDrugAmount) || 0;
      const rowDensity = parseFloat(rowData.density) || 0;
      const rowTakeVolume = parseFloat(rowData.takeVolume) || 0;
      const sampleTotalDrug = rowData.expDrugAmount !== undefined ? rowExpDrugAmount : rowDrugAmount;
      const targetSampleIds = f.samples || [];

      for (const sid of targetSampleIds) {
        updatedSampleIds.add(sid);
        const existing = existingSamples.find(s => s.id === sid);
        if (existing) {
          // 保留手动数据，仅更新配方参数
          existing.formulation = f.name;
          existing.formulationComponents = f.components;
          existing.formulationTotal = f.total;
          existing.totalDrug = sampleTotalDrug;
          existing.density = rowDensity;
          existing.takeVolume = rowTakeVolume;
          existing.expDrugAmount = rowExpDrugAmount;
          existing.group = data.groupName || data.experimentName || '';
        } else {
          // 安全兜底：创建新样品
          const ns = {
            id: sid, experimentId: experimentId,
            formulation: f.name, formulationComponents: f.components,
            formulationTotal: f.total, totalDrug: sampleTotalDrug,
            density: rowDensity, takeVolume: rowTakeVolume,
            expDrugAmount: rowExpDrugAmount,
            group: data.groupName || data.experimentName || '',
            finalRate: 0, residualAbs: 0, residualAmount: 0,
            residualRate: 0, totalRecovery: 0
          };
          existingSamples.push(ns);
        }
      }

      f.perRowDrugAmount = rowDrugAmount;
      f.perRowDrugConc = rowData.drugConc !== undefined
        ? parseFloat(rowData.drugConc) || 0
        : (parseFloat(data.drugConc) || 0);
      f.perRowDensity = rowDensity;
      f.perRowTakeVolume = rowTakeVolume;
      f.perRowExpDrugAmount = rowExpDrugAmount;
      if (rowData._values) f._rowData = rowData._values;
    }

    group.name = data.experimentName || group.name;
    group.date = data.date || group.date;
    group.drugAmount = data.drugAmount || group.drugAmount;
    group.drugConc = data.drugConc || group.drugConc;
    group.formulations = formulations;

    // 同步到API
    await _apiPut('/experiments', {
      id: experimentId, name: group.name, date: group.date,
      templateId: group.templateId || '',
      formulations: group.formulations,
      drugAmount: group.drugAmount, drugConc: group.drugConc,
      samples: existingSamples
    });

    return group;
  }

  async function deleteExperiment(experimentId) {
    const idx = _userExperiments.findIndex(e => e.id === experimentId);
    if (idx === -1) return false;
    _userExperiments.splice(idx, 1);
    delete _dataOverrides[experimentId];
    delete _savedReports[experimentId];
    await _apiDelete('/experiments?id=' + encodeURIComponent(experimentId));
    return true;
  }

  // ========== 样品查询 ==========
  function getExperimentSamples(experimentId) {
    const group = getExperiment(experimentId);
    return group ? group.samples : [];
  }

  function getSample(experimentId, sampleId) {
    const samples = getExperimentSamples(experimentId);
    return samples.find(s => s.id === sampleId) || null;
  }

  // ========== 释放数据持久化（API驱动） ==========
  async function saveTableData(experimentId, sampleId, rows) {
    if (!_dataOverrides[experimentId]) _dataOverrides[experimentId] = {};
    _dataOverrides[experimentId][sampleId] = {
      timePoints: rows.map(r => r.time),
      absorbance: rows.map(r => r.absorbance),
      sampleVols: rows.map(r => r.sampleVol),
      totalVols: rows.map(r => r.totalVol)
    };
    // 同步到API
    await _apiPost('/release', {
      sampleId, experimentId,
      rows: rows.map(r => ({
        time: r.time, absorbance: r.absorbance,
        sampleVol: r.sampleVol, totalVol: r.totalVol
      }))
    });
  }

  function getSavedTableData(experimentId, sampleId) {
    if (_dataOverrides[experimentId]) {
      return _dataOverrides[experimentId][sampleId] || null;
    }
    return null;
  }

  async function clearSavedTableData(experimentId, sampleId) {
    if (_dataOverrides[experimentId]) {
      delete _dataOverrides[experimentId][sampleId];
    }
    await _apiPost('/release', {
      sampleId, experimentId, rows: []
    });
  }

  // ========== 报告管理 ==========
  async function saveReport(experimentId, sampleId, report) {
    if (!_savedReports[experimentId]) _savedReports[experimentId] = {};
    if (!_savedReports[experimentId][sampleId]) _savedReports[experimentId][sampleId] = [];
    _savedReports[experimentId][sampleId].push(report);

    await _apiPost('/reports', {
      sampleId, experimentId,
      title: report.title || '',
      result: report,
      timestamp: report.timestamp || new Date().toISOString()
    });
  }

  async function getReports(experimentId, sampleId) {
    if (_savedReports[experimentId] && _savedReports[experimentId][sampleId]) {
      return _savedReports[experimentId][sampleId];
    }
    // 从API加载
    const reports = await _apiGet('/reports?sampleId=' + encodeURIComponent(sampleId) + '&experimentId=' + encodeURIComponent(experimentId));
    if (reports && Array.isArray(reports)) {
      if (!_savedReports[experimentId]) _savedReports[experimentId] = {};
      _savedReports[experimentId][sampleId] = reports;
      return reports;
    }
    return [];
  }

  async function deleteReport(experimentId, sampleId, index) {
    if (_savedReports[experimentId] && _savedReports[experimentId][sampleId]) {
      const report = _savedReports[experimentId][sampleId][index];
      if (report && report.id) {
        await _apiDelete('/reports?id=' + report.id);
      }
      _savedReports[experimentId][sampleId].splice(index, 1);
    }
  }

  // ========== 行级药量更新 ==========
  async function updateRowDrugData(experimentId, rowIndex, drugAmount, drugConc, concMode, concFormula, extraData) {
    const group = _userExperiments.find(e => e.id === experimentId);
    if (!group) return;
    const formulation = group.formulations[rowIndex];
    if (!formulation) return;

    formulation.perRowDrugAmount = drugAmount;
    formulation.perRowDrugConc = drugConc;
    formulation.perRowDrugConcMode = concMode;
    if (concFormula) formulation.perRowDrugConcFormula = concFormula;

    if (extraData) {
      if (extraData.density !== undefined) formulation.perRowDensity = extraData.density;
      if (extraData.takeVolume !== undefined) formulation.perRowTakeVolume = extraData.takeVolume;
      if (extraData.expDrugAmount !== undefined) formulation.perRowExpDrugAmount = extraData.expDrugAmount;
    }

    const expDrug = formulation.perRowExpDrugAmount !== undefined
      ? formulation.perRowExpDrugAmount : drugAmount;
    for (const sample of group.samples) {
      if (sample.formulation === formulation.name) {
        sample.totalDrug = expDrug;
        if (extraData) {
          if (extraData.density !== undefined) sample.density = extraData.density;
          if (extraData.takeVolume !== undefined) sample.takeVolume = extraData.takeVolume;
          if (extraData.expDrugAmount !== undefined) sample.expDrugAmount = extraData.expDrugAmount;
        }
      }
    }

    // 同步到API
    await _apiPut('/experiments', {
      id: experimentId, name: group.name, date: group.date,
      templateId: group.templateId || '',
      formulations: group.formulations,
      drugAmount: group.drugAmount, drugConc: group.drugConc,
      samples: group.samples
    });
  }

  // ========== 模板管理（V2: API持久化 + localStorage降级） ==========
  async function getUserTemplates() {
    const res = await _apiFetch('/api/data/templates', { method: 'GET' });
    if (res && res.ok) {
      try {
        const data = await res.json();
        if (data && data.data) return data.data;
      } catch {}
    }
    // 回退 localStorage
    try {
      const raw = localStorage.getItem('FasudilLLC_UserTemplates');
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  }

  async function saveUserTemplates(templates) {
    await _apiFetch('/api/data/templates', {
      method: 'POST',
      body: JSON.stringify(templates)
    });
    try {
      localStorage.setItem('FasudilLLC_UserTemplates', JSON.stringify(templates));
    } catch {}
  }

  async function getUserDefaultTemplateId() {
    const res = await _apiFetch('/api/data/preferences', { method: 'GET' });
    if (res && res.ok) {
      try {
        const data = await res.json();
        if (data && data.data && data.data.defaultTemplateId) {
          return data.data.defaultTemplateId;
        }
      } catch {}
    }
    try {
      return localStorage.getItem('FasudilLLC_DefaultTemplateId') || 'system_default';
    } catch {}
    return 'system_default';
  }

  async function saveUserDefaultTemplateId(tplId) {
    await _apiFetch('/api/data/preferences', {
      method: 'POST',
      body: JSON.stringify({ defaultTemplateId: tplId })
    });
    try {
      localStorage.setItem('FasudilLLC_DefaultTemplateId', tplId);
    } catch {}
  }

  async function getAllTemplates() {
    const userTemplates = await getUserTemplates();
    return {
      builtin: SYSTEM_DEFAULT_TEMPLATE,
      userTemplates: userTemplates.filter(t => !t.builtin),
      all: [SYSTEM_DEFAULT_TEMPLATE, ...userTemplates.filter(t => !t.builtin)]
    };
  }

  function getBuiltinTemplate() {
    return JSON.parse(JSON.stringify(SYSTEM_DEFAULT_TEMPLATE));
  }

  async function saveUserTemplate(tpl) {
    const templates = await getUserTemplates();
    const idx = templates.findIndex(t => t.id === tpl.id);
    if (idx >= 0) { templates[idx] = tpl; }
    else { templates.push(tpl); }
    await saveUserTemplates(templates);
  }

  async function deleteUserTemplate(tplId) {
    // 尝试API删除（每个模板独立）
    await _apiFetch('/api/data/templates?id=' + encodeURIComponent(tplId), { method: 'DELETE' });
    // 同时更新localStorage
    let templates = await getUserTemplates();
    templates = templates.filter(t => t.id !== tplId);
    await saveUserTemplates(templates);

    const defaultId = await getUserDefaultTemplateId();
    if (defaultId === tplId) {
      await saveUserDefaultTemplateId('system_default');
    }
  }

  function cloneTemplate(srcTpl) {
    const copy = JSON.parse(JSON.stringify(srcTpl));
    copy.id = 'tpl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    copy.builtin = false;
    copy.name = srcTpl.builtin ? (srcTpl.name + ' (副本)') : (srcTpl.name + ' (副本)');
    return copy;
  }

  async function isTemplateNameDuplicate(name, excludeId) {
    const templates = await getUserTemplates();
    return templates.some(t => t.name === name && t.id !== excludeId);
  }

  // ========== 公开 API ==========
  return {
    SYSTEM_DEFAULT_TEMPLATE,
    getAllExperiments,
    getExperiment,
    createExperiment,
    updateExperiment,
    deleteExperiment,
    getExperimentSamples,
    getSample,
    saveTableData,
    getSavedTableData,
    clearSavedTableData,
    saveReport,
    getReports,
    deleteReport,
    updateRowDrugData,
    // 模板 API
    getBuiltinTemplate,
    getUserTemplates,
    saveUserTemplates,
    saveUserTemplate,
    deleteUserTemplate,
    getUserDefaultTemplateId,
    saveUserDefaultTemplateId,
    getAllTemplates,
    cloneTemplate,
    isTemplateNameDuplicate,
    // 内部（用于预加载）
    _loadExperimentsFromAPI
  };
})();
