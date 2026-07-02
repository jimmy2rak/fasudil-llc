/* ========================================
   experiment-cards-data.js
   实验数据管理 — EdgeOne API 版
   localStorage 持久化 → Turso API 持久化
   ======================================== */

const ExperimentData = (() => {
  const DATA_TYPE = 'app_state';
  const DATA_KEY = 'experiment_data';

  // 内存缓存
  let _userExperiments = [];
  let _dataOverrides = {};
  let _savedReports = {};

  // 是否已从服务器加载
  let _loaded = false;

  // ========== API 持久化 ==========

  /** 从服务器加载数据 */
  async function _loadFromServer() {
    try {
      const res = await fetch(`/api/data/${DATA_TYPE}/${DATA_KEY}`);
      if (res.ok) {
        const result = await res.json();
        if (result.data) {
          _userExperiments = result.data.experiments || [];
          _dataOverrides = result.data.overrides || {};
          _savedReports = result.data.reports || {};
          _loaded = true;
          return;
        }
      }
    } catch (e) {
      console.warn('[ExperimentData] 从服务器加载失败，使用空数据:', e.message);
    }
    // 默认空数据
    _userExperiments = [];
    _dataOverrides = {};
    _savedReports = {};
    _loaded = true;
  }

  /** 保存到服务器 */
  async function _saveToServer() {
    try {
      await fetch(`/api/data/${DATA_TYPE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: DATA_KEY,
          value: {
            experiments: _userExperiments,
            overrides: _dataOverrides,
            reports: _savedReports
          }
        })
      });
    } catch (e) {
      console.warn('[ExperimentData] 保存到服务器失败:', e.message);
    }
  }

  // 启动时从服务器加载
  const _initPromise = _loadFromServer();

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

    for (const f of formulations) {
      for (const sid of (f.samples || [])) {
        samples.push({
          id: sid,
          experimentId: id,
          formulation: f.name,
          formulationComponents: f.components,
          formulationTotal: f.total,
          totalDrug: parseFloat(data.totalDrug) || 0,
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
        });
      }
    }

    const group = {
      id,
      name: data.experimentName || '',
      date: data.date || '',
      drugAmount: data.drugAmount || 0,
      drugConc: data.drugConc || 0,
      formulations,
      samples,
      createdAt: Date.now()
    };

    _userExperiments.unshift(group);
    _saveToServer();
    return group;
  }

  function updateExperiment(experimentId, data) {
    const group = _userExperiments.find(e => e.id === experimentId);
    if (!group) return null;

    const oldOverrides = _dataOverrides[experimentId] || {};
    _dataOverrides[experimentId] = {};

    group.samples = [];
    const formulations = data.formulations || [];
    for (const f of formulations) {
      for (const sid of (f.samples || [])) {
        const sample = {
          id: sid,
          experimentId: experimentId,
          formulation: f.name,
          formulationComponents: f.components,
          formulationTotal: f.total,
          totalDrug: parseFloat(data.totalDrug) || 0,
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
    }

    group.name = data.experimentName || group.name;
    group.date = data.date || group.date;
    group.drugAmount = data.drugAmount || group.drugAmount;
    group.drugConc = data.drugConc || group.drugConc;
    group.formulations = formulations;

    const currentIds = new Set(group.samples.map(s => s.id));
    for (const oldId of Object.keys(_dataOverrides[experimentId] || {})) {
      if (!currentIds.has(oldId)) delete _dataOverrides[experimentId][oldId];
    }

    _saveToServer();
    return group;
  }

  function deleteExperiment(experimentId) {
    const idx = _userExperiments.findIndex(e => e.id === experimentId);
    if (idx === -1) return false;
    _userExperiments.splice(idx, 1);
    delete _dataOverrides[experimentId];
    delete _savedReports[experimentId];
    _saveToServer();
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

  // ========== 表格数据持久化 ==========

  function saveTableData(experimentId, sampleId, rows) {
    if (!_dataOverrides[experimentId]) _dataOverrides[experimentId] = {};
    _dataOverrides[experimentId][sampleId] = {
      timePoints: rows.map(r => r.time),
      absorbance: rows.map(r => r.absorbance),
      sampleVols: rows.map(r => r.sampleVol),
      totalVols: rows.map(r => r.totalVol)
    };
    _saveToServer();
  }

  function getSavedTableData(experimentId, sampleId) {
    if (!_dataOverrides[experimentId]) return null;
    return _dataOverrides[experimentId][sampleId] || null;
  }

  function clearSavedTableData(experimentId, sampleId) {
    if (_dataOverrides[experimentId]) {
      delete _dataOverrides[experimentId][sampleId];
      _saveToServer();
    }
  }

  // ========== 报告管理 ==========

  function saveReport(experimentId, sampleId, report) {
    if (!_savedReports[experimentId]) _savedReports[experimentId] = {};
    if (!_savedReports[experimentId][sampleId]) _savedReports[experimentId][sampleId] = [];
    _savedReports[experimentId][sampleId].push(report);
    _saveToServer();
  }

  function getReports(experimentId, sampleId) {
    if (!_savedReports[experimentId]) return [];
    return _savedReports[experimentId][sampleId] || [];
  }

  function deleteReport(experimentId, sampleId, index) {
    if (_savedReports[experimentId] && _savedReports[experimentId][sampleId]) {
      _savedReports[experimentId][sampleId].splice(index, 1);
      _saveToServer();
    }
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
    _saveToServer
  };
})();
