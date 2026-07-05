/* ========================================
   fs-manager.js — 数据层适配器（EdgeOne API 版）
   保留原接口签名，内部实现改为 API 调用
   原 FSA + IndexedDB 操作 → fetch('/api/data/:type')
   ======================================== */

const FSManager = (() => {

  /**
   * 统一响应处理：401 时触发强制登出
   */
  function _handleResponse(res) {
    if (res.status === 401) {
      console.warn('[FSManager] 接口 401，执行强制登出');
      // 清除所有凭证
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
      document.cookie.split(';').forEach(c => {
        document.cookie = c.replace(/^ +/, '').replace(/=.*/, `=; expires=${new Date(0).toUTCString()}; path=/`);
      });
      window.location.replace('/');
      throw new Error('登录已过期，请重新登录');
    }
    return res;
  }

  // --- 通用 API 调用 ---

  /** 获取某类型全部数据 */
  async function apiList(type) {
    const res = _handleResponse(await fetch(`/api/data/${type}`));
    if (!res.ok) throw new Error(`API 请求失败: ${res.status}`);
    const data = await res.json();
    return data.items || [];
  }

  /** 获取单条数据 */
  async function apiGet(type, key) {
    const res = _handleResponse(await fetch(`/api/data/${type}/${key}`));
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`API 请求失败: ${res.status}`);
    }
    const data = await res.json();
    return data.data || null;
  }

  /** 创建/覆盖数据 */
  async function apiPut(type, key, value) {
    const res = _handleResponse(await fetch(`/api/data/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value })
    }));
    if (!res.ok) throw new Error(`API 写入失败: ${res.status}`);
    return res.json();
  }

  /** 更新数据 */
  async function apiUpdate(type, key, value) {
    const res = _handleResponse(await fetch(`/api/data/${type}/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    }));
    if (!res.ok) throw new Error(`API 更新失败: ${res.status}`);
    return res.json();
  }

  /** 删除数据 */
  async function apiDelete(type, key) {
    const res = _handleResponse(await fetch(`/api/data/${type}/${key}`, { method: 'DELETE' }));
    if (!res.ok) throw new Error(`API 删除失败: ${res.status}`);
    return res.json();
  }

  // --- 目录授权（云端版：无需选择目录） ---

  async function selectDirectory() {
    console.warn('[FSManager] 云端版无需选择目录');
    return null;
  }

  async function reauthDirectory() {
    console.warn('[FSManager] 云端版无需重新授权');
    return null;
  }

  async function initDirectory() {
    // 云端版：始终自动进入主应用
    return { needsSelect: false, needsReauth: false };
  }

  async function ensureProjectStructure() {
    // 云端版：无需创建本地文件结构
    return true;
  }

  // --- JSON 数据读写（通用接口） ---
  // 原签名: readJSON(dir, id, filename) → 解析成 data_type 和 key
  // 简化：调用方传完整路径，我们映射到 API

  function pathToTypeKey(...segments) {
    // segments 示例: ['experiments', 'expId', 'meta.json']
    // 映射: experiments → experiment, knowledge → knowledge, settings → settings, rules → rules
    if (segments.length < 2) return { type: 'settings', key: 'default' };

    const dirMap = {
      'experiments': 'experiment',
      'knowledge': 'knowledge',
    };

    const first = segments[0];
    const type = dirMap[first] || first;
    const key = segments[1]; // 第二段是 ID

    // 对于 settings 和 rules，使用固定 key
    if (first === 'settings' || first === 'rules') {
      return { type: first, key: 'default' };
    }

    return { type, key };
  }

  async function readJSON(...segments) {
    const { type, key } = pathToTypeKey(segments);
    const data = await apiGet(type, key);
    return data;
  }

  async function writeJSON(...segments) {
    const value = segments.pop(); // 最后一个参数是 value
    const { type, key } = pathToTypeKey(segments);
    await apiPut(type, key, value);
    return true;
  }

  async function deleteJSON(...segments) {
    const { type, key } = pathToTypeKey(segments);
    if (key && key !== 'default') {
      await apiDelete(type, key);
    }
    return true;
  }

  // --- 实验管理 ---

  async function createExperiment(expData) {
    const expId = generateExpId();
    const fullData = {
      id: expId,
      name: expData.name || '未命名实验',
      date: new Date().toISOString().slice(0, 10),
      description: expData.description || '',
      samples: expData.samples || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await apiPut('experiment', expId, fullData);
    return expId;
  }

  async function listExperiments() {
    const items = await apiList('experiment');
    return items.map(item => item.data || item);
  }

  async function softDeleteExperiment(expId) {
    // 云端版：直接删除
    await apiDelete('experiment', expId);
  }

  async function restoreExperiment(expId) {
    console.warn('[FSManager] 云端版不支持恢复已删除实验');
  }

  // --- 知识库管理 ---

  async function createLiterature(litData) {
    const litId = generateLitId();
    await apiPut('knowledge', litId, litData);
    return litId;
  }

  async function listLiterature() {
    const items = await apiList('knowledge');
    return items.map(item => item.data || item);
  }

  async function createExperience(expData) {
    const id = 'exp-' + Date.now();
    await apiPut('knowledge', id, { ...expData, type: 'experience' });
    return id;
  }

  // --- 图片文件（云端版暂不支持上传图片） ---

  async function saveImageFile(expId, fileName, blob) {
    console.warn('[FSManager] 云端版暂不支持图片存储');
    return false;
  }

  async function getImageBlob(expId, fileName) {
    console.warn('[FSManager] 云端版暂不支持图片读取');
    return null;
  }

  async function getThumbnailBlob(expId, fileName) {
    console.warn('[FSManager] 云端版暂不支持图片读取');
    return null;
  }

  async function saveUploadedFile(subDir, fileName, blob) {
    console.warn('[FSManager] 云端版暂不支持文件上传');
    return null;
  }

  async function saveExperimentFile(expId, subDir, fileName, blob) {
    console.warn('[FSManager] 云端版暂不支持文件存储');
    return null;
  }

  async function saveImportedDoc(key, docData) {
    await apiPut('knowledge', key, docData);
    return true;
  }

  // --- 设置 ---

  async function getSettings() {
    const data = await apiGet('settings', 'default');
    return data || { apiConfigs: [], activeApi: null, theme: 'light' };
  }

  async function getRules() {
    const data = await apiGet('rules', 'default');
    return data || { rules: [] };
  }

  // --- 辅助 ---

  function getDirName() {
    return '云端数据库';
  }

  function isConnected() {
    return true;
  }

  function getHandle() { return null; }
  function getDirHandle() { return null; }

  function getExperimentDir(expId) {
    return `experiments/${expId}`;
  }

  function generateExpId() {
    return 'exp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function generateLitId() {
    return 'lit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function generateRuleId() {
    return 'rule_' + Date.now();
  }

  // --- 公共接口 ---
  return {
    selectDirectory,
    reauthDirectory,
    initDirectory,
    ensureProjectStructure,
    readJSON,
    writeJSON,
    deleteJSON,
    createExperiment,
    listExperiments,
    softDeleteExperiment,
    restoreExperiment,
    createLiterature,
    listLiterature,
    createExperience,
    saveImageFile,
    getImageBlob,
    getThumbnailBlob,
    saveUploadedFile,
    saveExperimentFile,
    saveImportedDoc,
    getSettings,
    getRules,
    getDirName,
    isConnected,
    getHandle,
    getDirHandle,
    getExperimentDir,
    generateExpId,
    generateLitId,
    generateRuleId
  };
})();
