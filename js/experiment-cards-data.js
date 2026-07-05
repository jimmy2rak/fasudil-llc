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

    // 保留旧的表格编辑数据
    const oldOverrides = _dataOverrides[experimentId] || {};
    _dataOverrides[experimentId] = {};

    group.samples = [];
    const formulations = data.formulations || [];
    const rows = data.rows || [];

    for (let fi = 0; fi < formulations.length; fi++) {
      const f = formulations[fi];
      const rowData = rows[fi] || {};

      const rowDrugAmount = rowData.drugAmount !== undefined
        ? parseFloat(rowData.drugAmount) || 0
        : (parseFloat(data.totalDrug) || 0) * (f.samples || []).length;

      // 新增字段：密度、取用体积、实验药量
      const rowExpDrugAmount = parseFloat(rowData.expDrugAmount) || 0;
      const rowDensity = parseFloat(rowData.density) || 0;
      const rowTakeVolume = parseFloat(rowData.takeVolume) || 0;

      // 强制使用实验药量作为单样品总药量
      const sampleTotalDrug = rowData.expDrugAmount !== undefined ? rowExpDrugAmount : rowDrugAmount;

      // 【取消平分】每个样品使用完整实验药量，不复数均分
      for (const sid of (f.samples || [])) {
        const sample = {
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
        if (oldOverrides[sid]) {
          _dataOverrides[experimentId][sid] = oldOverrides[sid];
        }
        group.samples.push(sample);
      }

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

    group.name = data.experimentName || group.name;
    group.date = data.date || group.date;
    group.drugAmount = data.drugAmount || group.drugAmount;
    group.drugConc = data.drugConc || group.drugConc;
    group.formulations = formulations;

    // 清理可能被删除的样品的旧编辑数据
    const currentIds = new Set(group.samples.map(s => s.id));
    for (const oldId of Object.keys(_dataOverrides[experimentId] || {})) {
      if (!currentIds.has(oldId)) delete _dataOverrides[experimentId][oldId];
    }

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

  // ========== 模板数据持久化 ==========
  /**
   * 获取所有模板（从 user_data /api/data/template）
   * 注：本地模式使用 localStorage + user_data 统一存储
   */
  async function getTemplates() {
    try {
      const raw = localStorage.getItem('FasudilLLC_Templates');
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  }

  async function saveTemplates(templates) {
    try {
      localStorage.setItem('FasudilLLC_Templates', JSON.stringify(templates));
      // 同步到后端（静默失败，不影响本地操作）
      for (const tpl of templates) {
        await fetch('/api/data/template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: tpl.id, value: tpl })
        }).catch(() => {});
      }
    } catch {}
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
    getTemplates,
    saveTemplates,
    _saveToStorage
  };
})();
