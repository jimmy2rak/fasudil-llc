/* ========================================
   experiment-cards-data.js
   实验数据管理 — 无预设样本，纯用户创建
   localStorage 持久化，实验级数据隔离
   ======================================== */

const ExperimentData = (() => {
  const STORAGE_KEY = 'FasudilLLC_Experiments';

  // 所有用户实验组
  let _userExperiments = [];

  // 表格编辑数据：{ experimentId: { sampleId: {timePoints:[], absorbance:[], sampleVols:[], totalVols:[]} } }
  let _dataOverrides = {};

  // 报告存储：{ experimentId: { sampleId: [{title, timestamp, result}] } }
  let _savedReports = {};

  // ========== localStorage 持久化 ==========
  function _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        _userExperiments = data.experiments || [];
        _dataOverrides = data.overrides || {};
        _savedReports = data.reports || {};
      }
    } catch (e) { /* 忽略损坏的数据 */ }
  }

  function _saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        experiments: _userExperiments,
        overrides: _dataOverrides,
        reports: _savedReports
      }));
    } catch (e) { /* 配额满时忽略 */ }
  }

  // 启动时加载
  _loadFromStorage();

  // ========== 实验组 CRUD ==========
  function getAllExperiments() {
    return _userExperiments;
  }

  function getExperiment(experimentId) {
    return _userExperiments.find(e => e.id === experimentId) || null;
  }

  function createExperiment(data) {
    const id = 'exp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const samples = [];
    const formulations = data.formulations || [];
    const rows = data.rows || []; // 新增：每行独立数据数组

    for (let fi = 0; fi < formulations.length; fi++) {
      const f = formulations[fi];
      const rowData = rows[fi] || {};

      // 每行的独立药量（优先使用行级数据，兼容旧全局数据）
      const rowDrugAmount = rowData.drugAmount !== undefined
        ? parseFloat(rowData.drugAmount) || 0
        : (parseFloat(data.totalDrug) || 0) * (f.samples || []).length;

      const rowDrugConc = rowData.drugConc !== undefined
        ? parseFloat(rowData.drugConc) || 0
        : (parseFloat(data.drugConc) || 0);

      const rowConcMode = rowData.drugConcMode || data.drugConcMode || 'manual';

      // 新增字段：密度、取用体积、实验药量
      const rowDensity = parseFloat(rowData.density) || 0;
      const rowTakeVolume = parseFloat(rowData.takeVolume) || 0;
      const rowExpDrugAmount = parseFloat(rowData.expDrugAmount) || 0;

      // 强制使用实验药量作为单样品总药量（新旧兼容：检测字段是否存在）
      // 新实验 rowData.expDrugAmount 始终有值 → totalDrug = 计算出的实验药量
      // 旧实验 rowData.expDrugAmount 无定义 → totalDrug = rowDrugAmount 降级
      const sampleTotalDrug = rowData.expDrugAmount !== undefined ? rowExpDrugAmount : rowDrugAmount;

      // 【取消平分】每个样品使用完整实验药量，不复数均分
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
          timePoints: [],
          absorbance: [],
          sampleVols: [],
          totalVols: [],
          concentration: [],
          cumulativeRelease: [],
          releaseRate: [],
          finalRate: 0,
          residualAbs: 0,
          residualAmount: 0,
          residualRate: 0,
          totalRecovery: 0
        };
        samples.push(sample);
      }

      // 将行级数据存储到 formulation 对象
      f.perRowDrugAmount = rowDrugAmount;
      f.perRowDrugConc = rowDrugConc;
      f.perRowDrugConcMode = rowConcMode;
      if (rowData.drugConcFormula) f.perRowDrugConcFormula = rowData.drugConcFormula;
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

    _userExperiments.unshift(group);
    _saveToStorage();
    return group;
  }

  function updateExperiment(experimentId, data) {
    const group = _userExperiments.find(e => e.id === experimentId);
    if (!group) return null;

    // ===== 核心修复：不销毁样品，保留所有手动录入数据 =====
    // 保留旧样品的引用，用于匹配更新
    const existingSamples = group.samples || [];
    const allOverrides = _dataOverrides[experimentId] || {};

    const formulations = data.formulations || [];
    const rows = data.rows || [];
    const updatedSampleIds = new Set(); // 跟踪被更新的样品ID

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

      // 此处方关联的样品ID列表（来自多选下拉）
      const targetSampleIds = f.samples || [];

      for (const sid of targetSampleIds) {
        updatedSampleIds.add(sid);
        // 查找是否已存在此样品
        const existing = existingSamples.find(s => s.id === sid);
        if (existing) {
          // 【保留手动数据】仅更新配方参数，不动 timePoints/absorbance 等手动数据
          existing.formulation = f.name;
          existing.formulationComponents = f.components;
          existing.formulationTotal = f.total;
          existing.totalDrug = sampleTotalDrug;
          existing.density = rowDensity;
          existing.takeVolume = rowTakeVolume;
          existing.expDrugAmount = rowExpDrugAmount;
          existing.group = data.groupName || data.experimentName || '';
        } else {
          // 理论上编辑模式下不会走到这里（下拉只展示已有样品）
          // 安全兜底：创建新样品，但保留字段初始化
          const ns = {
            id: sid,
            experimentId: experimentId,
            formulation: f.name,
            formulationComponents: f.components,
            formulationTotal: f.total,
            totalDrug: sampleTotalDrug,
            density: rowDensity,
            takeVolume: rowTakeVolume,
            expDrugAmount: rowExpDrugAmount,
            group: data.groupName || data.experimentName || '',
            timePoints: [],
            absorbance: [],
            sampleVols: [],
            totalVols: [],
            concentration: [],
            cumulativeRelease: [],
            releaseRate: [],
            finalRate: 0,
            residualAbs: 0,
            residualAmount: 0,
            residualRate: 0,
            totalRecovery: 0
          };
          existingSamples.push(ns);
        }
      }

      // 存储行级配方数据
      f.perRowDrugAmount = rowDrugAmount;
      f.perRowDrugConc = rowData.drugConc !== undefined
        ? parseFloat(rowData.drugConc) || 0
        : (parseFloat(data.drugConc) || 0);
      f.perRowDrugConcMode = rowData.drugConcMode || data.drugConcMode || 'manual';
      if (rowData.drugConcFormula) f.perRowDrugConcFormula = rowData.drugConcFormula;
      f.perRowDensity = rowDensity;
      f.perRowTakeVolume = rowTakeVolume;
      f.perRowExpDrugAmount = rowExpDrugAmount;
      if (rowData._values) f._rowData = rowData._values;
    }

    // 更新实验组元数据
    group.name = data.experimentName || group.name;
    group.date = data.date || group.date;
    group.drugAmount = data.drugAmount || group.drugAmount;
    group.drugConc = data.drugConc || group.drugConc;
    group.formulations = formulations;

    // 清理未被任何处方引用的样品的旧编辑数据
    for (const oldId of Object.keys(allOverrides)) {
      if (!updatedSampleIds.has(oldId)) delete allOverrides[oldId];
    }
    _dataOverrides[experimentId] = allOverrides;

    _saveToStorage();
    return group;
  }

  function deleteExperiment(experimentId) {
    const idx = _userExperiments.findIndex(e => e.id === experimentId);
    if (idx === -1) return false;
    _userExperiments.splice(idx, 1);
    delete _dataOverrides[experimentId];
    delete _savedReports[experimentId];
    _saveToStorage();
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

  // ========== 表格数据持久化（实验隔离） ==========
  function saveTableData(experimentId, sampleId, rows) {
    if (!_dataOverrides[experimentId]) _dataOverrides[experimentId] = {};
    _dataOverrides[experimentId][sampleId] = {
      timePoints: rows.map(r => r.time),
      absorbance: rows.map(r => r.absorbance),
      sampleVols: rows.map(r => r.sampleVol),
      totalVols: rows.map(r => r.totalVol)
    };
    _saveToStorage();
  }

  function getSavedTableData(experimentId, sampleId) {
    if (!_dataOverrides[experimentId]) return null;
    return _dataOverrides[experimentId][sampleId] || null;
  }

  function clearSavedTableData(experimentId, sampleId) {
    if (_dataOverrides[experimentId]) {
      delete _dataOverrides[experimentId][sampleId];
      _saveToStorage();
    }
  }

  // ========== 报告管理（实验隔离） ==========
  function saveReport(experimentId, sampleId, report) {
    if (!_savedReports[experimentId]) _savedReports[experimentId] = {};
    if (!_savedReports[experimentId][sampleId]) _savedReports[experimentId][sampleId] = [];
    _savedReports[experimentId][sampleId].push(report);
    _saveToStorage();
  }

  function getReports(experimentId, sampleId) {
    if (!_savedReports[experimentId]) return [];
    return _savedReports[experimentId][sampleId] || [];
  }

  function deleteReport(experimentId, sampleId, index) {
    if (_savedReports[experimentId] && _savedReports[experimentId][sampleId]) {
      _savedReports[experimentId][sampleId].splice(index, 1);
      _saveToStorage();
    }
  }

  // ========== 新增：每行独立药量/浓度更新（每行独立药量模式） ==========
  /**
   * 更新某一行的独立药量/浓度数据
   * @param {string} experimentId - 实验组ID
   * @param {number} rowIndex - 行索引
   * @param {number} drugAmount - 本行加入药量(mg)
   * @param {number} drugConc - 本行载药浓度(mg/ml)
   * @param {string} concMode - 'manual' 或 'formula'
   * @param {string} concFormula - 自定义公式（可选）
   * @param {object} extraData - 额外字段 { density, takeVolume, expDrugAmount }
   */
  function updateRowDrugData(experimentId, rowIndex, drugAmount, drugConc, concMode, concFormula, extraData) {
    const group = _userExperiments.find(e => e.id === experimentId);
    if (!group) return;
    const formulation = group.formulations[rowIndex];
    if (!formulation) return;

    formulation.perRowDrugAmount = drugAmount;
    formulation.perRowDrugConc = drugConc;
    formulation.perRowDrugConcMode = concMode;
    if (concFormula) formulation.perRowDrugConcFormula = concFormula;

    // 存储新增列字段
    if (extraData) {
      if (extraData.density !== undefined) formulation.perRowDensity = extraData.density;
      if (extraData.takeVolume !== undefined) formulation.perRowTakeVolume = extraData.takeVolume;
      if (extraData.expDrugAmount !== undefined) formulation.perRowExpDrugAmount = extraData.expDrugAmount;
    }

    // 更新关联样品的 totalDrug（强制使用实验药量，不复数均分，不降级回 rowDrugAmount）
    const expDrug = formulation.perRowExpDrugAmount !== undefined
      ? formulation.perRowExpDrugAmount
      : drugAmount;
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
    _saveToStorage();
  }

  // ==================================================================
  // 模板数据持久化 — 双架构：系统内置只读 + 用户自定义持久化
  // 存储方式：后端 API /api/data/template（key: user_templates, user_default_template）
  // 本地回退：localStorage（开发/离线模式）
  // ==================================================================

  /** 系统内置标准模板（只读，前端硬编码） */
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

  /** 通用 API fetch（带上 credentials） */
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
        // 未登录时静默降级到 localStorage
        return null;
      }
      return res;
    } catch {
      return null; // 网络错误静默处理
    }
  }

  /** 从后端或 localStorage 获取用户自定义模板数组 */
  async function getUserTemplates() {
    // 优先从后端获取
    const res = await _apiFetch('/api/data/settings/templates', { method: 'GET' });
    if (res && res.ok) {
      try {
        const data = await res.json();
        if (data && data.data) return data.data;
      } catch {}
    }
    // 后端不可用 → 回退到 localStorage
    try {
      const raw = localStorage.getItem('FasudilLLC_UserTemplates');
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  }

  /** 保存用户自定义模板数组到后端 + localStorage */
  async function saveUserTemplates(templates) {
    // 同步到后端
    const res = await _apiFetch('/api/data/settings/templates', {
      method: 'PUT',
      body: JSON.stringify({ value: templates })
    });
    // 始终同时写入 localStorage（离线兜底）
    try {
      localStorage.setItem('FasudilLLC_UserTemplates', JSON.stringify(templates));
    } catch {}
    return res && res.ok;
  }

  /** 从后端或 localStorage 获取用户首选模板ID */
  async function getUserDefaultTemplateId() {
    const res = await _apiFetch('/api/data/settings/defaultTemplate', { method: 'GET' });
    if (res && res.ok) {
      try {
        const data = await res.json();
        if (data && data.data) return data.data;
      } catch {}
    }
    // 后端不可用 → 回退到 localStorage
    try {
      return localStorage.getItem('FasudilLLC_DefaultTemplateId') || 'system_default';
    } catch {}
    return 'system_default';
  }

  /** 保存用户首选模板ID到后端 + localStorage */
  async function saveUserDefaultTemplateId(tplId) {
    const res = await _apiFetch('/api/data/settings/defaultTemplate', {
      method: 'PUT',
      body: JSON.stringify({ value: tplId })
    });
    try {
      localStorage.setItem('FasudilLLC_DefaultTemplateId', tplId);
    } catch {}
    return res && res.ok;
  }

  /**
   * 获取完整模板列表（内置 + 用户自定义）
   * 返回格式：{ builtin, userTemplates, all }
   */
  async function getAllTemplates() {
    const userTemplates = await getUserTemplates();
    return {
      builtin: SYSTEM_DEFAULT_TEMPLATE,
      userTemplates: userTemplates.filter(t => !t.builtin),
      all: [SYSTEM_DEFAULT_TEMPLATE, ...userTemplates.filter(t => !t.builtin)]
    };
  }

  /**
   * 获取系统内置标准模板（只读副本）
   */
  function getBuiltinTemplate() {
    return JSON.parse(JSON.stringify(SYSTEM_DEFAULT_TEMPLATE));
  }

  /**
   * 保存单个用户自定义模板（增/改）
   * @param {object} tpl - 模板对象（含 id）
   */
  async function saveUserTemplate(tpl) {
    const templates = await getUserTemplates();
    const idx = templates.findIndex(t => t.id === tpl.id);
    if (idx >= 0) {
      templates[idx] = tpl;
    } else {
      templates.push(tpl);
    }
    await saveUserTemplates(templates);
  }

  /**
   * 删除用户自定义模板
   * @param {string} tplId - 模板ID
   */
  async function deleteUserTemplate(tplId) {
    let templates = await getUserTemplates();
    templates = templates.filter(t => t.id !== tplId);
    await saveUserTemplates(templates);
    // 如果被删除的是首选模板，重置为系统内置
    const defaultId = await getUserDefaultTemplateId();
    if (defaultId === tplId) {
      await saveUserDefaultTemplateId('system_default');
    }
  }

  /**
   * 复制模板（生成新模板对象）
   * @param {object} srcTpl - 源模板
   * @returns {object} 复制后的新模板
   */
  function cloneTemplate(srcTpl) {
    const copy = JSON.parse(JSON.stringify(srcTpl));
    copy.id = 'tpl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    copy.builtin = false;
    copy.name = srcTpl.builtin ? (srcTpl.name + ' (副本)') : (srcTpl.name + ' (副本)');
    return copy;
  }

  /** 检查模板名称是否重复（排除自身） */
  async function isTemplateNameDuplicate(name, excludeId) {
    const templates = await getUserTemplates();
    return templates.some(t => t.name === name && t.id !== excludeId);
  }

  // ========== 公开 API ==========
  return {
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
    SYSTEM_DEFAULT_TEMPLATE,
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
    _saveToStorage
  };
})();
