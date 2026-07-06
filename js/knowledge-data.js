/**
 * 知识库数据存储层（V1）
 * 策略：localStorage 优先（即时可用、离线可用），云端 FSManager 降级（best-effort）。
 * 报告数据模型：
 * {
 *   id, title,
 *   sourceType: 'upload' | 'experiment' | 'manual',  // 来源：上传文件 / 实验记录 / 手动
 *   sourceId, sourceName,                              // 来源标识（如实验 id / 文件名）
 *   tags: [], summary, content,                        // content 为 HTML 或纯文本
 *   metrics: {},                                       // 关键指标（可选）
 *   createdAt, updatedAt
 * }
 */
const KnowledgeData = (function () {
  const KEY = 'FasudilLLC_Knowledge_Reports';

  function _readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('[KnowledgeData] 读取失败:', e.message);
      return [];
    }
  }

  function _writeAll(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      console.warn('[KnowledgeData] 写入失败:', e.message);
      return false;
    }
  }

  /** 获取全部报告（按创建时间倒序） */
  function getAllReports() {
    return _readAll().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /** 按来源类型过滤 */
  function getReportsBySource(sourceType) {
    return getAllReports().filter(r => r.sourceType === sourceType);
  }

  /** 获取单个报告 */
  function getReport(id) {
    return _readAll().find(r => r.id === id) || null;
  }

  /** 保存报告（无 id 则新建，有 id 则更新）。云端降级不阻塞本地写入。 */
  function saveReport(report) {
    const list = _readAll();
    const now = Date.now();
    if (report.id) {
      const idx = list.findIndex(r => r.id === report.id);
      if (idx >= 0) {
        list[idx] = Object.assign({}, list[idx], report, { updatedAt: now });
      } else {
        report.createdAt = report.createdAt || now;
        report.updatedAt = now;
        list.push(report);
      }
    } else {
      report.id = 'kb-' + now + '-' + Math.random().toString(36).slice(2, 7);
      report.createdAt = now;
      report.updatedAt = now;
      list.push(report);
    }
    _writeAll(list);
    // 云端降级（best-effort，不阻塞）
    if (typeof FSManager !== 'undefined' && FSManager.createLiterature) {
      try { FSManager.createLiterature(report).catch(() => {}); } catch (e) {}
    }
    return report;
  }

  /** 删除报告 */
  function deleteReport(id) {
    const list = _readAll().filter(r => r.id !== id);
    _writeAll(list);
    return true;
  }

  return {
    getAllReports,
    getReportsBySource,
    getReport,
    saveReport,
    deleteReport
  };
})();

if (typeof window !== 'undefined') window.KnowledgeData = KnowledgeData;
