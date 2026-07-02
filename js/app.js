/* ========================================
   app.js — 应用入口、路由、状态管理（EdgeOne 版）
   页面渲染、上传处理、实验管理
   ======================================== */

const App = (() => {
  let currentPage = 'dashboard';
  let experimentsCache = [];
  let initialized = false;
  let _parsedFiles = {}; // 缓存解析结果，供保存到实验时使用
  let _lastUploadFileName = '';

  // --- 启动流程（EdgeOne 版） ---
  async function init() {
    console.log('[Fasudil-LLC] App.init()');

    // 1. 检查登录状态
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        console.log('[Fasudil-LLC] 已登录:', data.user?.email);
        // 已登录 → 进入主应用
        await enterMainApp();
      } else {
        // 未登录 → 显示登录页
        showLoginScreen();
      }
    } catch (err) {
      console.error('[Fasudil-LLC] 登录检查失败:', err.message);
      // 网络错误时也显示登录页
      showLoginScreen();
    }
  }

  /** 显示登录页 */
  function showLoginScreen() {
    const loginScreen = document.getElementById('login-screen');
    const appMain = document.getElementById('app-main');
    if (loginScreen) loginScreen.style.display = 'flex';
    if (appMain) appMain.style.display = 'none';

    const container = document.getElementById('login-form-container');
    if (container) {
      UI.renderLoginForm(container);
    }
  }

  /** 进入主应用 */
  async function enterMainApp() {
    try {
      // 切换到主界面
      const loginScreen = document.getElementById('login-screen');
      const appMain = document.getElementById('app-main');
      if (loginScreen) loginScreen.style.display = 'none';
      if (appMain) appMain.style.display = 'block';

      // 加载规则
      try { await ML.loadRules(); } catch (e) { console.warn('加载规则失败:', e.message); }

      // 进入首页
      await navigate('dashboard');
      initialized = true;
      console.log('[Fasudil-LLC] 应用初始化成功');
    } catch (err) {
      console.error('[Fasudil-LLC] 初始化失败:', err.message);
      UI.toast('系统初始化失败: ' + err.message, 'error', 5000);
    }
  }

  /** 退出登录 */
  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { /* ignore */ }
    window.location.href = '/';
  }

  // --- 路由 ---
  function navigate(page) {
    currentPage = page;

    // 更新侧边栏选中状态
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // 渲染页面内容
    const content = document.getElementById('app-content');
    if (!content) return;
    content.innerHTML = '';

    switch (page) {
      case 'dashboard': renderDashboard(content); break;
      case 'upload': renderUploadPage(content); break;
      case 'experiments': renderExperimentsPage(content); break;
      case 'calculations': renderCalculationsPage(content); break;
      case 'knowledge': renderKnowledgePage(content); break;
      case 'prescription': renderPrescriptionPage(content); break;
      case 'sample': renderSamplePage(content); break;
      case 'settings': showSettings(); break;
    }

    return page;
  }

  function renderDashboard(container) {
    const experiments = ExperimentData.getAllExperiments();
    let totalSamples = 0, totalFinalRate = 0, rateCount = 0, totalResidual = 0, residualCount = 0, totalRecovery = 0, recoveryCount = 0;

    for (const exp of experiments) {
      for (const s of (exp.samples || [])) {
        totalSamples++;
        // 从 dataOverrides 实时计算
        const saved = ExperimentData.getSavedTableData(exp.id, s.id);
        let finalRate = s.finalRate || 0;
        if (saved && saved.absorbance && saved.absorbance.length > 0) {
          const concs = saved.absorbance.map(a => 2 * (a - 0.00414128) / 0.0136697);
          const tv = saved.totalVols[0] || 30, sv = saved.sampleVols[0] || 2;
          const cum = [];
          for (let i = 0; i < concs.length; i++) {
            let ss = 0;
            for (let j = 0; j < i; j++) ss += concs[j] * sv;
            cum.push((concs[i] * tv + ss) / 1000);
          }
          const rates = cum.map(c => (c / s.totalDrug) * 100);
          finalRate = rates.length > 0 ? rates[rates.length - 1] : 0;
        }
        if (finalRate > 0) { totalFinalRate += finalRate; rateCount++; }
        const rr = s.residualRate || 0;
        if (rr > 0) { totalResidual += rr; residualCount++; }
        const tr = finalRate + rr;
        if (tr > 0) { totalRecovery += tr; recoveryCount++; }
      }
    }

    const stats = [
      { label: '实验组', value: experiments.length },
      { label: '总样品数', value: totalSamples },
      { label: '平均释放率', value: rateCount > 0 ? (totalFinalRate / rateCount).toFixed(2) + '%' : '—' },
      { label: '平均回收率', value: recoveryCount > 0 ? (totalRecovery / recoveryCount).toFixed(2) + '%' : '—' }
    ];

    let html = `<div class="page-header">
      <div><div class="page-title">项目总览</div><div class="page-subtitle">盐酸法舒地尔 LLC 缓释制剂</div></div>
      <button class="btn btn-primary" onclick="App.navigate('experiments')">实验记录</button>
    </div>`;

    html += UI.renderStatCards(stats);

    // 最近实验组
    html += '<div class="card"><div class="card-title">实验组一览</div>';
    if (experiments.length === 0) {
      html += UI.renderEmptyState('暂无实验', '创建第一个实验组开始记录释放数据', '创建实验组', "ExperimentCards.showCreateDialog()");
    } else {
      html += UI.renderTable(
        ['名称', '日期', '样品数', '有数据样品'],
        experiments.slice(0, 8).map(exp => {
          const samples = exp.samples || [];
          const withData = samples.filter(s => {
            const saved = ExperimentData.getSavedTableData(exp.id, s.id);
            return (saved && saved.absorbance && saved.absorbance.length > 0) || s.finalRate > 0;
          }).length;
          return { '名称': exp.name, '日期': exp.date || '—', '样品数': samples.length, '有数据样品': withData };
        }),
        { onRowClick: `(i) => App.viewExperimentCards('${experiments[0]?.id}')` }
      );
    }
    html += '</div>';

    container.innerHTML = html;
  }

  // --- 上传分析页 ---
  function renderUploadPage(container) {
    // 获取分析历史（从 experimentData 报告中收集）
    const experiments = ExperimentData.getAllExperiments();
    let allReports = [];
    for (const exp of experiments) {
      for (const s of (exp.samples || [])) {
        const reports = ExperimentData.getReports(exp.id, s.id);
        for (const r of reports) {
          allReports.push({ expName: exp.name, sampleId: s.id, title: r.title, timestamp: r.timestamp });
        }
      }
    }
    allReports.sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));

    let html = `<div class="page-header">
      <div><div class="page-title">上传分析</div><div class="page-subtitle">上传文件解析数据，导入到实验组</div></div>
    </div>

    <!-- 紧凑上传 -->
    <div class="card" style="padding:12px 16px;display:flex;align-items:center;gap:12px">
      <span style="font-size:13px;color:var(--color-text-secondary);white-space:nowrap">上传文件</span>
      <label class="btn btn-primary btn-sm" style="cursor:pointer;white-space:nowrap">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M7 1v10M4 5l3-3 3 3M1 11v1.5c0 .3.2.5.5.5h11a.5.5 0 00.5-.5V11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        选择文件
        <input type="file" id="upload-hidden-input" style="display:none" multiple accept="*" onchange="App.upload.handleFiles(this.files)">
      </label>
      <span style="font-size:11px;color:var(--color-text-tertiary)">支持 xlsx/csv/pdf/docx/pzfx/图片/JSON</span>
    </div>`;

    // 预览区
    html += '<div id="upload-preview" style="margin-top:16px"></div>';

    // 分析历史记录（卡片形式）
    html += `<div class="card" style="margin-top:20px">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>分析历史记录 · ${allReports.length} 条</span>
        ${allReports.length > 0 ? '<button class="btn btn-sm btn-danger" onclick="App.clearAllReports()">全部清除</button>' : ''}
      </div>`;
    if (allReports.length === 0) {
      html += '<p style="color:var(--color-text-tertiary);font-size:13px">暂无分析记录。</p>';
    } else {
      html += '<div class="experiment-cards-grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-top:8px">';
      for (const r of allReports.slice(0, 20)) {
        html += `<div class="experiment-card" style="padding:12px;position:relative">
          <button class="btn btn-sm btn-danger" style="position:absolute;top:8px;right:8px;padding:2px 6px;font-size:10px" onclick="event.stopPropagation();App.deleteReportAtUpload('${r.expName}','${r.sampleId}','${r.timestamp}')">✕</button>
          <div class="experiment-card-title" style="font-size:13px;margin-bottom:4px">${r.sampleId} · ${r.expName}</div>
          <div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:6px">${r.title}</div>
          <span class="tag tag-teal" style="font-size:10px">${new Date(r.timestamp).toLocaleDateString('zh-CN')} ${new Date(r.timestamp).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</span>
        </div>`;
      }
      html += '</div>';
    }
    html += '</div>';

    container.innerHTML = html;
    // 绑定隐藏的 file input
    document.getElementById('upload-hidden-input').addEventListener('change', function() {
      App.upload.handleFiles(this.files);
    });
  }

  // --- 实验记录页（卡片形式） ---
  function renderExperimentsPage(container) {
    const experiments = ExperimentData.getAllExperiments();

    let html = `<div class="page-header">
      <div><div class="page-title">实验记录</div><div class="page-subtitle">${experiments.length} 个实验组</div></div>
      <button class="btn btn-primary" onclick="ExperimentCards.showCreateDialog()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="vertical-align:middle;margin-right:3px"><path d="M7 1v12M1 7h12" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>
        创建实验组
      </button>
    </div>`;

    if (experiments.length === 0) {
      html += UI.renderEmptyState('暂无实验', '点击创建实验组开始记录数据', '创建实验组', "ExperimentCards.showCreateDialog()");
    } else {
      html += '<div class="experiment-cards-grid">';

      for (const exp of experiments) {
        const samples = exp.samples || [];
        const hasData = samples.some(s => s.finalRate > 0 || (s.timePoints && s.timePoints.length > 0));

        // 从 dataOverrides 实时计算释放率（与卡片视图同步）
        const getLiveRate = (sample) => {
          const saved = ExperimentData.getSavedTableData(exp.id, sample.id);
          if (!saved || !saved.absorbance || saved.absorbance.length === 0) return sample.finalRate || 0;
          const concs = saved.absorbance.map(a => 2 * (a - 0.00414128) / 0.0136697);
          const tv = saved.totalVols[0] || 30, sv = saved.sampleVols[0] || 2;
          const cum = [];
          for (let i = 0; i < concs.length; i++) {
            let ss = 0;
            for (let j = 0; j < i; j++) ss += concs[j] * sv;
            cum.push((concs[i] * tv + ss) / 1000);
          }
          const rates = cum.map(c => (c / sample.totalDrug) * 100);
          return rates.length > 0 ? rates[rates.length - 1] : 0;
        };

        html += `
          <div class="experiment-card" onclick="App.viewExperimentCards('${exp.id}')" style="cursor:pointer">
            <div class="experiment-card-header">
              <div class="experiment-card-title">${exp.name}</div>
              <span class="tag ${hasData ? 'tag-success' : 'tag-default'}">${samples.length} 个样品</span>
            </div>
            <div class="experiment-card-body">
              <div class="experiment-card-info">
                <span class="experiment-card-label">日期:</span>
                <span class="experiment-card-value">${exp.date || '—'}</span>
              </div>
              <div style="margin-top:10px;overflow-x:auto">
                <table class="data-table" style="box-shadow:none;font-size:11px;width:100%">
                  <thead><tr>
                    <th style="text-align:center;padding:3px 6px">编号</th>
                    <th style="text-align:center;padding:3px 6px">处方</th>
                    <th style="text-align:center;padding:3px 6px">释放率</th>
                    <th style="text-align:center;padding:3px 6px">残留率</th>
                    <th style="text-align:center;padding:3px 6px">回收率</th>
                  </tr></thead>
                  <tbody>
                    ${samples.map(s => {
                      const liveFinal = getLiveRate(s);
                      const liveTotal = liveFinal + (s.residualRate || 0);
                      return `<tr>
                      <td style="text-align:center;padding:2px 6px;font-weight:500">${s.id}</td>
                      <td style="text-align:center;padding:2px 6px;font-size:10px">${s.formulation||'—'}</td>
                      <td style="text-align:center;padding:2px 6px;color:var(--color-teal)">${liveFinal.toFixed(2)}%</td>
                      <td style="text-align:center;padding:2px 6px;color:var(--color-warning)">${(s.residualRate||0).toFixed(2)}%</td>
                      <td style="text-align:center;padding:2px 6px">${liveTotal.toFixed(2)}%</td>
                    </tr>`;}).join('')}
                  </tbody>
                </table>
              </div>
            </div>
            <div class="experiment-card-actions" onclick="event.stopPropagation()">
              <button class="btn btn-sm btn-primary" onclick="App.viewExperimentCards('${exp.id}')" style="background:var(--color-primary)">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:2px"><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 4.5h11M6 1.5v3M10 1.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                查看详情
              </button>
              <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();App.deleteExperimentGroup('${exp.id}')">删除</button>
            </div>
          </div>
        `;
      }

      html += '</div>';
    }

    container.innerHTML = html;
  }

  // ============================================================
  // 删除实验组
  // ============================================================
  function deleteExperimentGroup(groupId) {
    UI.confirm('确认删除', '此操作将永久删除该实验组及其所有样品和报告，不可恢复。', () => {
      ExperimentData.deleteExperiment(groupId);
      UI.toast('实验组已删除', 'success');
      renderExperimentsPage(document.getElementById('app-content'));
    });
  }

  // ============================================================
  // 上传分析 — Skill 分析与保存到实验
  // ============================================================
  function analyzeWithSkill(fileName) {
    const result = _parsedFiles[fileName];
    if (!result) { UI.toast('文件未找到', 'warning'); return; }

    let sampleData = { timePoints: [], absorbance: [], sampleVols: [], totalVols: [] };
    if (result.sheets) {
      const firstSheet = Object.values(result.sheets)[0];
      if (firstSheet && firstSheet.rows) {
        for (const row of firstSheet.rows) {
          const t = row[0] ? String(row[0]) : '';
          const a = parseFloat(row[1]) || 0;
          if (t) { sampleData.timePoints.push(t); sampleData.absorbance.push(a); }
          sampleData.sampleVols.push(2); sampleData.totalVols.push(30);
        }
      }
    }
    const absVals = sampleData.absorbance;
    let finalRate = 0;
    if (absVals.length > 0) {
      const concs = absVals.map(a => 2 * (a - 0.00414128) / 0.0136697);
      const cum = [];
      for (let i = 0; i < concs.length; i++) {
        let ss = 0;
        for (let j = 0; j < i; j++) ss += concs[j] * 2;
        cum.push((concs[i] * 30 + ss) / 1000);
      }
      finalRate = absVals.length > 0 ? (cum[cum.length-1] / 3.43) * 100 : 0;
    }
    const html = `<div style="background:var(--color-bg-secondary);border-radius:8px;padding:16px;margin-bottom:12px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px"><div><strong>文件:</strong> ${fileName}</div><div><strong>数据行数:</strong> ${absVals.length}</div><div><strong>估计释放率:</strong> ${finalRate.toFixed(2)}%</div></div></div><div style="font-size:13px;color:var(--color-text-secondary)"><p>• 文件包含 ${absVals.length} 数据点，估计释放率 ${finalRate.toFixed(2)}%。</p><p>• 通过「保存到实验」导入后进行完整 Skill 分析。</p></div>`;
    UI.showModal(`Skill 分析 — ${fileName}`, `<div style="max-height:500px;overflow-y:auto">${html}</div>`, `<button class="btn btn-primary btn-sm" onclick="UI.hideModal();App.showSaveToExperiment('${fileName}')">📥 保存到实验</button><button class="btn btn-secondary btn-sm" onclick="UI.hideModal()">关闭</button>`);
  }

  function showSaveToExperiment(fileName) {
    _lastUploadFileName = fileName;
    const experiments = ExperimentData.getAllExperiments();
    const expOptions = experiments.map(e => `<option value="${e.id}">${e.name} (${e.id})</option>`).join('');
    const parsed = _parsedFiles[fileName];
    let sheetPreview = '';
    if (parsed && parsed.sheets) { const f = Object.values(parsed.sheets)[0]; if (f) sheetPreview = ` · ${f.rowCount}行×${f.colCount}列`; }

    // 数据预览表格（带复选框）
    let dataPreview = '';
    if (parsed && parsed.sheets) {
      const firstSheet = Object.values(parsed.sheets)[0];
      if (firstSheet && firstSheet.rows && firstSheet.rows.length > 0) {
        const rows = firstSheet.rows;
        dataPreview = `<div class="form-group">
          <label class="form-label">数据预览（勾选要导入的行）</label>
          <div style="max-height:200px;overflow-y:auto;border:1px solid var(--color-border);border-radius:6px">
            <table class="data-table" style="width:100%;font-size:12px;box-shadow:none;margin:0">
              <thead><tr>
                <th style="width:36px;text-align:center"><input type="checkbox" id="preview-select-all" onchange="App.toggleSelectAllRows(this)" checked></th>
                <th style="padding:4px 8px">时间</th>
                <th style="padding:4px 8px">吸光度</th>
              </tr></thead>
              <tbody>
                ${rows.map((r, i) => {
                  const timeEmpty = !r[0] && r[0] !== 0;
                  const absEmpty = r[1] == null || r[1] === '';
                  return `<tr>
                    <td style="text-align:center"><input type="checkbox" class="preview-row-check" data-row="${i}" checked></td>
                    <td style="padding:4px 8px" class="${timeEmpty ? 'cell-value-empty' : ''}">${timeEmpty ? '(空)' : r[0]}</td>
                    <td style="padding:4px 8px" class="${absEmpty ? 'cell-value-empty' : ''}">${absEmpty ? '(空)' : r[1]}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
      }
    }

    const body = `<div style="display:flex;flex-direction:column;gap:12px">
      <div style="padding:8px 12px;background:var(--color-info-bg);border-radius:8px;font-size:13px">📁 ${fileName}${sheetPreview}</div>
      <div class="form-group"><label class="form-label">目标实验组 *</label>
        <select class="form-select" id="save-exp-select" onchange="App.onSaveExpSelectChange()" style="font-size:13px">
          <option value="">-- 选择实验组 --</option>
          <option value="__new__">+ 新建实验组...</option>
          ${expOptions}
        </select>
      </div>
      <div class="form-group"><label class="form-label">处方名称 *</label>
        <select class="form-select" id="save-form-name" style="font-size:13px">
          <option value="">-- 请先选择实验组 --</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">样品编号 *</label>
        <select class="form-select" id="save-sample-id" onchange="App.onSaveSampleChange()" style="font-size:13px">
          <option value="">-- 请先选择实验组 --</option>
        </select>
      </div>
      <div id="new-sample-wrap" style="display:none" class="form-group">
        <label class="form-label">新样品编号</label>
        <input class="form-input" id="new-sample-id-input" placeholder="如 U1、N1" style="font-size:13px">
      </div>
      ${dataPreview}
    </div>`;
    UI.showModal('保存到实验', body,
      '<button class="btn btn-secondary" onclick="UI.hideModal()">取消</button>' +
      '<button class="btn btn-primary" onclick="App.doSaveToExperiment(\''+fileName+'\')">确认保存</button>');
  }

  function onSaveExpSelectChange() {
    const sel = document.getElementById('save-exp-select');
    if (!sel) return;

    // 新建实验组 → 关闭对话框，打开创建
    if (sel.value === '__new__') {
      const fileName = _lastUploadFileName || '';
      UI.hideModal();
      setTimeout(() => {
        ExperimentCards.showCreateDialog();
        UI.toast('创建实验组后，重新上传文件并选择该组导入', 'info');
      }, 150);
      return;
    }

    const expId = sel.value;
    if (!expId) {
      _resetFormulationAndSample('-- 请先选择实验组 --', '-- 请先选择实验组 --');
      return;
    }

    const exp = ExperimentData.getExperiment(expId);
    if (!exp) return;

    // 填充处方下拉
    const formSelect = document.getElementById('save-form-name');
    if (formSelect) {
      const formulations = exp.formulations || [];
      let opts = '<option value="">-- 选择处方 --</option>';
      for (const f of formulations) {
        opts += `<option value="${f.name}">${f.name}</option>`;
      }
      formSelect.innerHTML = opts;
      formSelect.onchange = function() {
        _onFormulationChange(exp);
      };
    }

    // 样品下拉初始状态
    const sampleSelect = document.getElementById('save-sample-id');
    if (sampleSelect) {
      sampleSelect.innerHTML = '<option value="">-- 请先选择处方 --</option>';
      sampleSelect.onchange = function() {
        _toggleNewSampleInput();
      };
    }

    _toggleNewSampleInput();
  }

  function _onFormulationChange(exp) {
    const formSelect = document.getElementById('save-form-name');
    const sampleSelect = document.getElementById('save-sample-id');
    if (!sampleSelect || !formSelect) return;
    const formName = formSelect.value;
    if (!formName) {
      sampleSelect.innerHTML = '<option value="">-- 请先选择处方 --</option>';
      _toggleNewSampleInput();
      return;
    }
    const matching = (exp.samples || []).filter(s => s.formulation === formName);
    let opts = '<option value="__new__">+ 新建样品...</option>';
    for (const s of matching) {
      opts += `<option value="${s.id}">${s.id}</option>`;
    }
    sampleSelect.innerHTML = opts;
    _toggleNewSampleInput();
  }

  function onSaveSampleChange() {
    _toggleNewSampleInput();
  }

  function _toggleNewSampleInput() {
    const sampleSelect = document.getElementById('save-sample-id');
    const wrap = document.getElementById('new-sample-wrap');
    if (wrap) {
      wrap.style.display = (sampleSelect && sampleSelect.value === '__new__') ? 'block' : 'none';
    }
  }

  function _resetFormulationAndSample(formPlaceholder, samplePlaceholder) {
    const formSelect = document.getElementById('save-form-name');
    const sampleSelect = document.getElementById('save-sample-id');
    if (formSelect) formSelect.innerHTML = `<option value="">${formPlaceholder}</option>`;
    if (sampleSelect) sampleSelect.innerHTML = `<option value="">${samplePlaceholder}</option>`;
    _toggleNewSampleInput();
  }

  function toggleSelectAllRows(checkbox) {
    const checks = document.querySelectorAll('.preview-row-check');
    for (const cb of checks) cb.checked = checkbox.checked;
  }

  function doSaveToExperiment(fileName) {
    // 1. 验证实验组
    const sel = document.getElementById('save-exp-select');
    const expId = sel ? sel.value : '';
    if (!expId) { UI.toast('请选择目标实验组', 'warning'); return; }
    const exp = ExperimentData.getExperiment(expId);
    if (!exp) { UI.toast('实验组未找到', 'warning'); return; }

    // 2. 验证处方
    const formName = (document.getElementById('save-form-name')?.value || '').trim();
    if (!formName) { UI.toast('请选择处方名称', 'warning'); return; }

    // 3. 验证样品编号
    let sampleId = '';
    const sampleSelect = document.getElementById('save-sample-id');
    if (sampleSelect && sampleSelect.value === '__new__') {
      sampleId = (document.getElementById('new-sample-id-input')?.value || '').trim();
      if (!sampleId) { UI.toast('请输入新样品编号', 'warning'); return; }
    } else {
      sampleId = (sampleSelect?.value || '').trim();
    }
    if (!sampleId) { UI.toast('请选择样品编号', 'warning'); return; }

    // 4. 获取选中行
    const parsed = _parsedFiles[fileName];
    if (!parsed) { UI.toast('文件数据丢失', 'warning'); return; }
    let allRows = [];
    if (parsed.sheets) { const f = Object.values(parsed.sheets)[0]; if (f && f.rows) allRows = f.rows; }
    if (allRows.length === 0) { UI.toast('未找到可导入的表格数据', 'warning'); return; }

    const checks = document.querySelectorAll('.preview-row-check');
    let selectedRows = [];
    if (checks.length > 0) {
      for (const cb of checks) {
        if (cb.checked) {
          const idx = parseInt(cb.getAttribute('data-row'));
          if (idx >= 0 && idx < allRows.length) selectedRows.push(allRows[idx]);
        }
      }
    } else {
      selectedRows = allRows;
    }
    if (selectedRows.length === 0) { UI.toast('请勾选至少一行数据', 'warning'); return; }

    // 5. 创建或查找样品
    let existingSample = (exp.samples || []).find(s => s.id === sampleId);
    if (!existingSample) {
      const formObj = (exp.formulations || []).find(f => f.name === formName);
      const ns = {
        id: sampleId,
        experimentId: expId,
        formulation: formName,
        formulationComponents: formObj ? (formObj.components || {}) : {},
        formulationTotal: formObj ? (formObj.total || 0) : 0,
        totalDrug: exp.drugAmount || 3.43,
        group: exp.name,
        timePoints: [], absorbance: [], sampleVols: [], totalVols: [],
        concentration: [], cumulativeRelease: [], releaseRate: [],
        finalRate: 0, residualAbs: 0, residualAmount: 0, residualRate: 0, totalRecovery: 0
      };
      exp.samples.push(ns);
    }

    // 6. 构建表数据（保留空值标记，供红框提示）
    const tableRows = selectedRows.map(r => {
      const hasTime = r[0] != null && String(r[0]).trim() !== '';
      const hasAbs = r[1] != null && String(r[1]).trim() !== '';
      return {
        time: hasTime ? String(r[0]) : '',
        absorbance: hasAbs ? (parseFloat(r[1]) || 0) : null,
        sampleVol: 2,
        totalVol: 30
      };
    });

    ExperimentData.saveTableData(expId, sampleId, tableRows);
    ExperimentData._saveToStorage();

    UI.hideModal();
    UI.toast(`已导入 ${selectedRows.length} 行 →「${exp.name}·${sampleId}」`, 'success');
    viewExperimentCards(expId);
  }

  // ============================================================
  // 历史记录管理
  // ============================================================
  function clearAllReports() {
    UI.confirm('确认清除', '删除所有分析历史记录？此操作不可恢复。', () => {
      const experiments = ExperimentData.getAllExperiments();
      for (const exp of experiments) {
        for (const s of (exp.samples || [])) {
          const reports = ExperimentData.getReports(exp.id, s.id);
          for (let i = reports.length - 1; i >= 0; i--) {
            ExperimentData.deleteReport(exp.id, s.id, i);
          }
        }
      }
      UI.toast('所有历史记录已清除', 'success');
      // 重新渲染上传页面
      const container = document.getElementById('app-content');
      if (container) renderUploadPage(container);
    });
  }

  function deleteReportAtUpload(expName, sampleId, timestamp) {
    const experiments = ExperimentData.getAllExperiments();
    for (const exp of experiments) {
      if (exp.name !== expName) continue;
      const reports = ExperimentData.getReports(exp.id, sampleId);
      const idx = reports.findIndex(r => r.timestamp === timestamp);
      if (idx >= 0) {
        ExperimentData.deleteReport(exp.id, sampleId, idx);
        UI.toast('报告已删除', 'success');
        const container = document.getElementById('app-content');
        if (container) renderUploadPage(container);
        return;
      }
    }
  }

  // --- 计算表页 ---
  function renderCalculationsPage(container) {
    const calculators = [
      { id: 'ee', name: '包封率 EE%', icon: '◆' },
      { id: 'dl', name: '载药量 DL%', icon: '●' },
      { id: 'cumulative', name: '累积释放校正', icon: '▲' },
      { id: 'models', name: '释放动力学拟合', icon: '☆' },
      { id: 'f2', name: 'f2 相似因子', icon: '■' },
      { id: 'residual', name: '释放残留率', icon: '▼' }
    ];

    let html = `<div class="page-header">
      <div><div class="page-title">计算表</div><div class="page-subtitle">选择计算类型，输入数据，查看结果</div></div>
    </div>`;

    html += '<div class="card"><div class="card-title">选择计算器</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px">';
    for (const calc of calculators) {
      html += `<button class="btn btn-secondary" style="padding:16px;text-align:center" onclick="App.showCalculator('${calc.id}')">
        <div style="font-size:20px;margin-bottom:4px">${calc.icon}</div>
        <div>${calc.name}</div>
      </button>`;
    }
    html += '</div></div>';

    html += '<div id="calc-workspace" style="margin-top:24px"></div>';

    container.innerHTML = html;
  }

  // --- 知识库页 ---
  async function renderKnowledgePage(container) {
    let literature = [];
    try {
      literature = await FSManager.listLiterature();
    } catch (e) {
      debugLog('加载文献失败: ' + e.message);
    }

    let html = `<div class="page-header">
      <div><div class="page-title">知识库</div><div class="page-subtitle">文献管理、经验积累、对比分析</div></div>
      <button class="btn btn-primary" onclick="App.showCreateLiteratureDialog()">添加文献</button>
    </div>`;

    html += UI.renderTabs([
      { label: '文献', content: `<div class="card">
        ${literature.length === 0 ?
          UI.renderEmptyState('暂无文献', '添加相关论文的关键数据与方法', '添加文献', "App.showCreateLiteratureDialog()") :
          UI.renderTable(['ID', '标题', '作者', '年份', '标签'], literature.map(lit => ({
            ID: lit.id, 标题: lit.title || '—', 作者: lit.authors || '—', 年份: lit.year || '—', 标签: lit.tags || '—'
          })))
        }
      </div>` },
      { label: '经验', content: '<div class="card"><div class="card-title">经验条目</div><p style="color:var(--color-text-tertiary)">记录条件→操作→结果→结论，可提炼为自学习规则</p></div>' },
      { label: '对比分析', content: '<div class="card"><div class="card-title">实验 vs 文献</div><p style="color:var(--color-text-tertiary)">选择实验和文献数据，同图对比释放曲线，计算 f2</p></div>' }
    ], 0);

    container.innerHTML = html;
  }

  // --- 处方管理页 ---
  function renderPrescriptionPage(container) {
    const experiments = ExperimentData.getAllExperiments();
    let allFormulations = [];
    for (const exp of experiments) {
      for (const f of (exp.formulations || [])) {
        allFormulations.push({ name: f.name, components: f.components || {}, total: f.total || 0, source: exp.name, expId: exp.id, samples: f.samples || [] });
      }
    }

    let html = `<div class="page-header">
      <div><div class="page-title">处方管理</div><div class="page-subtitle">${allFormulations.length} 个处方</div></div>
      <button class="btn btn-primary" onclick="ExperimentCards.showCreateDialog()">创建实验组</button>
    </div>`;

    if (allFormulations.length === 0) {
      html += UI.renderEmptyState('暂无处方', '创建实验组即可生成处方', '创建实验组', "ExperimentCards.showCreateDialog()");
    } else {
      html += '<div class="card" style="overflow-x:auto"><table class="data-table"><thead><tr>';
      html += '<th>处方名称</th><th>SPC</th><th>GMO</th><th>NMP</th><th>水</th><th>EtOH</th><th>DOPG-Na</th><th>总重 (g)</th><th>对应样品</th><th>来源</th></tr></thead><tbody>';
      for (const f of allFormulations) {
        const c = f.components || {};
        html += `<tr>
          <td><strong>${f.name}</strong></td>
          <td>${(c.SPC||0).toFixed(2)}</td><td>${(c.GMO||0).toFixed(2)}</td><td>${(c.NMP||0).toFixed(2)}</td>
          <td>${(c.水||0).toFixed(2)}</td><td>${(c.EtOH||0).toFixed(2)}</td><td>${(c['DOPG-Na']||0).toFixed(2)}</td>
          <td><strong>${(f.total||0).toFixed(2)}</strong></td>
          <td>${f.samples.join(', ')}</td>
          <td><span class="tag tag-default">${f.source}</span></td>
        </tr>`;
      }
      html += '</tbody></table></div>';
    }
    container.innerHTML = html;
  }

  function renderSamplePage(container) {
    const experiments = ExperimentData.getAllExperiments();
    let allSamples = [];
    for (const exp of experiments) {
      for (const s of (exp.samples || [])) {
        allSamples.push({ ...s, expName: exp.name, expId: exp.id });
      }
    }

    let html = `<div class="page-header">
      <div><div class="page-title">样本管理</div><div class="page-subtitle">${allSamples.length} 个样本</div></div>
      <button class="btn btn-primary" onclick="ExperimentCards.showCreateDialog()">创建实验组</button>
    </div>`;

    if (allSamples.length === 0) {
      html += UI.renderEmptyState('暂无样本', '创建实验组即可生成样本', '创建实验组', "ExperimentCards.showCreateDialog()");
    } else {
      html += '<div class="card" style="overflow-x:auto"><table class="data-table"><thead><tr>';
      html += '<th>编号</th><th>所属处方</th><th>总药量 (mg)</th><th>所属实验组</th><th>释放率</th><th>残留率</th><th>回收率</th><th>操作</th></tr></thead><tbody>';
      for (const s of allSamples) {
        html += `<tr>
          <td><strong>${s.id}</strong></td><td>${s.formulation||'—'}</td><td>${(s.totalDrug||0).toFixed(2)}</td><td>${s.expName||'—'}</td>
          <td>${(s.finalRate||0).toFixed(2)}%</td><td>${(s.residualRate||0).toFixed(2)}%</td><td>${(s.totalRecovery||0).toFixed(2)}%</td>
          <td><button class="btn btn-sm btn-primary" onclick="App.viewExperimentCards('${s.expId}')">查看</button></td>
        </tr>`;
      }
      html += '</tbody></table></div>';
    }
    container.innerHTML = html;
  }

  // --- 创建实验对话框 ---
  function showCreateExperimentDialog() {
    const body = `
      <div class="form-group">
        <label class="form-label">实验名称</label>
        <input type="text" id="new-exp-name" class="form-input" placeholder="例如: 植烷三醇/油酸/水 体系 第1批">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">实验日期</label>
          <input type="date" id="new-exp-date" class="form-input" value="${new Date().toISOString().split('T')[0]}">
        </div>
        <div class="form-group">
          <label class="form-label">标签（逗号分隔）</label>
          <input type="text" id="new-exp-tags" class="form-input" placeholder="例如: LLC,缓释,植烷三醇">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">备注</label>
        <textarea id="new-exp-notes" class="form-textarea" rows="3" placeholder="实验方案描述"></textarea>
      </div>
    `;
    const footer = `
      <button class="btn btn-secondary" onclick="UI.hideModal()">取消</button>
      <button class="btn btn-primary" onclick="App.createExperiment()">创建</button>
    `;
    UI.showModal('创建实验批次', body, footer);
  }

  async function createExperiment() {
    const name = document.getElementById('new-exp-name').value.trim();
    const date = document.getElementById('new-exp-date').value;
    const tags = document.getElementById('new-exp-tags').value.split(',').map(t => t.trim()).filter(t => t);
    const notes = document.getElementById('new-exp-notes').value;

    if (!name) { UI.toast('请输入实验名称', 'warning'); return; }

    const expId = FSManager.generateExpId();
    try {
      await FSManager.createExperiment(expId, { name, date, tags, notes });
      UI.hideModal();
      UI.toast(`实验 ${name} 已创建`, 'success');
      await navigate('experiments');
    } catch (err) {
      UI.toast('创建失败: ' + err.message, 'danger');
    }
  }

  // --- 查看实验详情 ---
  async function viewExperiment(expId) {
    try {
      const meta = await FSManager.readJSON(`experiments/${expId}/meta.json`);
      const data = meta.data;
      let formulation, release, releaseFit, residual, llc, calculations, imagesMeta;

      try { formulation = await FSManager.readJSON(`experiments/${expId}/formulation.json`); } catch(e) { formulation = { data: { components: [] } }; }
      try { release = await FSManager.readJSON(`experiments/${expId}/release.json`); } catch(e) { release = { data: { timePoints: [], cumulativeRelease: [] } }; }
      try { releaseFit = await FSManager.readJSON(`experiments/${expId}/release-fit.json`); } catch(e) { releaseFit = { data: { models: [], bestModel: null } }; }
      try { residual = await FSManager.readJSON(`experiments/${expId}/residual.json`); } catch(e) { residual = { data: {} }; }
      try { llc = await FSManager.readJSON(`experiments/${expId}/llc.json`); } catch(e) { llc = { data: {} }; }
      try { calculations = await FSManager.readJSON(`experiments/${expId}/calculations.json`); } catch(e) { calculations = { data: { items: [] } }; }
      try { imagesMeta = await FSManager.readJSON(`experiments/${expId}/images/images-meta.json`); } catch(e) { imagesMeta = { data: { images: [] } }; }

      const content = document.getElementById('app-content');

      let html = `<div class="page-header">
        <div><div class="page-title">${data.name}</div>
        <div class="page-subtitle">${data.id} · ${data.date} · ${(data.tags || []).map(t => `<span class="tag tag-teal">${t}</span>`).join(' ')}</div></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" onclick="App.navigate('experiments')">返回列表</button>
          <button class="btn btn-primary" onclick="App.exportReport('${expId}', 'word')">导出 Word</button>
          <button class="btn btn-secondary" onclick="App.exportReport('${expId}', 'pdf')">导出 PDF</button>
        </div>
      </div>`;

      const overviewContent = `<div class="card">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><div class="form-label">ID</div><p>${data.id}</p></div>
          <div><div class="form-label">名称</div><p>${data.name}</p></div>
          <div><div class="form-label">日期</div><p>${data.date}</p></div>
          <div><div class="form-label">状态</div><p><span class="tag tag-${data.status === 'active' ? 'success' : 'danger'}">${data.status}</span></p></div>
          <div><div class="form-label">标签</div><p>${(data.tags || []).join(', ') || '无'}</p></div>
          <div><div class="form-label">备注</div><p>${data.notes || '无'}</p></div>
        </div>
      </div>`;

      const formulationContent = `<div class="card"><div class="card-title">处方组成</div>
        ${formulation.data.components.length > 0 ?
          `<div style="display:flex;gap:24px">
            <div style="flex:1"><canvas id="formulation-pie" height="200"></canvas></div>
            <div style="flex:1">${UI.renderTable(['组分', '用量', '单位'], formulation.data.components.map(c => ({ '组分': c.name, '用量': c.amount, '单位': c.unit })))}</div>
          </div>` :
          '<p style="color:var(--color-text-tertiary)">暂无处方数据，可通过上传 xlsx 文件导入</p>'
        }
      </div>`;

      const releaseContent = `<div class="card"><div class="card-title">释放曲线</div>
        ${release.data.timePoints.length > 0 ?
          `<div style="height:300px"><canvas id="release-chart" height="300"></canvas></div>
          <div style="margin-top:16px">${UI.renderTable(['时间(h)', '累积释放(%)'], release.data.timePoints.map((t, i) => ({ '时间(h)': t, '累积释放(%)': release.data.cumulativeRelease[i] })))}</div>` :
          '<p style="color:var(--color-text-tertiary)">暂无释放数据，可通过上传 xlsx/PDF 文件导入</p>'
        }
      </div>`;

      const llcContent = `<div class="card"><div class="card-title">LLC 表征</div>
        ${UI.renderImageGallery(imagesMeta.data.images || [], expId)}
        <div style="margin-top:16px">
          <button class="btn btn-secondary" onclick="App.showUploadImageDialog('${expId}')">添加图片</button>
        </div>
      </div>`;

      const residualContent = `<div class="card"><div class="card-title">残留率数据</div>
        ${residual.data.initialAmount ?
          `<p>初始药量: ${residual.data.initialAmount} mg<br>残余药量: ${residual.data.remainingAmount} mg<br>残留率: ${residual.data.residualRate}%</p>` :
          '<p style="color:var(--color-text-tertiary)">暂无残留率数据</p>'
        }
      </div>`;

      const calcContent = `<div class="card"><div class="card-title">计算结果</div>
        ${(calculations.data.items || []).length > 0 ?
          UI.renderTable(['类型', '时间', '结果'], calculations.data.items.map(item => ({
            '类型': item.type,
            '时间': item.timestamp?.split('T')[0] || '—',
            '结果': Object.entries(item.results).map(([k, v]) => `${k}=${v}`).join(', ')
          }))) :
          '<p style="color:var(--color-text-tertiary)">暂无计算结果，可在计算表中运行计算</p>'
        }
      </div>`;

      html += UI.renderTabs([
        { label: '总览', content: overviewContent },
        { label: '处方', content: formulationContent },
        { label: '释放曲线', content: releaseContent },
        { label: 'LLC表征', content: llcContent },
        { label: '残留率', content: residualContent },
        { label: '计算结果', content: calcContent }
      ], 0);

      content.innerHTML = html;

      // 渲染图表
      setTimeout(() => {
        try {
          if (release.data.timePoints.length > 0) {
            Charts.renderReleaseCurve('release-chart', [{
              label: data.name,
              timePoints: release.data.timePoints,
              cumulativeRelease: release.data.cumulativeRelease
            }]);
          }
          if (formulation.data.components.length > 0) {
            Charts.renderFormulationPie('formulation-pie', formulation.data.components);
          }
          loadGalleryThumbnails(expId, imagesMeta.data.images || []);
        } catch (e) {
          debugLog('渲染图表失败: ' + e.message);
        }
      }, 100);

    } catch (err) {
      UI.toast('加载实验数据失败: ' + err.message, 'danger');
    }
  }

  // --- 加载图片缩略图 ---
  async function loadGalleryThumbnails(expId, images) {
    for (const img of images) {
      try {
        const thumbBlob = await FSManager.getThumbnailBlob(expId, `${img.filename}_thumb.jpg`);
        if (thumbBlob) {
          const url = URL.createObjectURL(thumbBlob);
          const imgEl = document.querySelector(`img[data-thumb="${img.filename}_thumb.jpg"]`);
          if (imgEl) imgEl.src = url;
        } else {
          const origBlob = await FSManager.getImageBlob(expId, img.filename);
          const url = URL.createObjectURL(origBlob);
          const imgEl = document.querySelector(`img[data-original="${img.filename}"]`);
          if (imgEl) imgEl.src = url;
        }
      } catch (e) {
        console.warn(`加载图片失败: ${img.filename}`, e);
      }
    }
  }

  // --- 查看图片大图 ---
  async function viewImage(expId, filename) {
    try {
      const blob = await FSManager.getImageBlob(expId, filename);
      const url = URL.createObjectURL(blob);

      const body = `<div style="text-align:center">
        <img src="${url}" style="max-width:100%;max-height:60vh;border-radius:8px" alt="${filename}">
        <p style="margin-top:12px;color:var(--color-text-secondary)">${filename}</p>
      </div>`;

      UI.showModal('图片查看', body);
    } catch (err) {
      UI.toast('加载图片失败', 'danger');
    }
  }

  // --- 删除实验 ---
  function deleteExperiment(expId) {
    UI.confirm('删除实验', `确定要删除实验 ${expId} 吗？删除后可在目录中恢复。`, async () => {
      try {
        await FSManager.softDeleteExperiment(expId);
        UI.toast('实验已删除', 'success');
        await navigate('experiments');
      } catch (err) {
        UI.toast('删除失败: ' + err.message, 'danger');
      }
    });
  }

  // --- 上传图片对话框 ---
  function showUploadImageDialog(expId) {
    const body = `
      <div class="form-group">
        <label class="form-label">图片分类</label>
        <select id="img-category" class="form-select">
          <option value="POL">偏光显微镜</option>
          <option value="SAXS">SAXS图谱</option>
          <option value="SEM">SEM</option>
          <option value="外观">制剂外观</option>
          <option value="其他">其他</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">图片描述</label>
        <input type="text" id="img-description" class="form-input" placeholder="例如: 37°C 偏光显微镜观察">
      </div>
      <div class="form-group">
        <label class="form-label">选择图片文件</label>
        <input type="file" id="img-file-input" accept="image/*" class="form-input">
      </div>
    `;
    const footer = `
      <button class="btn btn-secondary" onclick="UI.hideModal()">取消</button>
      <button class="btn btn-primary" onclick="App.uploadImage('${expId}')">上传</button>
    `;
    UI.showModal('添加实验图片', body, footer);
  }

  async function uploadImage(expId) {
    const category = document.getElementById('img-category').value;
    const description = document.getElementById('img-description').value;
    const fileInput = document.getElementById('img-file-input');

    if (!fileInput.files[0]) { UI.toast('请选择图片文件', 'warning'); return; }

    try {
      await FSManager.saveImageFile(expId, fileInput.files[0], category, description);
      UI.hideModal();
      UI.toast('图片已保存', 'success');
      await viewExperiment(expId);
    } catch (err) {
      UI.toast('上传失败: ' + err.message, 'danger');
    }
  }

  // --- 卡片视图（基于 Excel 数据的实验记录卡片） ---
  function viewExperimentCards(experimentId) {
    const content = document.getElementById('app-content');
    if (!content) return;
    content.innerHTML = '';
    const exp = experimentId ? ExperimentData.getExperiment(experimentId) : null;
    const meta = exp ? { name: exp.name, date: exp.date } : { name: '实验详情', date: '' };
    ExperimentCards.render(content, meta, experimentId);
  }
  async function uploadToExperiment(expId) {
    const body = `
      <div class="form-group">
        <label class="form-label">选择文件（支持多文件）</label>
        <input type="file" id="exp-file-input" class="form-input" multiple accept=".xlsx,.xls,.csv,.pdf,.docx,.png,.jpg,.jpeg,.gif,.bmp">
        <p style="font-size:12px;color:var(--color-text-tertiary);margin-top:8px">
          支持格式: xlsx/csv (数据), pdf (文本提取), docx (文献), png/jpg (图片)
        </p>
      </div>
      <div id="exp-upload-preview" style="margin-top:16px"></div>
    `;
    const footer = `
      <button class="btn btn-secondary" onclick="UI.hideModal()">取消</button>
      <button class="btn btn-primary" onclick="App.processExperimentUpload('${expId}')">上传并分析</button>
    `;
    UI.showModal('上传文件到实验', body, footer);

    // 绑定文件选择事件
    const fileInput = document.getElementById('exp-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const previewDiv = document.getElementById('exp-upload-preview');
        if (!previewDiv) return;

        previewDiv.innerHTML = '<div class="card"><div class="card-title">文件预览</div>';

        for (const file of e.target.files) {
          try {
            await FSManager.saveUploadedFile(file);
            const result = await Parser.parseFile(file);
            previewDiv.innerHTML += renderParsedPreview(file.name, result);
          } catch (err) {
            previewDiv.innerHTML += `<div class="alert-card alert-danger">${file.name}: 解析失败 — ${err.message}</div>`;
          }
        }

        previewDiv.innerHTML += '</div>';
      });
    }
  }

  async function processExperimentUpload(expId) {
    const fileInput = document.getElementById('exp-file-input');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      UI.toast('请选择文件', 'warning');
      return;
    }

    try {
      // 保存文件到实验目录
      for (const file of fileInput.files) {
        await FSManager.saveExperimentFile(expId, file);
      }

      UI.hideModal();
      UI.toast(`已上传 ${fileInput.files.length} 个文件到实验 ${expId}`, 'success');

      // 刷新实验看板
      await viewExperiment(expId);
    } catch (err) {
      UI.toast('上传失败: ' + err.message, 'danger');
    }
  }

  // --- 上传处理 ---
  const upload = {
    async handleDrop(event) {
      const files = event.dataTransfer.files;
      await this.handleFiles(files);
    },

    async handleFiles(files) {
      if (!files || files.length === 0) return;
      if (files.length > 0) _lastUploadFileName = files[0].name;

      const previewDiv = document.getElementById('upload-preview');
      if (!previewDiv) return;

      previewDiv.innerHTML = '<div class="card"><div class="card-title">文件解析预览</div>';

      for (const file of files) {
        try {
          await FSManager.saveUploadedFile(file);
          const result = await Parser.parseFile(file);
          previewDiv.innerHTML += renderParsedPreview(file.name, result);
        } catch (err) {
          previewDiv.innerHTML += `<div class="alert-card alert-danger">${file.name}: 解析失败 — ${err.message}</div>`;
        }
      }

      previewDiv.innerHTML += '</div>';
    }
  };

  function renderParsedPreview(fileName, result) {
    _parsedFiles[fileName] = result;
    let html = `<div style="margin-bottom:16px;padding:12px;border:1px solid var(--color-border-light);border-radius:8px">`;
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span class="tag tag-teal">${result.format}</span>
      <strong>${fileName}</strong>
      <span class="tag tag-${result.detection?.confidence > 20 ? 'success' : 'default'}">${result.detection?.description || '未知类型'}</span>
    </div>`;

    if (result.sheets) {
      for (const [sheetName, sheetData] of Object.entries(result.sheets)) {
        html += `<div style="margin-bottom:8px">
          <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Sheet: ${sheetName} (${sheetData.rowCount} 行 × ${sheetData.colCount} 列)</div>`;
        if (sheetData.rows.length > 0) {
          html += UI.renderTable(
            sheetData.columns,
            sheetData.rows.slice(0, 5).map(row => {
              const obj = {};
              sheetData.columns.forEach((col, i) => obj[col] = row[i]);
              return obj;
            })
          );
        }
        html += '</div>';
      }
    } else if (result.plainText) {
      html += `<div style="font-size:13px;color:var(--color-text-secondary);max-height:200px;overflow-y:auto;padding:8px;background:var(--color-bg-secondary);border-radius:4px">${result.plainText.substring(0, 1000)}${result.plainText.length > 1000 ? '...' : ''}</div>`;
    } else if (result.fullText) {
      html += `<div style="font-size:13px;color:var(--color-text-secondary);max-height:200px;overflow-y:auto;padding:8px;background:var(--color-bg-secondary);border-radius:4px">${result.fullText.substring(0, 1000)}${result.fullText.length > 1000 ? '...' : ''}</div>`;
    } else if (result.format === 'image') {
      html += `<img src="${result.dataUrl}" style="max-width:200px;border-radius:4px" alt="${fileName}">`;
      html += `<p style="font-size:12px;color:var(--color-text-tertiary)">${result.width}×${result.height}, ${(result.size / 1024).toFixed(1)} KB</p>`;
    }

    if (result.note) {
      html += `<div class="alert-card alert-info" style="margin-top:8px">${result.note}</div>`;
    }

    // 按钮行：保存到实验 + 模型分析
    html += `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="App.showSaveToExperiment('${fileName}')">📥 保存到实验</button>
      <button class="btn btn-secondary btn-sm" onclick="App.analyzeWithSkill('${fileName}')">📊 Skill 分析</button>
    </div>`;

    html += '</div>';
    return html;
  }

  // --- 导入解析数据到实验 ---
  async function importParsedData(fileName) {
    // 让用户选择要导入到哪个实验
    const experiments = await FSManager.listExperiments();
    if (experiments.length === 0) {
      UI.toast('请先创建实验批次', 'warning');
      return;
    }

    let optionsHtml = experiments.map(exp =>
      `<option value="${exp.id}">${exp.name} (${exp.id})</option>`
    ).join('');

    const body = `
      <div class="form-group">
        <label class="form-label">选择目标实验</label>
        <select id="import-exp-select" class="form-input">
          ${optionsHtml}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">数据类型</label>
        <select id="import-data-type" class="form-input">
          <option value="release">释放度数据</option>
          <option value="formulation">处方组成</option>
          <option value="residual">残留率数据</option>
          <option value="llc">LLC表征</option>
        </select>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary" onclick="UI.hideModal()">取消</button>
      <button class="btn btn-primary" onclick="App.confirmImport('${fileName}')">导入</button>
    `;

    UI.showModal('导入数据到实验', body, footer);
  }

  async function confirmImport(fileName) {
    const expId = document.getElementById('import-exp-select').value;
    const dataType = document.getElementById('import-data-type').value;

    try {
      // 读取上传的文件
      const uploadDir = await FSManager.getDirHandle('uploads');
      const fileHandle = await uploadDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();

      // 解析文件
      const result = await Parser.parseFile(file);

      // 根据数据类型，将数据写入实验的对应 JSON 文件
      await importDataToExperiment(expId, dataType, result);

      UI.hideModal();
      UI.toast(`已导入 ${fileName} 到实验 ${expId} (${dataType})`, 'success');

      // 刷新实验看板
      await viewExperiment(expId);
    } catch (err) {
      UI.toast('导入失败: ' + err.message, 'danger');
    }
  }

  // --- 将数据导入到实验的对应类型下 ---
  async function importDataToExperiment(expId, dataType, parsedResult) {
    const expDir = await FSManager.getExperimentDir(expId);

    switch (dataType) {
      case 'release':
        // 导入释放度数据
        const releaseData = extractReleaseData(parsedResult);
        await FSManager.writeJSON(`experiments/${expId}/release.json`, releaseData);
        break;

      case 'formulation':
        // 导入处方组成
        const formulationData = extractFormulationData(parsedResult);
        await FSManager.writeJSON(`experiments/${expId}/formulation.json`, formulationData);
        break;

      case 'residual':
        // 导入残留率数据
        const residualData = extractResidualData(parsedResult);
        await FSManager.writeJSON(`experiments/${expId}/residual.json`, residualData);
        break;

      case 'llc':
        // 导入 LLC 表征图片
        // 将图片文件复制到实验目录
        const uploadDir = await FSManager.getDirHandle('uploads');
        const fileHandle = await uploadDir.getFileHandle(parsedResult.fileName || 'unknown');
        const destHandle = await expDir.getFileHandle(parsedResult.fileName || 'unknown', { create: true });
        const writable = await destHandle.createWritable();
        await writable.write(await fileHandle.getFile());
        await writable.close();
        break;
    }
  }

  // --- 从解析结果中提取释放度数据 ---
  function extractReleaseData(parsedResult) {
    // 这里需要根据实际的解析结果格式来提取数据
    // 暂时返回一个示例结构
    const releaseData = {
      timePoints: [],
      releaseRates: [],
      unit: 'h',
      note: '从上传文件导入'
    };

    if (parsedResult.sheets) {
      for (const [sheetName, sheetData] of Object.entries(parsedResult.sheets)) {
        // 假设第一列是时间点，第二列是释放率
        for (const row of sheetData.rows) {
          if (row.length >= 2) {
            const time = parseFloat(row[0]);
            const rate = parseFloat(row[1]);
            if (!isNaN(time) && !isNaN(rate)) {
              releaseData.timePoints.push(time);
              releaseData.releaseRates.push(rate);
            }
          }
        }
      }
    }

    return releaseData;
  }

  // --- 从解析结果中提取处方组成数据 ---
  function extractFormulationData(parsedResult) {
    const formulationData = {
      components: [],
      note: '从上传文件导入'
    };

    if (parsedResult.sheets) {
      for (const [sheetName, sheetData] of Object.entries(parsedResult.sheets)) {
        // 假设第一列是组分名称，第二列是含量
        for (const row of sheetData.rows) {
          if (row.length >= 2) {
            formulationData.components.push({
              name: String(row[0]),
              amount: parseFloat(row[1]) || 0,
              unit: 'mg'
            });
          }
        }
      }
    }

    return formulationData;
  }

  // --- 从解析结果中提取残留率数据 ---
  function extractResidualData(parsedResult) {
    const residualData = {
      timePoints: [],
      residualRates: [],
      unit: 'h',
      note: '从上传文件导入'
    };

    if (parsedResult.sheets) {
      for (const [sheetName, sheetData] of Object.entries(parsedResult.sheets)) {
        // 假设第一列是时间点，第二列是残留率
        for (const row of sheetData.rows) {
          if (row.length >= 2) {
            const time = parseFloat(row[0]);
            const rate = parseFloat(row[1]);
            if (!isNaN(time) && !isNaN(rate)) {
              residualData.timePoints.push(time);
              residualData.residualRates.push(rate);
            }
          }
        }
      }
    }

    return residualData;
  }

  // --- 计算器 ---
  function showCalculator(calcType) {
    const workspace = document.getElementById('calc-workspace');
    if (!workspace) return;

    switch (calcType) {
      case 'ee': showEECalculator(workspace); break;
      case 'dl': showDLCalculator(workspace); break;
      case 'cumulative': showCumulativeCalculator(workspace); break;
      case 'models': showModelsCalculator(workspace); break;
      case 'f2': showF2Calculator(workspace); break;
      case 'residual': showResidualCalculator(workspace); break;
    }
  }

  function showEECalculator(workspace) {
    workspace.innerHTML = `<div class="card">
      <div class="card-title">包封率 EE% 计算</div>
      <p style="color:var(--color-text-secondary);margin-bottom:12px">EE% = (W_total - W_free) / W_total × 100</p>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">总药量 W_total (mg)</label>
          <input type="number" id="ee-total" class="form-input" placeholder="例如: 100">
        </div>
        <div class="form-group">
          <label class="form-label">游离药量 W_free (mg)</label>
          <input type="number" id="ee-free" class="form-input" placeholder="例如: 20">
        </div>
      </div>
      <button class="btn btn-primary" onclick="App.runEE()">计算</button>
      <div id="ee-result" style="margin-top:16px"></div>
    </div>`;
  }

  async function runEE() {
    const total = parseFloat(document.getElementById('ee-total').value);
    const free = parseFloat(document.getElementById('ee-free').value);

    if (isNaN(total) || isNaN(free)) { UI.toast('请输入有效数值', 'warning'); return; }

    const result = Calc.calcEE(total, free);
    document.getElementById('ee-result').innerHTML = `
      <div style="padding:16px;background:var(--color-success-bg);border-radius:8px;border:1px solid var(--color-success)">
        <p style="font-size:16px;font-weight:500;color:var(--color-success)">包封率 EE% = ${result.EE}%</p>
        <p style="color:var(--color-text-secondary)">包封药量 = ${result.encapsulated.toFixed(2)} mg</p>
      </div>
    `;
    UI.toast(`EE% = ${result.EE}%`, 'success');
  }

  function showDLCalculator(workspace) {
    workspace.innerHTML = `<div class="card">
      <div class="card-title">载药量 DL% 计算</div>
      <p style="color:var(--color-text-secondary);margin-bottom:12px">DL% = W_encapsulated / W_total_carrier × 100</p>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">包封药量 (mg)</label>
          <input type="number" id="dl-encap" class="form-input" placeholder="例如: 80">
        </div>
        <div class="form-group">
          <label class="form-label">制剂总重 (mg)</label>
          <input type="number" id="dl-total" class="form-input" placeholder="例如: 500">
        </div>
      </div>
      <button class="btn btn-primary" onclick="App.runDL()">计算</button>
      <div id="dl-result" style="margin-top:16px"></div>
    </div>`;
  }

  async function runDL() {
    const encap = parseFloat(document.getElementById('dl-encap').value);
    const total = parseFloat(document.getElementById('dl-total').value);

    if (isNaN(encap) || isNaN(total)) { UI.toast('请输入有效数值', 'warning'); return; }

    const result = Calc.calcDL(encap, total);
    document.getElementById('dl-result').innerHTML = `
      <div style="padding:16px;background:var(--color-success-bg);border-radius:8px;border:1px solid var(--color-success)">
        <p style="font-size:16px;font-weight:500;color:var(--color-success)">载药量 DL% = ${result.DL}%</p>
      </div>
    `;
    UI.toast(`DL% = ${result.DL}%`, 'success');
  }

  function showCumulativeCalculator(workspace) {
    workspace.innerHTML = `<div class="card">
      <div class="card-title">累积释放校正计算</div>
      <p style="color:var(--color-text-secondary);margin-bottom:12px">考虑取样补液的体积校正: Qn = [Cn·V + ΣCi·Vs] / W₀ × 100</p>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">溶出介质体积 V (mL)</label>
          <input type="number" id="cum-v" class="form-input" value="900" placeholder="例如: 900">
        </div>
        <div class="form-group">
          <label class="form-label">取样体积 Vs (mL)</label>
          <input type="number" id="cum-vs" class="form-input" value="5" placeholder="例如: 5">
        </div>
        <div class="form-group">
          <label class="form-label">初始药量 W₀ (mg)</label>
          <input type="number" id="cum-w0" class="form-input" placeholder="例如: 10">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">各时间点浓度 (μg/mL 或 mg/L，逗号分隔)</label>
        <input type="text" id="cum-conc" class="form-input" placeholder="例如: 0.5, 1.2, 2.1, 3.0, 4.5">
      </div>
      <button class="btn btn-primary" onclick="App.runCumulative()">计算</button>
      <div id="cum-result" style="margin-top:16px"></div>
    </div>`;
  }

  async function runCumulative() {
    const V = parseFloat(document.getElementById('cum-v').value);
    const Vs = parseFloat(document.getElementById('cum-vs').value);
    const W0 = parseFloat(document.getElementById('cum-w0').value);
    const concStr = document.getElementById('cum-conc').value;
    const concentrations = concStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));

    if (isNaN(V) || isNaN(Vs) || isNaN(W0) || concentrations.length === 0) {
      UI.toast('请输入有效数值', 'warning'); return;
    }

    const result = Calc.calcCumulativeRelease(concentrations, V, Vs, W0);
    document.getElementById('cum-result').innerHTML = UI.renderTable(
      ['取样次数', '浓度', '校正累积释放%'],
      result.corrected.map((q, i) => ({ '取样次数': i + 1, '浓度': concentrations[i].toFixed(4), '校正累积释放%': q.toFixed(2) }))
    );
  }

  function showModelsCalculator(workspace) {
    workspace.innerHTML = `<div class="card">
      <div class="card-title">释放动力学模型拟合</div>
      <p style="color:var(--color-text-secondary);margin-bottom:12px">自动拟合零级、一级、Higuchi、Korsmeyer-Peppas、Hixson-Crowell 5种模型</p>
      <div class="form-group">
        <label class="form-label">时间点 (h，逗号分隔)</label>
        <input type="text" id="model-time" class="form-input" placeholder="例如: 0.5, 1, 2, 4, 8, 12, 24">
      </div>
      <div class="form-group">
        <label class="form-label">累积释放率 (%，逗号分隔)</label>
        <input type="text" id="model-release" class="form-input" placeholder="例如: 8, 15, 25, 42, 58, 72, 85">
      </div>
      <button class="btn btn-primary" onclick="App.runModels()">拟合</button>
      <div id="model-result" style="margin-top:16px"></div>
    </div>`;
  }

  async function runModels() {
    const timeStr = document.getElementById('model-time').value;
    const releaseStr = document.getElementById('model-release').value;
    const timePoints = timeStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    const releasePercent = releaseStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));

    if (timePoints.length < 3 || releasePercent.length < 3 || timePoints.length !== releasePercent.length) {
      UI.toast('请输入至少3组时间-释放率数据，且数量一致', 'warning'); return;
    }

    const result = Calc.fitAllModels(timePoints, releasePercent);
    let html = UI.renderTable(
      ['模型', '方程', 'R²', '释放机制'],
      result.models.map(m => ({
        '模型': m.type,
        '方程': m.equation,
        'R²': m.R2.toFixed(4),
        '释放机制': m.params?.mechanism || '—'
      }))
    );

    html += `<div style="margin-top:12px;padding:12px;background:var(--color-success-bg);border-radius:8px;border:1px solid var(--color-success)">
      <p style="font-weight:500;color:var(--color-success)">最佳模型: ${result.bestModel.type} (R²=${result.bestModel.R2.toFixed(4)})</p>
    </div>`;

    html += `<div style="height:300px;margin-top:16px"><canvas id="model-fit-chart" height="300"></canvas></div>`;
    html += `<div style="height:250px;margin-top:16px"><canvas id="model-r2-chart" height="250"></canvas></div>`;

    document.getElementById('model-result').innerHTML = html;

    setTimeout(() => {
      try {
        Charts.renderModelFit('model-fit-chart', timePoints, releasePercent, result.models);
        Charts.renderModelR2Bar('model-r2-chart', result.models);
      } catch (e) {
        debugLog('渲染模型图表失败: ' + e.message);
      }
    }, 100);
  }

  function showF2Calculator(workspace) {
    workspace.innerHTML = `<div class="card">
      <div class="card-title">f2 相似因子计算</div>
      <p style="color:var(--color-text-secondary);margin-bottom:12px">比较两条释放曲线的相似度: f2 ≥ 50 表示相似</p>
      <div class="form-row" style="grid-template-columns:1fr 1fr">
        <div>
          <div class="form-group">
            <label class="form-label">参比制剂 时间点 (h)</label>
            <input type="text" id="f2-ref-time" class="form-input" placeholder="例如: 1, 2, 4, 8, 12">
          </div>
          <div class="form-group">
            <label class="form-label">参比制剂 释放率 (%)</label>
            <input type="text" id="f2-ref-release" class="form-input" placeholder="例如: 15, 25, 42, 58, 72">
          </div>
        </div>
        <div>
          <div class="form-group">
            <label class="form-label">测试制剂 时间点 (h)</label>
            <input type="text" id="f2-test-time" class="form-input" placeholder="例如: 1, 2, 4, 8, 12">
          </div>
          <div class="form-group">
            <label class="form-label">测试制剂 释放率 (%)</label>
            <input type="text" id="f2-test-release" class="form-input" placeholder="例如: 12, 22, 40, 55, 70">
          </div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="App.runF2()">计算 f2</button>
      <div id="f2-result" style="margin-top:16px"></div>
    </div>`;
  }

  async function runF2() {
    const refTime = document.getElementById('f2-ref-time').value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    const refRelease = document.getElementById('f2-ref-release').value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    const testTime = document.getElementById('f2-test-time').value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    const testRelease = document.getElementById('f2-test-release').value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));

    const result = Calc.calcF2(refTime, refRelease, testTime, testRelease);

    if (result.f2 === null) {
      document.getElementById('f2-result').innerHTML = `<div class="alert-card alert-warning">${result.note}</div>`;
      return;
    }

    document.getElementById('f2-result').innerHTML = `
      <div style="padding:16px;background:var(--color-${result.similar ? 'success' : 'danger'}-bg);border-radius:8px;border:1px solid var(--color-${result.similar ? 'success' : 'danger'})">
        <p style="font-size:16px;font-weight:500;color:var(--color-${result.similar ? 'success' : 'danger'})">f2 = ${result.f2}</p>
        <p>${result.interpretation}</p>
      </div>
    `;
  }

  function showResidualCalculator(workspace) {
    workspace.innerHTML = `<div class="card">
      <div class="card-title">释放残留率计算</div>
      <p style="color:var(--color-text-secondary);margin-bottom:12px">残留率 = 残余药量 / 初始药量 × 100</p>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">初始药量 (mg)</label>
          <input type="number" id="res-initial" class="form-input" placeholder="例如: 10">
        </div>
        <div class="form-group">
          <label class="form-label">残余药量 (mg)</label>
          <input type="number" id="res-remaining" class="form-input" placeholder="例如: 1.5">
        </div>
      </div>
      <button class="btn btn-primary" onclick="App.runResidual()">计算</button>
      <div id="res-result" style="margin-top:16px"></div>
    </div>`;
  }

  async function runResidual() {
    const initial = parseFloat(document.getElementById('res-initial').value);
    const remaining = parseFloat(document.getElementById('res-remaining').value);

    if (isNaN(initial) || isNaN(remaining)) { UI.toast('请输入有效数值', 'warning'); return; }

    const result = Calc.calcResidualRate(initial, remaining);
    document.getElementById('res-result').innerHTML = `
      <div style="padding:16px;background:var(--color-success-bg);border-radius:8px;border:1px solid var(--color-success)">
        <p style="font-size:16px;font-weight:500;color:var(--color-success)">残留率 = ${result.residualRate}%</p>
        <p style="color:var(--color-text-secondary)">已释放 = ${result.releasedPercent}%</p>
      </div>
    `;
  }

  // --- 创建文献对话框 ---
  function showCreateLiteratureDialog() {
    const body = `
      <div class="form-group">
        <label class="form-label">标题</label>
        <input type="text" id="new-lit-title" class="form-input" placeholder="论文标题">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">作者</label>
          <input type="text" id="new-lit-authors" class="form-input" placeholder="作者列表">
        </div>
        <div class="form-group">
          <label class="form-label">年份</label>
          <input type="number" id="new-lit-year" class="form-input" placeholder="例如: 2024">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">期刊</label>
          <input type="text" id="new-lit-journal" class="form-input" placeholder="期刊名称">
        </div>
        <div class="form-group">
          <label class="form-label">DOI</label>
          <input type="text" id="new-lit-doi" class="form-input" placeholder="DOI">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">标签（逗号分隔）</label>
        <input type="text" id="new-lit-tags" class="form-input" placeholder="例如: LLC,缓释,法舒地尔">
      </div>
      <div class="form-group">
        <label class="form-label">笔记</label>
        <textarea id="new-lit-notes" class="form-textarea" rows="3" placeholder="关键发现、数据摘要"></textarea>
      </div>
    `;
    const footer = `
      <button class="btn btn-secondary" onclick="UI.hideModal()">取消</button>
      <button class="btn btn-primary" onclick="App.createLiterature()">保存</button>
    `;
    UI.showModal('添加文献', body, footer);
  }

  async function createLiterature() {
    const title = document.getElementById('new-lit-title').value.trim();
    if (!title) { UI.toast('请输入文献标题', 'warning'); return; }

    const data = {
      title,
      authors: document.getElementById('new-lit-authors').value,
      year: document.getElementById('new-lit-year').value,
      journal: document.getElementById('new-lit-journal').value,
      doi: document.getElementById('new-lit-doi').value,
      tags: document.getElementById('new-lit-tags').value.split(',').map(t => t.trim()).filter(t => t),
      notes: document.getElementById('new-lit-notes').value,
      extractedData: {},
      rating: null
    };

    const litId = FSManager.generateLitId();
    try {
      await FSManager.createLiterature(litId, data);
      UI.hideModal();
      UI.toast('文献已添加', 'success');
      await navigate('knowledge');
    } catch (err) {
      UI.toast('添加失败: ' + err.message, 'danger');
    }
  }

  // --- 设置 ---
  // --- 设置页 ---
  async function showSettings() {
    const container = document.getElementById('app-content');
    if (!container) return;

    // 读取当前设置（异步）
    let settings = { apiConfigs: [], activeApi: null, theme: 'light' };
    try {
      const result = await FSManager.getSettings();
      if (result) {
        settings = { ...settings, ...result };
      }
    } catch (e) {
      console.warn('读取设置失败，使用默认值', e);
    }

    let html = `<div class="page-header">
      <div><div class="page-title">设置</div><div class="page-subtitle">配置 API、管理 Skill、自定义系统行为</div></div>
    </div>`;

    // API 配置部分
    html += `<div class="card" style="margin-bottom:20px">
      <div class="card-title">🤖 AI API 配置</div>
      <p style="color:var(--color-text-secondary);margin-bottom:16px">配置 AI API 用于智能数据分析。支持 MiniCPM、DeepSeek 等格式。</p>`;

    // API 列表
    if (settings.apiConfigs && settings.apiConfigs.length > 0) {
      html += `<div style="margin-bottom:16px">
        <div style="font-size:13px;color:var(--color-text-secondary);margin-bottom:8px">已配置的 API:</div>`;

      for (const [index, api] of settings.apiConfigs.entries()) {
        const isActive = settings.activeApi === api.id;
        html += `<div style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--color-border-light);border-radius:8px;margin-bottom:8px">
          <div style="flex:1">
            <div style="font-weight:500">${api.name}</div>
            <div style="font-size:12px;color:var(--color-text-tertiary)">${api.provider} · ${api.model}</div>
          </div>
          ${isActive ? '<span class="tag tag-success">当前使用</span>' : ''}
          <button class="btn btn-sm btn-secondary" onclick="App.setActiveApi(${index})">${isActive ? '✓ 使用中' : '使用此 API'}</button>
          <button class="btn btn-sm btn-danger" onclick="App.deleteApi(${index})">删除</button>
        </div>`;
      }

      html += `</div>`;
    } else {
      html += `<div class="alert-card alert-info" style="margin-bottom:16px">暂无 API 配置，请添加新的 API。</div>`;
    }

    // 添加 API 按钮
    html += `<button class="btn btn-primary" onclick="App.showAddApiDialog()">+ 添加 API</button>`;

    html += `</div>`;

    // 分析 Skill 管理部分
    html += `<div class="card" style="margin-bottom:20px">
      <div class="card-title">🔧 分析 Skill 管理</div>
      <p style="color:var(--color-text-secondary);margin-bottom:16px">管理已安装的分析 Skill，用于智能识别数据类型并分析。</p>`;

    // 这里可以显示已安装的 skill
    html += `<div style="padding:12px;border:1px solid var(--color-border-light);border-radius:8px;margin-bottom:16px">
      <div style="font-weight:500">默认分析 Skill</div>
      <div style="font-size:12px;color:var(--color-text-tertiary);margin-top:4px">自动识别释放度数据、处方组成、残留率数据、LLC 表征图片等</div>
      <div style="margin-top:8px">
        <span class="tag tag-success">已启用</span>
      </div>
    </div>`;

    html += `<button class="btn btn-secondary" onclick="UI.toast('Skill 管理功能将在后续版本完善', 'info')">添加自定义 Skill</button>`;

    html += `</div>`;

    // 其他设置
    html += `<div class="card">
      <div class="card-title">⚙️ 其他设置</div>
      <div style="padding:12px;border:1px solid var(--color-border-light);border-radius:8px">
        <div style="font-weight:500;margin-bottom:4px">数据存储</div>
        <div style="font-size:12px;color:var(--color-text-tertiary)">所有数据安全存储于云端 Turso 数据库</div>
      </div>
    </div>`;

    container.innerHTML = html;
  }

  // --- 显示添加 API 对话框 ---
  function showAddApiDialog() {
    const body = `
      <div class="form-group">
        <label class="form-label">预设配置（可选，选择后自动填写）</label>
        <select id="api-preset" class="form-input" onchange="App.applyApiPreset()">
          <option value="">-- 手动填写 --</option>
          <option value="minicpm-v46">MiniCPM-V 4.6（免费公测 Key）</option>
          <option value="deepseek">DeepSeek（需填写自己的 Key）</option>
          <option value="openai">OpenAI 兼容（需填写自己的 Key）</option>
        </select>
      </div>
      <hr style="margin:12px 0;border:none;border-top:1px solid var(--color-border-light)">
      <div class="form-group">
        <label class="form-label">API 名称</label>
        <input type="text" id="api-name" class="form-input" placeholder="例如：MiniCPM-V 4.6">
      </div>
      <div class="form-group">
        <label class="form-label">提供商</label>
        <select id="api-provider" class="form-input">
          <option value="minicpm">MiniCPM</option>
          <option value="deepseek">DeepSeek</option>
          <option value="openai">OpenAI 兼容</option>
          <option value="custom">自定义</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">API Base URL</label>
        <input type="text" id="api-base-url" class="form-input" placeholder="例如：https://api.modelbest.co/v1">
      </div>
      <div class="form-group">
        <label class="form-label">API Key</label>
        <input type="password" id="api-key" class="form-input" placeholder="输入 API Key">
        <p id="api-key-hint" style="font-size:12px;color:var(--color-text-tertiary);margin-top:4px"></p>
      </div>
      <div class="form-group">
        <label class="form-label">模型名称</label>
        <input type="text" id="api-model" class="form-input" placeholder="例如：MiniCPM-V-4.6-Instruct">
        <p id="api-model-hint" style="font-size:12px;color:var(--color-text-tertiary);margin-top:4px"></p>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary" onclick="UI.hideModal()">取消</button>
      <button class="btn btn-primary" onclick="App.addApi()">添加</button>
    `;

    UI.showModal('添加 API', body, footer);
  }

  // --- 应用 API 预设 ---
  function applyApiPreset() {
    const preset = document.getElementById('api-preset').value;
    if (!preset) return;

    const presets = {
      'minicpm-v46': {
        name: 'MiniCPM-V 4.6（ModelBest）',
        provider: 'minicpm',
        baseUrl: 'https://api.modelbest.co/v1',
        apiKey: 'lis_sk_298cf78155f231c7_DkrDcNLHnK8dJRnfFrJCd4JGDbBLMkHrC3T-wLpvC9zy0BPemsyFuQ',
        model: 'MiniCPM-V-4.6-Instruct',
        keyHint: '当前使用免费公测 Key，无需修改。如需更高额度请前往 modelbest.cn 申请。',
        modelHint: '可选：MiniCPM-V-4.6-Instruct（指令模型）或 MiniCPM-V-4.6-Thinking（推理模型）'
      },
      'deepseek': {
        name: 'DeepSeek',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        apiKey: '',
        model: 'deepseek-chat',
        keyHint: '请填写你的 DeepSeek API Key',
        modelHint: '可选：deepseek-chat（对话）或 deepseek-reasoner（推理）'
      },
      'openai': {
        name: 'OpenAI 兼容',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4-turbo',
        keyHint: '请填写你的 OpenAI API Key',
        modelHint: '填写你要使用的模型名称，如 gpt-4-turbo、gpt-4-vision-preview 等'
      }
    };

    const p = presets[preset];
    if (!p) return;

    document.getElementById('api-name').value = p.name;
    document.getElementById('api-provider').value = p.provider;
    document.getElementById('api-base-url').value = p.baseUrl;
    document.getElementById('api-key').value = p.apiKey;
    document.getElementById('api-model').value = p.model;
    document.getElementById('api-key-hint').textContent = p.keyHint || '';
    document.getElementById('api-model-hint').textContent = p.modelHint || '';
  }

  // --- 添加 API ---
  async function addApi() {
    const name = document.getElementById('api-name').value.trim();
    const provider = document.getElementById('api-provider').value;
    const baseUrl = document.getElementById('api-base-url').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();
    const model = document.getElementById('api-model').value.trim();

    if (!name || !baseUrl || !apiKey || !model) {
      UI.toast('请填写所有必填字段', 'warning');
      return;
    }

    try {
      const settings = await FSManager.getSettings();
      const newApi = {
        id: `api-${Date.now().toString(36)}`,
        name,
        provider,
        baseUrl,
        apiKey,
        model
      };

      settings.apiConfigs = settings.apiConfigs || [];
      settings.apiConfigs.push(newApi);

      // 如果是第一个 API，自动设为活跃
      if (settings.apiConfigs.length === 1) {
        settings.activeApi = newApi.id;
      }

      await FSManager.writeJSON('settings.json', settings);

      UI.hideModal();
      UI.toast('API 添加成功', 'success');

      // 刷新设置页面
      showSettings();
    } catch (err) {
      UI.toast('添加 API 失败: ' + err.message, 'danger');
    }
  }

  // --- 设置活跃 API ---
  async function setActiveApi(index) {
    try {
      const settings = await FSManager.getSettings();
      const api = settings.apiConfigs[index];
      settings.activeApi = api.id;

      await FSManager.writeJSON('settings.json', settings);

      UI.toast(`已切换到 ${api.name}`, 'success');

      // 刷新设置页面
      showSettings();
    } catch (err) {
      UI.toast('切换 API 失败: ' + err.message, 'danger');
    }
  }

  // --- 删除 API ---
  async function deleteApi(index) {
    try {
      const settings = await FSManager.getSettings();
      const api = settings.apiConfigs[index];

      UI.confirm('删除 API', `确定要删除 API "${api.name}" 吗？`, async () => {
        settings.apiConfigs.splice(index, 1);

        // 如果删除的是活跃 API，清除活跃状态
        if (settings.activeApi === api.id) {
          settings.activeApi = settings.apiConfigs.length > 0 ? settings.apiConfigs[0].id : null;
        }

        await FSManager.writeJSON('settings.json', settings);

        UI.toast('API 已删除', 'success');

        // 刷新设置页面
        showSettings();
      });
    } catch (err) {
      UI.toast('删除 API 失败: ' + err.message, 'danger');
    }
  }

  // --- 更改项目目录 ---
  async function changeDirectory() {
    UI.toast('云端版本无需选择数据目录，数据自动保存到数据库', 'info');
    showSettings();
  }

  // --- AI 分析文件 ---
  async function analyzeWithAI(fileName) {
    // 检查是否有配置的 API
    let settings;
    try {
      settings = await FSManager.getSettings();
    } catch (e) {
      UI.toast('请先在设置中配置 AI API', 'warning');
      return;
    }

    if (!settings.activeApi) {
      UI.toast('请先在设置中选择要使用的 API', 'warning');
      return;
    }

    try {
      // 获取活跃的 API 配置
      const api = settings.apiConfigs.find(a => a.id === settings.activeApi);
      if (!api) {
        UI.toast('找不到活跃的 API 配置', 'danger');
        return;
      }

      UI.toast('正在使用 AI 分析文件...', 'info');

      // 读取上传的文件
      const uploadDir = await FSManager.getDirHandle('uploads');
      const fileHandle = await uploadDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();

      // 解析文件
      const parsedResult = await Parser.parseFile(file);

      // 调用 AI API 进行分析
      const analysisResult = await callAIAPI(api, parsedResult);

      // 显示分析结果
      showAnalysisResult(fileName, analysisResult);

    } catch (err) {
      UI.toast('AI 分析失败: ' + err.message, 'danger');
    }
  }

  // --- 调用 AI API ---
  async function callAIAPI(apiConfig, parsedResult) {
    // 构建提示词
    let prompt = '请分析以下药物制剂实验数据，识别数据类型并提供分析：\n\n';

    if (parsedResult.sheets) {
      for (const [sheetName, sheetData] of Object.entries(parsedResult.sheets)) {
        prompt += `Sheet: ${sheetName}\n`;
        prompt += `数据: ${sheetData.rowCount} 行 × ${sheetData.colCount} 列\n`;
        if (sheetData.rows.length > 0) {
          prompt += '前几行数据:\n';
          for (const row of sheetData.rows.slice(0, 5)) {
            prompt += row.join(', ') + '\n';
          }
        }
        prompt += '\n';
      }
    } else if (parsedResult.plainText) {
      prompt += `文本内容: ${parsedResult.plainText.substring(0, 2000)}\n\n`;
    }

    prompt += '\n请识别数据类型（释放度数据、处方组成、残留率数据、LLC表征等），并提供相应的分析建议。';

    // 根据提供商构建请求
    let apiUrl = '';
    let headers = {};
    let body = {};

    switch (apiConfig.provider) {
      case 'openai':
      case 'deepseek':
      case 'minicpm':
        // MiniCPM-V 使用 OpenAI 兼容格式
        apiUrl = `${apiConfig.baseUrl}/chat/completions`;
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiConfig.apiKey}`
        };
        body = {
          model: apiConfig.model,
          messages: [
            { role: 'user', content: prompt }
          ]
        };
        break;

      default:
        throw new Error(`不支持的 API 提供商: ${apiConfig.provider}`);
    }

    // 通过本地代理服务器发送请求（解决 CORS 问题）
    let response;
    try {
      // 构建代理请求
      const proxyPayload = {
        targetUrl: apiUrl,
        headers: headers,
        body: body
      };

      response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyPayload)
      });

      if (!response.ok) {
        let errorText;
        try {
          const errorData = await response.json();
          errorText = typeof errorData.error === 'string' ? errorData.error : (errorData.error?.message || JSON.stringify(errorData));
        } catch (e) {
          errorText = await response.text();
        }
        throw new Error(`代理请求失败 (${response.status}): ${errorText}`);
      }
    } catch (fetchErr) {
      // 如果代理服务器不可用，尝试直接调用（可能失败于 CORS）
      if (fetchErr.message.includes('Failed to fetch') || fetchErr.message === 'Failed to fetch') {
        throw new Error(
          `无法连接到本地代理服务器 (http://localhost:8080)。\n` +
          `请确保已通过 start.command 启动服务器，或使用 new start.command。\n\n` +
          `技术说明：AI API 不支持浏览器直接调用（CORS 限制），\n` +
          `必须通过本地代理服务器转发请求。`
        );
      }
      throw fetchErr;
    }

    const result = await response.json();
    if (!result.choices || !result.choices[0] || !result.choices[0].message) {
      throw new Error(`API 返回格式异常: ${JSON.stringify(result)}`);
    }
    return result.choices[0].message.content;
  }

  // --- 显示分析结果 ---
  function showAnalysisResult(fileName, analysisResult) {
    const body = `
      <div style="margin-bottom:16px">
        <strong>文件:</strong> ${fileName}
      </div>
      <div style="padding:16px;background:var(--color-bg-secondary);border-radius:8px;max-height:400px;overflow-y:auto">
        ${analysisResult.replace(/\n/g, '<br>')}
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary" onclick="UI.hideModal()">关闭</button>
      <button class="btn btn-primary" onclick="UI.toast('导入功能将在后续版本完善', 'info')">导入分析结果</button>
    `;

    UI.showModal('AI 分析结果', body, footer);
  }

  // --- 导出实验报告 ---
  async function exportReport(expId, format) {
    try {
      const meta = await FSManager.readJSON(`experiments/${expId}/meta.json`);
      const data = meta.data;
      let formulation = { data: { components: [] } };
      let release = { data: { timePoints: [], cumulativeRelease: [] } };
      let residual = { data: {} };
      let calculations = { data: { items: [] } };

      try { formulation = await FSManager.readJSON(`experiments/${expId}/formulation.json`); } catch(e) {}
      try { release = await FSManager.readJSON(`experiments/${expId}/release.json`); } catch(e) {}
      try { residual = await FSManager.readJSON(`experiments/${expId}/residual.json`); } catch(e) {}
      try { calculations = await FSManager.readJSON(`experiments/${expId}/calculations.json`); } catch(e) {}

      if (format === 'word') {
        // 生成 Word 报告（HTML 格式，保存为 .doc）
        let html = `
          <html xmlns:o="urn:schemas-microsoft-com:office:office"
                xmlns:w="urn:schemas-microsoft-com:office:word"
                xmlns="http://www.w3.org/TR/REC-html40">
          <head><meta charset="utf-8"><title>${data.name} - 实验报告</title></head>
          <body>
            <h1>${data.name} - 实验报告</h1>
            <p><strong>实验ID:</strong> ${data.id}</p>
            <p><strong>日期:</strong> ${data.date}</p>
            <p><strong>标签:</strong> ${(data.tags || []).join(', ')}</p>
            <p><strong>备注:</strong> ${data.notes || '无'}</p>

            <h2>处方组成</h2>
            ${formulation.data.components.length > 0 ?
              `<table border="1" style="border-collapse:collapse;width:100%">
                <tr><th>组分</th><th>用量</th><th>单位</th></tr>
                ${formulation.data.components.map(c => `<tr><td>${c.name}</td><td>${c.amount}</td><td>${c.unit}</td></tr>`).join('')}
              </table>` :
              '<p>暂无处方数据</p>'
            }

            <h2>释放度数据</h2>
            ${release.data.timePoints.length > 0 ?
              `<table border="1" style="border-collapse:collapse;width:100%">
                <tr><th>时间(h)</th><th>累积释放(%)</th></tr>
                ${release.data.timePoints.map((t, i) => `<tr><td>${t}</td><td>${release.data.cumulativeRelease[i]}</td></tr>`).join('')}
              </table>` :
              '<p>暂无释放数据</p>'
            }

            <h2>残留率数据</h2>
            ${residual.data.initialAmount ?
              `<p>初始药量: ${residual.data.initialAmount} mg</p>
               <p>残余药量: ${residual.data.remainingAmount} mg</p>
               <p>残留率: ${residual.data.residualRate}%</p>` :
              '<p>暂无残留率数据</p>'
            }

            <h2>计算结果</h2>
            ${(calculations.data.items || []).length > 0 ?
              `<table border="1" style="border-collapse:collapse;width:100%">
                <tr><th>类型</th><th>时间</th><th>结果</th></tr>
                ${calculations.data.items.map(item => `<tr><td>${item.type}</td><td>${item.timestamp?.split('T')[0] || '—'}</td><td>${Object.entries(item.results).map(([k, v]) => `${k}=${v}`).join(', ')}</td></tr>`).join('')}
              </table>` :
              '<p>暂无计算结果</p>'
            }
          </body></html>
        `;

        const blob = new Blob([html], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${data.name}_报告.doc`;
        a.click();
        URL.revokeObjectURL(url);
        UI.toast('Word 报告已导出', 'success');
      } else if (format === 'pdf') {
        // 使用浏览器打印功能导出 PDF
        UI.toast('正在生成 PDF 报告，请使用浏览器的"打印"功能另存为 PDF', 'info');
        setTimeout(() => {
          window.print();
        }, 500);
      }
    } catch (err) {
      UI.toast('导出报告失败: ' + err.message, 'danger');
    }
  }

  // --- 导出备份 ---
  function exportZip() {
    UI.toast('导出功能将在后续版本完善，目前可直接拷贝项目数据目录作为备份', 'info');
  }

  // --- 启动 ---
  document.addEventListener('DOMContentLoaded', () => {
    try {
      init();
    } catch (err) {
      console.error('启动致命错误:', err.message);
      UI.toast('系统启动失败: ' + err.message, 'error', 5000);
    }
  });

  return {
    navigate,
    logout,
    showCreateExperimentDialog,
    createExperiment,
    viewExperiment,
    viewExperimentCards,
    deleteExperiment,
    deleteExperimentGroup,
    analyzeWithSkill,
    showSaveToExperiment,
    doSaveToExperiment,
    onSaveExpSelectChange,
    onSaveSampleChange,
    toggleSelectAllRows,
    clearAllReports,
    deleteReportAtUpload,
    viewImage,
    showUploadImageDialog,
    uploadImage,
    uploadToExperiment,
    processExperimentUpload,
    upload,
    importParsedData,
    confirmImport,
    exportReport,
    showCalculator,
    runEE,
    runDL,
    runCumulative,
    runModels,
    runF2,
    runResidual,
    showCreateLiteratureDialog,
    createLiterature,
    showSettings,
    showAddApiDialog,
    applyApiPreset,
    addApi,
    setActiveApi,
    deleteApi,
    changeDirectory,
    analyzeWithAI,
    exportZip
  };
})();
