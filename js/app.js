/* ========================================
   app.js — V2 应用入口、路由、鉴权管理
   去除 FSManager 依赖，全部改为 API 驱动
   用户数据绑定 UID，退出登录不丢失
   ======================================== */

const App = (() => {
  let currentPage = 'dashboard';
  let experimentsCache = [];
  let initialized = false;
  let _parsedFiles = {};
  let _lastUploadFileName = '';

  // ============================================================
  // DOM 预渲染缓存系统
  // ============================================================
  const _pageCache = {};
  const _pageCacheValid = {};
  const PAGE_LIST = ['dashboard', 'upload', 'experiments', 'tools', 'knowledge', 'prescription', 'sample', 'settings'];

  function _initPageContainers() {
    const content = document.getElementById('app-content');
    if (!content) return;
    content.innerHTML = PAGE_LIST.map(p =>
      `<div id="page-${p}" class="page-content" style="display:none"></div>`
    ).join('');
  }

  async function _prerenderAllPages() {
    _initPageContainers();
    await _renderPageInto('dashboard');
    await _renderPageInto('upload');
    await _renderPageInto('experiments');
    await _renderPageInto('tools');
    await _renderPageInto('prescription');
    await _renderPageInto('sample');
    await _renderPageInto('knowledge');
    await _renderPageInto('settings');
  }

  async function _renderPageInto(page) {
    const container = document.getElementById(`page-${page}`);
    if (!container) return;
    try {
      switch (page) {
        case 'dashboard': await renderDashboard(container); break;
        case 'upload': renderUploadPage(container); break;
        case 'experiments': await renderExperimentsPage(container); break;
        case 'tools': renderToolsPage(container); break;
        case 'knowledge': await renderKnowledgePage(container); break;
        case 'prescription': await renderPrescriptionPage(container); break;
        case 'sample': await renderSamplePage(container); break;
        case 'settings': await _renderSettingsInto(container); break;
      }
      _pageCacheValid[page] = true;
    } catch (e) {
      console.warn('[Cache] 预渲染页面', page, '失败:', e.message);
      container.innerHTML = `<div class="empty-state"><p>页面加载失败，请刷新重试</p></div>`;
    }
  }

  function _invalidatePage(page) {
    _pageCacheValid[page] = false;
  }

  function _invalidateAllPages() {
    PAGE_LIST.forEach(p => _pageCacheValid[p] = false);
  }

  async function _refreshPage(page) {
    _invalidatePage(page);
    await _renderPageInto(page);
    if (currentPage === page) _showPage(page);
  }

  function _showPage(page) {
    PAGE_LIST.forEach(p => {
      const div = document.getElementById(`page-${p}`);
      if (div) div.style.display = 'none';
    });
    const target = document.getElementById(`page-${page}`);
    if (target) target.style.display = 'block';
  }

  // ============================================================
  // 主题切换
  // ============================================================
  function toggleTheme() {
    const body = document.body;
    const isDark = body.classList.toggle('dark-theme');
    try { localStorage.setItem('app_theme', isDark ? 'dark' : 'light'); } catch(e) {}
    const btn = event && event.currentTarget;
    if (btn) {
      const icon = btn.querySelector('.material-icons-outlined');
      if (icon) icon.textContent = isDark ? 'dark_mode' : 'light_mode';
    }
    UI.toast(isDark ? '已切换到暗色主题' : '已切换到亮色主题', 'info');
  }

  function _initTheme() {
    try {
      const theme = localStorage.getItem('app_theme');
      if (theme === 'dark') document.body.classList.add('dark-theme');
    } catch(e) {}
  }

  function refreshPage() {
    _refreshPage(currentPage);
    UI.toast('页面已刷新', 'info');
  }

  // ============================================================
  // 全局 API 封装
  // ============================================================
  async function apiFetch(url, options = {}) {
    try {
      const res = await fetch(url, {
        credentials: 'same-origin',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          ...(options.headers || {})
        },
        ...options
      });
      if (res.status === 401) {
        console.warn('[Auth] 接口 401 未授权，执行强制登出');
        forceLogout();
        return null;
      }
      return res;
    } catch (err) {
      console.error('[API] 请求失败:', url, err.message);
      throw err;
    }
  }

  // ============================================================
  // 鉴权：登出
  // ============================================================
  function forceLogout() {
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    document.cookie.split(';').forEach(c => {
      document.cookie = c.replace(/^ +/, '')
        .replace(/=.*/, `=; expires=${new Date(0).toUTCString()}; path=/`);
    });
    initialized = false;
    experimentsCache = [];
    window.location.replace('/api/auth/logout');
  }

  function logout() {
    console.log('[Auth] 执行退出登录');
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    document.cookie.split(';').forEach(c => {
      document.cookie = c.replace(/^ +/, '')
        .replace(/=.*/, `=; expires=${new Date(0).toUTCString()}; path=/`);
    });
    initialized = false;
    experimentsCache = [];
    window.location.replace('/api/auth/logout');
  }

  // ============================================================
  // 启动流程
  // ============================================================
  async function init() {
    console.log('[Fasudil-LLC V2] App.init()');
    _initTheme();

    // 检查登录标记
    const localUser = (() => {
      try { return JSON.parse(localStorage.getItem('auth_user')); } catch { return null; }
    })();

    if (!localUser) {
      console.log('[Fasudil-LLC V2] 无本地登录标记，显示登录页');
      safeShowLoginScreen();
      return;
    }

    // 乐观渲染主应用骨架
    const loginScreen = document.getElementById('login-screen');
    const appMain = document.getElementById('app-main');
    if (loginScreen) loginScreen.style.display = 'none';
    if (appMain) appMain.style.display = 'block';

    // 显示用户邮箱
    const emailEl = document.getElementById('sidebar-user-email');
    if (emailEl && localUser.email) emailEl.textContent = localUser.email;

    _initPageContainers();

    try {
      const [authRes] = await Promise.all([
        fetch('/api/auth/me', {
          credentials: 'same-origin',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
        }),
        (ExperimentCards.preloadTemplateCache ? ExperimentCards.preloadTemplateCache() : Promise.resolve()),
        ML.loadRules().catch(e => console.warn('加载规则失败:', e.message))
      ]);

      if (authRes && authRes.ok) {
        console.log('[Fasudil-LLC V2] 鉴权通过，进入主应用');
        _prerenderAllPages();
        await navigate('dashboard');
        initialized = true;
        console.log('[Fasudil-LLC V2] 应用初始化成功');
      } else {
        console.warn('[Fasudil-LLC V2] 鉴权失败，清除凭证');
        try { localStorage.removeItem('auth_user'); } catch {}
        initialized = false;
        if (loginScreen) loginScreen.style.display = 'flex';
        if (appMain) appMain.style.display = 'none';
        safeShowLoginScreen();
      }
    } catch (err) {
      console.error('[Fasudil-LLC V2] 登录检查失败:', err.message);
      try { localStorage.removeItem('auth_user'); } catch {}
      if (loginScreen) loginScreen.style.display = 'flex';
      if (appMain) appMain.style.display = 'none';
      safeShowLoginScreen();
    }
  }

  function safeShowLoginScreen() {
    try {
      const loginScreen = document.getElementById('login-screen');
      const appMain = document.getElementById('app-main');
      if (appMain) appMain.style.display = 'none';
      if (loginScreen) loginScreen.style.display = 'flex';

      const container = document.getElementById('login-form-container');
      if (!container) return;

      if (typeof UI.renderLoginForm === 'function') {
        try { UI.renderLoginForm(container); } catch (e) {
          fallbackRenderLogin(container);
        }
      } else {
        fallbackRenderLogin(container);
      }
    } catch (outerErr) {
      document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f4f8;font-family:sans-serif">
          <div style="background:#fff;padding:40px 36px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.12);width:360px;text-align:center">
            <h1 style="font-size:22px;color:#1e3a5f;margin-bottom:6px">Fasudil-LLC Analyzer V2</h1>
            <p style="font-size:12px;color:#8c94a6;margin-bottom:28px">盐酸法舒地尔缓释制剂 · 数据分析系统</p>
            <p style="font-size:14px;color:#e74c3c;margin-bottom:16px">系统加载异常，请刷新页面重试</p>
            <button onclick="location.reload()" style="padding:10px 24px;background:#0d7377;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer">刷新页面</button>
          </div>
        </div>
      `;
    }
  }

  function fallbackRenderLogin(container) {
    container.innerHTML = `
      <div class="login-field">
        <label for="fb-email">邮箱地址</label>
        <input type="email" class="form-input" id="fb-email" placeholder="请输入邮箱" autocomplete="email">
      </div>
      <div class="login-field">
        <label for="fb-otp">验证码</label>
        <div class="login-input-group">
          <input type="text" class="form-input" id="fb-otp" placeholder="6 位验证码" maxlength="6">
          <button class="btn btn-secondary" id="fb-send-btn">发送验证码</button>
        </div>
      </div>
      <button class="btn btn-primary login-btn" id="fb-login-btn">登 录</button>
      <div id="fb-error" class="login-error"></div>
      <div class="login-hint">验证码将发送至您的邮箱，有效期 10 分钟</div>
    `;

    document.getElementById('fb-send-btn').addEventListener('click', async function() {
      const email = document.getElementById('fb-email').value.trim();
      if (!email || !email.includes('@')) {
        const errEl = document.getElementById('fb-error');
        errEl.textContent = '请输入有效邮箱';
        errEl.classList.add('visible');
        return;
      }
      this.disabled = true;
      this.textContent = '发送中...';
      try {
        const r = await fetch('/api/auth/otp/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const d = await r.json();
        if (r.ok && d.success) {
          let c = 60;
          this.textContent = c + 's';
          const t = setInterval(() => {
            c--; this.textContent = c + 's';
            if (c <= 0) { clearInterval(t); this.disabled = false; this.textContent = '重新发送'; }
          }, 1000);
          document.getElementById('fb-otp').focus();
        } else {
          this.disabled = false; this.textContent = '重新发送';
          document.getElementById('fb-error').textContent = d.error || '发送失败';
          document.getElementById('fb-error').classList.add('visible');
        }
      } catch(e) {
        this.disabled = false; this.textContent = '重新发送';
        document.getElementById('fb-error').textContent = '网络错误';
        document.getElementById('fb-error').classList.add('visible');
      }
    });

    document.getElementById('fb-login-btn').addEventListener('click', async function() {
      const email = document.getElementById('fb-email').value.trim();
      const otp = document.getElementById('fb-otp').value.trim();
      if (!otp) {
        document.getElementById('fb-error').textContent = '请输入验证码';
        document.getElementById('fb-error').classList.add('visible');
        return;
      }
      this.disabled = true;
      this.textContent = '登录中...';
      try {
        const r = await fetch('/api/auth/otp/verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, otp })
        });
        const d = await r.json();
        if (r.ok && d.success) {
          try { if (d.data.user) localStorage.setItem('auth_user', JSON.stringify(d.data.user)); } catch (e) {}
          try { sessionStorage.setItem('logged_in', '1'); } catch (e) {}
          window.location.href = '/';
        } else {
          document.getElementById('fb-error').textContent = d.error || '验证失败';
          document.getElementById('fb-error').classList.add('visible');
          this.disabled = false; this.textContent = '登 录';
        }
      } catch(e) {
        document.getElementById('fb-error').textContent = '网络错误';
        document.getElementById('fb-error').classList.add('visible');
        this.disabled = false; this.textContent = '登 录';
      }
    });
  }

  // ============================================================
  // 路由导航
  // ============================================================
  async function navigate(page) {
    currentPage = page;
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    let target = document.getElementById(`page-${page}`);
    if (!target) {
      _initPageContainers();
      target = document.getElementById(`page-${page}`);
    }

    if (!_pageCacheValid[page]) {
      await _renderPageInto(page);
    }

    _showPage(page);
    return page;
  }

  // ============================================================
  // 页面渲染函数（全部保留V1逻辑，API调用改为 async）
  // ============================================================

  // --- 首页总览 ---
  async function renderDashboard(container) {
    const experiments = await ExperimentData.getAllExperiments();
    let totalSamples = 0, totalFinalRate = 0, rateCount = 0, totalResidual = 0, residualCount = 0, totalRecovery = 0, recoveryCount = 0;

    for (const exp of experiments) {
      for (const s of (exp.samples || [])) {
        totalSamples++;
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
          const rates = cum.map(c => (c / (s.expDrugAmount !== undefined ? s.expDrugAmount : (s.totalDrug || 0))) * 100);
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

  // --- 上传分析 ---
  async function renderUploadPage(container) {
    const experiments = await ExperimentData.getAllExperiments();
    let allReports = [];
    for (const exp of experiments) {
      for (const s of (exp.samples || [])) {
        try {
          const reports = await ExperimentData.getReports(exp.id, s.id);
          for (const r of (reports || [])) {
            allReports.push({ expName: exp.name, sampleId: s.id, title: r.title || '', timestamp: r.timestamp || '' });
          }
        } catch (e) { /* 跳过加载失败的报告 */ }
      }
    }
    allReports.sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));

    let html = `<div class="page-header">
      <div><div class="page-title">上传分析</div><div class="page-subtitle">上传文件解析数据，导入到实验组</div></div>
    </div>
    <div class="card" style="padding:12px 16px;display:flex;align-items:center;gap:12px">
      <span style="font-size:13px;color:var(--color-text-secondary);white-space:nowrap">上传文件</span>
      <label class="btn btn-primary btn-sm" style="cursor:pointer;white-space:nowrap">
        <span class="material-icons-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px">upload_file</span>
        选择文件
        <input type="file" id="upload-hidden-input" style="display:none" multiple accept="*" onchange="App.upload.handleFiles(this.files)">
      </label>
      <span style="font-size:11px;color:var(--color-text-tertiary)">支持 xlsx/csv/pdf/docx/pzfx/图片/JSON</span>
    </div>`;

    html += '<div id="upload-preview" style="margin-top:16px"></div>';
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
          <div style="font-size:13px;margin-bottom:4px">${r.sampleId} · ${r.expName}</div>
          <div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:6px">${r.title}</div>
          <span class="tag tag-teal" style="font-size:10px">${r.timestamp ? new Date(r.timestamp).toLocaleDateString('zh-CN') : '—'}</span>
        </div>`;
      }
      html += '</div>';
    }
    html += '</div>';

    container.innerHTML = html;
    document.getElementById('upload-hidden-input')?.addEventListener('change', function() {
      App.upload.handleFiles(this.files);
    });
  }

  // --- 实验记录页 ---
  async function renderExperimentsPage(container) {
    const experiments = await ExperimentData.getAllExperiments();

    let html = `<div class="page-header">
      <div><div class="page-title">实验记录</div><div class="page-subtitle">${experiments.length} 个实验组</div></div>
      <button class="btn btn-primary" onclick="ExperimentCards.showCreateDialog()">
        <span class="material-icons-outlined" style="font-size:14px;vertical-align:middle;margin-right:3px;color:white">add</span>
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
          const rates = cum.map(c => (c / (sample.expDrugAmount !== undefined ? sample.expDrugAmount : (sample.totalDrug || 0))) * 100);
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
                <span class="material-icons-outlined" style="font-size:13px;vertical-align:middle;margin-right:2px">open_in_new</span>
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

  // --- 删除实验组 ---
  async function deleteExperimentGroup(groupId) {
    UI.confirm('确认删除', '此操作将永久删除该实验组及其所有样品和报告，不可恢复。', async () => {
      await ExperimentData.deleteExperiment(groupId);
      UI.toast('实验组已删除', 'success');
      _invalidatePage('experiments');
      _invalidatePage('dashboard');
      _invalidatePage('prescription');
      _invalidatePage('sample');
      _refreshPage('experiments');
    });
  }

  // --- 上传处理 ---
  const upload = {
    async handleDrop(event) {
      await this.handleFiles(event.dataTransfer.files);
    },
    async handleFiles(files) {
      if (!files || files.length === 0) return;
      if (files.length > 0) _lastUploadFileName = files[0].name;
      const previewDiv = document.getElementById('upload-preview');
      if (!previewDiv) return;
      previewDiv.innerHTML = '<div class="card"><div class="card-title">文件解析预览</div>';
      for (const file of files) {
        try {
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
    html += `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="App.showSaveToExperiment('${fileName}')">📥 保存到实验</button>
      <button class="btn btn-secondary btn-sm" onclick="App.analyzeWithSkill('${fileName}')">📊 Skill 分析</button>
    </div>`;
    html += '</div>';
    return html;
  }

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
      const DRUG_AMOUNT_PLACEHOLDER = 3.43;
      finalRate = absVals.length > 0 ? (cum[cum.length-1] / DRUG_AMOUNT_PLACEHOLDER) * 100 : 0;
    }
    const html = `<div style="background:var(--color-bg-secondary);border-radius:8px;padding:16px;margin-bottom:12px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px"><div><strong>文件:</strong> ${fileName}</div><div><strong>数据行数:</strong> ${absVals.length}</div><div><strong>估计释放率:</strong> ${finalRate.toFixed(2)}%</div></div></div><div style="font-size:13px;color:var(--color-text-secondary)"><p>• 文件包含 ${absVals.length} 数据点，估计释放率 ${finalRate.toFixed(2)}%。</p><p>• 通过「保存到实验」导入后进行完整 Skill 分析。</p></div>`;
    UI.showModal(`Skill 分析 — ${fileName}`, `<div style="max-height:500px;overflow-y:auto">${html}</div>`, `<button class="btn btn-primary btn-sm" onclick="UI.hideModal();App.showSaveToExperiment('${fileName}')">📥 保存到实验</button><button class="btn btn-secondary btn-sm" onclick="UI.hideModal()">关闭</button>`);
  }

  async function showSaveToExperiment(fileName) {
    _lastUploadFileName = fileName;
    const experiments = await ExperimentData.getAllExperiments();
    const expOptions = experiments.map(e => `<option value="${e.id}">${e.name} (${e.id})</option>`).join('');
    const parsed = _parsedFiles[fileName];
    let sheetPreview = '';
    if (parsed && parsed.sheets) { const f = Object.values(parsed.sheets)[0]; if (f) sheetPreview = ` · ${f.rowCount}行×${f.colCount}列`; }

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
                  return `<tr>
                    <td style="text-align:center"><input type="checkbox" class="preview-row-check" data-row="${i}" checked></td>
                    <td style="padding:4px 8px" class="${timeEmpty ? 'cell-value-empty' : ''}">${timeEmpty ? '(空)' : r[0]}</td>
                    <td style="padding:4px 8px" class="${r[1]==null ? 'cell-value-empty' : ''}">${r[1]==null ? '(空)' : r[1]}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
      }
    }

    const body = `<div style="display:flex;flex-direction:column;gap:12px">
      <div style="padding:8px 12px;background:var(--color-info-bg);border-radius:8px;font-size:13px"><span class="material-icons-outlined" style="font-size:14px;margin-right:4px">folder</span> ${fileName}${sheetPreview}</div>
      <div class="form-group"><label class="form-label" for="save-exp-select">目标实验组 *</label>
        <select class="form-select" id="save-exp-select" name="save_exp_select" onchange="App.onSaveExpSelectChange()" style="font-size:13px">
          <option value="">-- 选择实验组 --</option>
          <option value="__new__">+ 新建实验组...</option>
          ${expOptions}
        </select>
      </div>
      <div class="form-group"><label class="form-label" for="save-form-name">处方名称 *</label>
        <select class="form-select" id="save-form-name" name="save_form_name" style="font-size:13px">
          <option value="">-- 请先选择实验组 --</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label" for="save-sample-id">样品编号 *</label>
        <select class="form-select" id="save-sample-id" name="save_sample_id" onchange="App.onSaveSampleChange()" style="font-size:13px">
          <option value="">-- 请先选择实验组 --</option>
        </select>
      </div>
      <div id="new-sample-wrap" style="display:none" class="form-group">
        <label class="form-label" for="new-sample-id-input">新样品编号</label>
        <input class="form-input" id="new-sample-id-input" name="new_sample_id_input" placeholder="如 U1、N1" style="font-size:13px">
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
    if (sel.value === '__new__') {
      UI.hideModal();
      setTimeout(() => {
        ExperimentCards.showCreateDialog();
        UI.toast('创建实验组后，重新上传文件并选择该组导入', 'info');
      }, 150);
      return;
    }
    const expId = sel.value;
    if (!expId) { _resetFormulationAndSample('-- 请先选择实验组 --', '-- 请先选择实验组 --'); return; }
    const exp = ExperimentData.getExperiment(expId);
    if (!exp) return;
    const formSelect = document.getElementById('save-form-name');
    if (formSelect) {
      const formulations = exp.formulations || [];
      let opts = '<option value="">-- 选择处方 --</option>';
      for (const f of formulations) opts += `<option value="${f.name}">${f.name}</option>`;
      formSelect.innerHTML = opts;
      formSelect.onchange = function() { _onFormulationChange(exp); };
    }
    const sampleSelect = document.getElementById('save-sample-id');
    if (sampleSelect) {
      sampleSelect.innerHTML = '<option value="">-- 请先选择处方 --</option>';
      sampleSelect.onchange = function() { _toggleNewSampleInput(); };
    }
    _toggleNewSampleInput();
  }

  function _onFormulationChange(exp) {
    const formSelect = document.getElementById('save-form-name');
    const sampleSelect = document.getElementById('save-sample-id');
    if (!sampleSelect || !formSelect) return;
    const formName = formSelect.value;
    if (!formName) { sampleSelect.innerHTML = '<option value="">-- 请先选择处方 --</option>'; _toggleNewSampleInput(); return; }
    const matching = (exp.samples || []).filter(s => s.formulation === formName);
    let opts = '<option value="__new__">+ 新建样品...</option>';
    for (const s of matching) opts += `<option value="${s.id}">${s.id}</option>`;
    sampleSelect.innerHTML = opts;
    _toggleNewSampleInput();
  }

  function onSaveSampleChange() { _toggleNewSampleInput(); }
  function _toggleNewSampleInput() {
    const wrap = document.getElementById('new-sample-wrap');
    if (wrap) wrap.style.display = (document.getElementById('save-sample-id')?.value === '__new__') ? 'block' : 'none';
  }
  function _resetFormulationAndSample(fph, sph) {
    const fs = document.getElementById('save-form-name');
    const ss = document.getElementById('save-sample-id');
    if (fs) fs.innerHTML = `<option value="">${fph}</option>`;
    if (ss) ss.innerHTML = `<option value="">${sph}</option>`;
    _toggleNewSampleInput();
  }

  function toggleSelectAllRows(checkbox) {
    document.querySelectorAll('.preview-row-check').forEach(cb => cb.checked = checkbox.checked);
  }

  function doSaveToExperiment(fileName) {
    const sel = document.getElementById('save-exp-select');
    const expId = sel ? sel.value : '';
    if (!expId) { UI.toast('请选择目标实验组', 'warning'); return; }
    const exp = ExperimentData.getExperiment(expId);
    if (!exp) { UI.toast('实验组未找到', 'warning'); return; }
    const formName = (document.getElementById('save-form-name')?.value || '').trim();
    if (!formName) { UI.toast('请选择处方名称', 'warning'); return; }
    let sampleId = '';
    const sampleSelect = document.getElementById('save-sample-id');
    if (sampleSelect && sampleSelect.value === '__new__') {
      sampleId = (document.getElementById('new-sample-id-input')?.value || '').trim();
      if (!sampleId) { UI.toast('请输入新样品编号', 'warning'); return; }
    } else { sampleId = (sampleSelect?.value || '').trim(); }
    if (!sampleId) { UI.toast('请选择样品编号', 'warning'); return; }
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
    } else { selectedRows = allRows; }
    if (selectedRows.length === 0) { UI.toast('请勾选至少一行数据', 'warning'); return; }
    let existingSample = (exp.samples || []).find(s => s.id === sampleId);
    if (!existingSample) {
      const formObj = (exp.formulations || []).find(f => f.name === formName);
      const ns = {
        id: sampleId, experimentId: expId, formulation: formName,
        formulationComponents: formObj ? (formObj.components || {}) : {},
        formulationTotal: formObj ? (formObj.total || 0) : 0,
        totalDrug: formObj ? (formObj.perRowExpDrugAmount !== undefined ? formObj.perRowExpDrugAmount : (exp.drugAmount || 0)) : (exp.drugAmount || 0),
        group: exp.name,
        finalRate: 0, residualAbs: 0, residualAmount: 0, residualRate: 0, totalRecovery: 0
      };
      exp.samples.push(ns);
    }
    const tableRows = selectedRows.map(r => ({
      time: (r[0] != null && String(r[0]).trim() !== '') ? String(r[0]) : '',
      absorbance: (r[1] != null && String(r[1]).trim() !== '') ? (parseFloat(r[1]) || 0) : null,
      sampleVol: 2, totalVol: 30
    }));
    ExperimentData.saveTableData(expId, sampleId, tableRows);
    UI.hideModal();
    UI.toast(`已导入 ${selectedRows.length} 行 →「${exp.name}·${sampleId}」`, 'success');
    viewExperimentCards(expId);
  }

  // --- 小工具页（完全保留 V1 逻辑） ---
  function renderToolsPage(container) {
    const calculators = [
      { id: 'ee', name: '包封率 EE%', icon: 'percent' },
      { id: 'dl', name: '载药量 DL%', icon: 'monitor_weight' },
      { id: 'cumulative', name: '累积释放校正', icon: 'timeline' },
      { id: 'models', name: '释放动力学拟合', icon: 'auto_graph' },
      { id: 'f2', name: 'f2 相似因子', icon: 'compare_arrows' },
      { id: 'residual', name: '释放残留率', icon: 'pending' }
    ];

    let html = `<div class="page-header">
      <div><div class="page-title">小工具</div><div class="page-subtitle">辅助实验数据分析工具集合</div></div>
    </div>`;
    html += '<div class="card"><div class="card-title">计算工具合集</div>';
    html += '<p style="font-size:13px;color:var(--color-text-secondary);margin-bottom:16px">选择计算类型，输入数据，自动输出计算结果</p>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px">';
    for (const calc of calculators) {
      html += `<button class="btn btn-secondary" style="padding:16px;text-align:center" onclick="App.showToolCalculator('${calc.id}')">
        <div style="font-size:22px;margin-bottom:4px"><span class="material-icons-outlined" style="font-size:22px">${calc.icon}</span></div>
        <div>${calc.name}</div>
      </button>`;
    }
    html += '</div></div>';
    html += '<div id="calc-workspace" style="margin-top:24px"></div>';
    container.innerHTML = html;
  }

  // --- 知识库页 ---
  async function renderKnowledgePage(container) {
    let html = `<div class="page-header">
      <div><div class="page-title">知识库</div><div class="page-subtitle">文献管理、经验积累、对比分析</div></div>
      <button class="btn btn-primary" onclick="App.showCreateLiteratureDialog()">添加文献</button>
    </div>`;

    let literature = [];
    try {
      const res = await apiFetch('/api/data/knowledge?type=literature');
      if (res && res.ok) { const d = await res.json(); if (d.data) literature = d.data; }
    } catch(e) {}

    html += UI.renderTabs([
      { label: '文献', content: `<div class="card">
        ${literature.length === 0 ?
          UI.renderEmptyState('暂无文献', '添加相关论文的关键数据与方法', '添加文献', "App.showCreateLiteratureDialog()") :
          UI.renderTable(['ID', '标题', '类型', '标签'], literature.map(lit => ({
            ID: lit.id, 标题: lit.title || '—', 类型: lit.type || '—', 标签: Array.isArray(lit.tags) ? lit.tags.join(', ') : '—'
          })))
        }
      </div>` },
      { label: '经验', content: '<div class="card"><div class="card-title">经验条目</div><p style="color:var(--color-text-tertiary)">记录条件→操作→结果→结论，可提炼为自学习规则</p></div>' },
      { label: '对比分析', content: '<div class="card"><div class="card-title">实验 vs 文献</div><p style="color:var(--color-text-tertiary)">选择实验和文献数据，同图对比释放曲线，计算 f2</p></div>' }
    ], 0);

    container.innerHTML = html;
  }

  // --- 处方管理 ---
  async function renderPrescriptionPage(container) {
    const experiments = await ExperimentData.getAllExperiments();
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
          <td>${(c.spc||0).toFixed(2)}</td><td>${(c.gmo||0).toFixed(2)}</td><td>${(c.nmp||0).toFixed(2)}</td>
          <td>${(c.water||0).toFixed(2)}</td><td>${(c.etoh||0).toFixed(2)}</td><td>${(c.dopg||0).toFixed(2)}</td>
          <td><strong>${(f.total||0).toFixed(2)}</strong></td>
          <td>${(f.samples||[]).join(', ')}</td>
          <td><span class="tag tag-default">${f.source}</span></td>
        </tr>`;
      }
      html += '</tbody></table></div>';
    }
    container.innerHTML = html;
  }

  // --- 样本管理 ---
  async function renderSamplePage(container) {
    const experiments = await ExperimentData.getAllExperiments();
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
          <td><strong>${s.id}</strong></td><td>${s.formulation||'—'}</td><td>${((s.expDrugAmount !== undefined ? s.expDrugAmount : (s.totalDrug || 0))||0).toFixed(2)}</td><td>${s.expName||'—'}</td>
          <td>${(s.finalRate||0).toFixed(2)}%</td><td>${(s.residualRate||0).toFixed(2)}%</td><td>${(s.totalRecovery||0).toFixed(2)}%</td>
          <td><button class="btn btn-sm btn-primary" onclick="App.viewExperimentCards('${s.expId}')">查看</button></td>
        </tr>`;
      }
      html += '</tbody></table></div>';
    }
    container.innerHTML = html;
  }

  // --- 设置页 ---
  async function _renderSettingsInto(container) {
    let settings = { apiConfigs: [], activeApi: null, theme: 'light' };

    // 读取偏好
    try {
      const res = await apiFetch('/api/data/preferences', { method: 'GET' });
      if (res && res.ok) { const d = await res.json(); if (d.data) settings = { ...settings, ...d.data }; }
    } catch(e) {}

    let html = `<div class="page-header">
      <div><div class="page-title">设置</div><div class="page-subtitle">配置 API、管理模板、自定义系统行为</div></div>
    </div>`;

    // API 配置
    html += `<div class="card" style="margin-bottom:20px">
      <div class="card-title"><span class="material-icons-outlined" style="font-size:16px;margin-right:4px">smart_toy</span> AI API 配置</div>
      <p style="color:var(--color-text-secondary);margin-bottom:16px">配置 AI API 用于智能数据分析。</p>`;

    if (settings.apiConfigs && settings.apiConfigs.length > 0) {
      html += `<div style="margin-bottom:16px"><div style="font-size:13px;color:var(--color-text-secondary);margin-bottom:8px">已配置的 API:</div>`;
      for (const [index, api] of settings.apiConfigs.entries()) {
        const isActive = settings.activeApi === api.id;
        html += `<div style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--color-border-light);border-radius:8px;margin-bottom:8px">
          <div style="flex:1">
            <div style="font-weight:500">${api.name}</div>
            <div style="font-size:12px;color:var(--color-text-tertiary)">${api.provider} · ${api.model}</div>
          </div>
          ${isActive ? '<span class="tag tag-success">当前使用</span>' : ''}
          <button class="btn btn-sm btn-secondary" onclick="App.setActiveApi(${index})">${isActive ? '使用中' : '使用此 API'}</button>
          <button class="btn btn-sm btn-danger" onclick="App.deleteApi(${index})">删除</button>
        </div>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="alert-card alert-info" style="margin-bottom:16px">暂无 API 配置，请添加新的 API。</div>`;
    }
    html += `<button class="btn btn-primary" onclick="App.showAddApiDialog()">+ 添加 API</button></div>`;

    // 模板管理
    const tplData = await ExperimentData.getAllTemplates();
    const userTemplates = tplData.userTemplates;
    const builtinTpl = tplData.builtin;
    const userDefaultId = await ExperimentData.getUserDefaultTemplateId();

    html += `<div class="card" style="margin-bottom:20px">
      <div class="card-title" style="display:flex;align-items:center;gap:8px">
        <span><span class="material-icons-outlined" style="font-size:16px;margin-right:4px">construction</span> 实验表格模板管理</span>
        <span class="tag tag-info">内置标准 + ${userTemplates.length} 套自定义</span>
      </div>
      <p style="color:var(--color-text-secondary);margin-bottom:16px">系统内置标准模板为只读基准模板；可创建自定义模板扩展列结构与计算规则。</p>
      <div id="template-list-container">
        <div class="template-card" style="border:1px solid var(--color-border-light);border-radius:8px;padding:12px;margin-bottom:8px;background:var(--color-bg-tertiary);opacity:0.9">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
            <div>
              <strong>${builtinTpl.name}</strong>
              <span class="tag tag-default" style="margin-left:6px;font-size:10px;background:#8c94a6;color:#fff">内置·不可编辑</span>
              ${userDefaultId === 'system_default' ? '<span class="tag tag-primary" style="margin-left:6px">首选</span>' : ''}
              <span style="font-size:12px;color:var(--color-text-tertiary);margin-left:8px">${builtinTpl.columns.length} 列 · ${builtinTpl.description||''}</span>
            </div>
            <div style="display:flex;gap:4px">
              <button class="btn btn-sm btn-secondary" onclick="App._previewBuiltinTemplate()">预览</button>
              <button class="btn btn-sm btn-secondary" onclick="App._setDefaultTemplate('system_default')" style="${userDefaultId === 'system_default' ? 'opacity:0.5' : ''}">设为首选</button>
            </div>
          </div>
          <div style="font-size:12px;color:var(--color-text-tertiary);overflow-x:auto;white-space:nowrap">
            ${builtinTpl.columns.map(c => `<span style="display:inline-block;padding:2px 6px;margin-right:4px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-bg-primary)">${c.label}${c.unit ? '('+c.unit+')' : ''}${c.type === 'computed' ? ' ⚡' : ''}</span>`).join('')}
          </div>
        </div>
        ${userTemplates.length > 0
          ? userTemplates.map(tpl => _renderTemplateCard(tpl, userDefaultId)).join('')
          : '<div class="alert-card alert-info" style="margin-top:12px">暂无自定义模板。点击下方按钮创建第一个模板。</div>'
        }
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" onclick="App.showCreateTemplateDialog()">+ 新建模板</button>
        <button class="btn btn-secondary" onclick="App._resetDefaultTemplates()" title="清空全部自定义模板，仅保留系统内置标准模板">恢复到默认</button>
      </div>
    </div>`;

    container.innerHTML = html;
  }

  // ============================================================
  // 模板管理操作
  // ============================================================
  function _renderTemplateCard(tpl, userDefaultId) {
    return `<div class="template-card" style="border:1px solid var(--color-border);border-radius:8px;padding:12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <div>
          <strong>${tpl.name}</strong>
          <span class="tag tag-info" style="margin-left:6px;font-size:10px">自定义</span>
          ${userDefaultId === tpl.id ? '<span class="tag tag-primary" style="margin-left:6px">首选</span>' : ''}
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm btn-secondary" onclick="App._editTemplate('${tpl.id}')">编辑</button>
          <button class="btn btn-sm btn-secondary" onclick="App._cloneTemplate('${tpl.id}')">复制</button>
          <button class="btn btn-sm btn-danger" onclick="App._deleteTemplate('${tpl.id}')">删除</button>
          <button class="btn btn-sm btn-secondary" onclick="App._setDefaultTemplate('${tpl.id}')" style="${userDefaultId === tpl.id ? 'opacity:0.5' : ''}">设为首选</button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--color-text-tertiary);overflow-x:auto;white-space:nowrap">
        ${(tpl.columns||[]).map(c => `<span style="display:inline-block;padding:2px 6px;margin-right:4px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-bg-primary)">${c.label}${c.unit ? '('+c.unit+')' : ''}${c.type === 'computed' ? ' ⚡' : ''}</span>`).join('')}
      </div>
    </div>`;
  }

  async function _setDefaultTemplate(tplId) {
    try {
      await ExperimentData.saveUserDefaultTemplateId(tplId);
      UI.toast('已设为首选模板', 'success');
      _refreshPage('settings');
    } catch(e) { UI.toast('设置失败', 'danger'); }
  }

  async function _deleteTemplate(tplId) {
    UI.confirm('删除模板', '确定要删除此自定义模板吗？', async () => {
      try {
        await ExperimentData.deleteUserTemplate(tplId);
        UI.toast('模板已删除', 'success');
        _refreshPage('settings');
      } catch(e) { UI.toast('删除失败', 'danger'); }
    });
  }

  async function _cloneTemplate(tplId) {
    const cache = await ExperimentData.getUserTemplates();
    const src = cache.find(t => t.id === tplId);
    if (!src) { UI.toast('模板未找到', 'warning'); return; }
    const copy = ExperimentData.cloneTemplate(src);
    try {
      await ExperimentData.saveUserTemplate(copy);
      UI.toast('模板已复制', 'success');
      _refreshPage('settings');
    } catch(e) { UI.toast('复制失败', 'danger'); }
  }

  function _previewBuiltinTemplate() {
    const tpl = ExperimentData.getBuiltinTemplate();
    const colsHtml = tpl.columns.map(c =>
      `<tr><td>${c.id}</td><td>${c.label}</td><td>${c.type}</td><td>${c.unit||'—'}</td><td>${c.formula||'—'}</td></tr>`
    ).join('');
    UI.showModal('系统内置标准模板',
      `<table class="data-table"><thead><tr><th>字段ID</th><th>标签</th><th>类型</th><th>单位</th><th>公式</th></tr></thead><tbody>${colsHtml}</tbody></table>`,
      '<button class="btn btn-secondary" onclick="UI.hideModal()">关闭</button>'
    );
  }

  async function _editTemplate(tplId) {
    // 弹出编辑模板对话框（简化版：提示功能入口）
    UI.toast('模板编辑功能：请删除后重新创建', 'info');
  }

  async function _resetDefaultTemplates() {
    UI.confirm('恢复默认', '此操作将删除所有自定义模板，仅保留系统内置标准模板。确定继续？', async () => {
      const templates = await ExperimentData.getUserTemplates();
      for (const t of templates) {
        await ExperimentData.deleteUserTemplate(t.id);
      }
      await ExperimentData.saveUserDefaultTemplateId('system_default');
      ExperimentCards.refreshTemplateCache();
      UI.toast('已恢复到默认模板', 'success');
      _refreshPage('settings');
    });
  }

  function showCreateTemplateDialog() {
    UI.toast('模板创建功能开发中，请在设置页管理', 'info');
  }

  // ============================================================
  // AI API 管理
  // ============================================================
  function showAddApiDialog() { UI.toast('API 管理功能开发中', 'info'); }
  function setActiveApi(index) { UI.toast('API 管理功能开发中', 'info'); }
  function deleteApi(index) { UI.toast('API 管理功能开发中', 'info'); }

  // ============================================================
  // 计算器（完全保留 V1 逻辑）
  // ============================================================
  function showToolCalculator(calcType) {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === 'tools');
    });
    showCalculator(calcType);
  }

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

  function showEECalculator(ws) {
    ws.innerHTML = `<div class="card"><div class="card-title">包封率 EE% 计算</div><p style="color:var(--color-text-secondary);margin-bottom:12px">EE% = (W_total - W_free) / W_total × 100</p>
      <div class="form-row"><div class="form-group"><label class="form-label" for="ee-total">总药量 W_total (mg)</label><input type="number" id="ee-total" name="ee_total" class="form-input"></div>
      <div class="form-group"><label class="form-label" for="ee-free">游离药量 W_free (mg)</label><input type="number" id="ee-free" name="ee_free" class="form-input"></div></div>
      <button class="btn btn-primary" onclick="App.runEE()">计算</button><div id="ee-result" style="margin-top:16px"></div></div>`;
  }
  function runEE() {
    const total = parseFloat(document.getElementById('ee-total')?.value), free = parseFloat(document.getElementById('ee-free')?.value);
    if (isNaN(total) || isNaN(free)) { UI.toast('请输入有效数值', 'warning'); return; }
    const result = Calc.calcEE(total, free);
    document.getElementById('ee-result').innerHTML = `<div style="padding:16px;background:var(--color-success-bg);border-radius:8px;border:1px solid var(--color-success)"><p style="font-size:16px;font-weight:500;color:var(--color-success)">包封率 EE% = ${result.EE}%</p><p style="color:var(--color-text-secondary)">包封药量 = ${result.encapsulated.toFixed(2)} mg</p></div>`;
  }

  function showDLCalculator(ws) {
    ws.innerHTML = `<div class="card"><div class="card-title">载药量 DL% 计算</div><p style="color:var(--color-text-secondary);margin-bottom:12px">DL% = W_encapsulated / W_total_carrier × 100</p>
      <div class="form-row"><div class="form-group"><label class="form-label" for="dl-encap">包封药量 (mg)</label><input type="number" id="dl-encap" name="dl_encap" class="form-input"></div>
      <div class="form-group"><label class="form-label" for="dl-total">制剂总重 (mg)</label><input type="number" id="dl-total" name="dl_total" class="form-input"></div></div>
      <button class="btn btn-primary" onclick="App.runDL()">计算</button><div id="dl-result" style="margin-top:16px"></div></div>`;
  }
  function runDL() {
    const encap = parseFloat(document.getElementById('dl-encap')?.value), total = parseFloat(document.getElementById('dl-total')?.value);
    if (isNaN(encap) || isNaN(total)) { UI.toast('请输入有效数值', 'warning'); return; }
    const result = Calc.calcDL(encap, total);
    document.getElementById('dl-result').innerHTML = `<div style="padding:16px;background:var(--color-success-bg);border-radius:8px;border:1px solid var(--color-success)"><p style="font-size:16px;font-weight:500;color:var(--color-success)">载药量 DL% = ${result.DL}%</p></div>`;
  }

  function showCumulativeCalculator(ws) {
    ws.innerHTML = `<div class="card"><div class="card-title">累积释放校正计算</div><p style="color:var(--color-text-secondary);margin-bottom:12px">Qn = [Cn·V + ΣCi·Vs] / W₀ × 100</p>
      <div class="form-row"><div class="form-group"><label class="form-label" for="cum-v">溶出介质体积 V (mL)</label><input type="number" id="cum-v" name="cum_v" class="form-input" value="900"></div>
      <div class="form-group"><label class="form-label" for="cum-vs">取样体积 Vs (mL)</label><input type="number" id="cum-vs" name="cum_vs" class="form-input" value="5"></div>
      <div class="form-group"><label class="form-label" for="cum-w0">初始药量 W₀ (mg)</label><input type="number" id="cum-w0" name="cum_w0" class="form-input"></div></div>
      <div class="form-group"><label class="form-label" for="cum-conc">各时间点浓度 (μg/mL，逗号分隔)</label><input type="text" id="cum-conc" name="cum_conc" class="form-input"></div>
      <button class="btn btn-primary" onclick="App.runCumulative()">计算</button><div id="cum-result" style="margin-top:16px"></div></div>`;
  }
  function runCumulative() {
    const V = parseFloat(document.getElementById('cum-v')?.value), Vs = parseFloat(document.getElementById('cum-vs')?.value), W0 = parseFloat(document.getElementById('cum-w0')?.value);
    const concStr = document.getElementById('cum-conc')?.value || '';
    const concentrations = concStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    if (isNaN(V) || isNaN(Vs) || isNaN(W0) || concentrations.length === 0) { UI.toast('请输入有效数值', 'warning'); return; }
    const result = Calc.calcCumulativeRelease(concentrations, V, Vs, W0);
    document.getElementById('cum-result').innerHTML = UI.renderTable(['取样次数', '浓度', '校正累积释放%'], result.corrected.map((q, i) => ({ '取样次数': i + 1, '浓度': concentrations[i].toFixed(4), '校正累积释放%': q.toFixed(2) })));
  }

  function showModelsCalculator(ws) {
    ws.innerHTML = `<div class="card"><div class="card-title">释放动力学模型拟合</div><p style="color:var(--color-text-secondary);margin-bottom:12px">自动拟合零级、一级、Higuchi、Korsmeyer-Peppas、Hixson-Crowell 5种模型</p>
      <div class="form-group"><label class="form-label" for="model-time">时间点 (h，逗号分隔)</label><input type="text" id="model-time" name="model_time" class="form-input"></div>
      <div class="form-group"><label class="form-label" for="model-release">累积释放率 (%，逗号分隔)</label><input type="text" id="model-release" name="model_release" class="form-input"></div>
      <button class="btn btn-primary" onclick="App.runModels()">拟合</button><div id="model-result" style="margin-top:16px"></div></div>`;
  }
  function runModels() {
    const timeStr = document.getElementById('model-time')?.value || '', releaseStr = document.getElementById('model-release')?.value || '';
    const timePoints = timeStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    const releasePercent = releaseStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    if (timePoints.length < 3 || releasePercent.length < 3 || timePoints.length !== releasePercent.length) { UI.toast('请输入至少3组时间-释放率数据，且数量一致', 'warning'); return; }
    const result = Calc.fitAllModels(timePoints, releasePercent);
    let html = UI.renderTable(['模型', '方程', 'R²', '释放机制'], result.models.map(m => ({ '模型': m.type, '方程': m.equation, 'R²': m.R2.toFixed(4), '释放机制': m.params?.mechanism || '—' })));
    html += `<div style="margin-top:12px;padding:12px;background:var(--color-success-bg);border-radius:8px;border:1px solid var(--color-success)"><p style="font-weight:500;color:var(--color-success)">最佳模型: ${result.bestModel.type} (R²=${result.bestModel.R2.toFixed(4)})</p></div>`;
    html += `<div style="height:300px;margin-top:16px"><canvas id="model-fit-chart" height="300"></canvas></div>`;
    html += `<div style="height:250px;margin-top:16px"><canvas id="model-r2-chart" height="250"></canvas></div>`;
    document.getElementById('model-result').innerHTML = html;
    setTimeout(() => { try { Charts.renderModelFit('model-fit-chart', timePoints, releasePercent, result.models); Charts.renderModelR2Bar('model-r2-chart', result.models); } catch(e) {} }, 100);
  }

  function showF2Calculator(ws) {
    ws.innerHTML = `<div class="card"><div class="card-title">f2 相似因子计算</div><p style="color:var(--color-text-secondary);margin-bottom:12px">f2 ≥ 50 表示相似</p>
      <div class="form-row" style="grid-template-columns:1fr 1fr"><div><div class="form-group"><label class="form-label" for="f2-ref-time">参比 时间点 (h)</label><input type="text" id="f2-ref-time" name="f2_ref_time" class="form-input"></div>
      <div class="form-group"><label class="form-label" for="f2-ref-release">参比 释放率 (%)</label><input type="text" id="f2-ref-release" name="f2_ref_release" class="form-input"></div></div>
      <div><div class="form-group"><label class="form-label" for="f2-test-time">测试 时间点 (h)</label><input type="text" id="f2-test-time" name="f2_test_time" class="form-input"></div>
      <div class="form-group"><label class="form-label" for="f2-test-release">测试 释放率 (%)</label><input type="text" id="f2-test-release" name="f2_test_release" class="form-input"></div></div></div>
      <button class="btn btn-primary" onclick="App.runF2()">计算 f2</button><div id="f2-result" style="margin-top:16px"></div></div>`;
  }
  function runF2() {
    const refTime = (document.getElementById('f2-ref-time')?.value||'').split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    const refRelease = (document.getElementById('f2-ref-release')?.value||'').split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    const testTime = (document.getElementById('f2-test-time')?.value||'').split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    const testRelease = (document.getElementById('f2-test-release')?.value||'').split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    const result = Calc.calcF2(refTime, refRelease, testTime, testRelease);
    if (result.f2 === null) { document.getElementById('f2-result').innerHTML = `<div class="alert-card alert-warning">${result.note}</div>`; return; }
    document.getElementById('f2-result').innerHTML = `<div style="padding:16px;background:var(--color-${result.similar?'success':'danger'}-bg);border-radius:8px;border:1px solid var(--color-${result.similar?'success':'danger'})"><p style="font-size:16px;font-weight:500;color:var(--color-${result.similar?'success':'danger'})">f2 = ${result.f2}</p><p>${result.interpretation}</p></div>`;
  }

  function showResidualCalculator(ws) {
    ws.innerHTML = `<div class="card"><div class="card-title">释放残留率计算</div><p style="color:var(--color-text-secondary);margin-bottom:12px">残留率 = 残余药量 / 初始药量 × 100</p>
      <div class="form-row"><div class="form-group"><label class="form-label" for="res-initial">初始药量 (mg)</label><input type="number" id="res-initial" name="res_initial" class="form-input"></div>
      <div class="form-group"><label class="form-label" for="res-remaining">残余药量 (mg)</label><input type="number" id="res-remaining" name="res_remaining" class="form-input"></div></div>
      <button class="btn btn-primary" onclick="App.runResidual()">计算</button><div id="res-result" style="margin-top:16px"></div></div>`;
  }
  function runResidual() {
    const initial = parseFloat(document.getElementById('res-initial')?.value), remaining = parseFloat(document.getElementById('res-remaining')?.value);
    if (isNaN(initial) || isNaN(remaining)) { UI.toast('请输入有效数值', 'warning'); return; }
    const result = Calc.calcResidualRate(initial, remaining);
    document.getElementById('res-result').innerHTML = `<div style="padding:16px;background:var(--color-success-bg);border-radius:8px;border:1px solid var(--color-success)"><p style="font-size:16px;font-weight:500;color:var(--color-success)">残留率 = ${result.residualRate}%</p><p style="color:var(--color-text-secondary)">已释放 = ${result.releasedPercent}%</p></div>`;
  }

  // ============================================================
  // 卡片视图
  // ============================================================
  function viewExperimentCards(experimentId) {
    const content = document.getElementById('app-content');
    if (!content) return;
    content.innerHTML = '';
    const exp = experimentId ? ExperimentData.getExperiment(experimentId) : null;
    const meta = exp ? { name: exp.name, date: exp.date } : { name: '实验详情', date: '' };
    ExperimentCards.render(content, meta, experimentId);
  }

  // --- 文献管理 ---
  function showCreateLiteratureDialog() {
    const body = `
      <div class="form-group"><label class="form-label" for="new-lit-title">标题</label><input type="text" id="new-lit-title" name="new_lit_title" class="form-input"></div>
      <div class="form-row"><div class="form-group"><label class="form-label" for="new-lit-authors">作者</label><input type="text" id="new-lit-authors" name="new_lit_authors" class="form-input"></div>
      <div class="form-group"><label class="form-label" for="new-lit-year">年份</label><input type="number" id="new-lit-year" name="new_lit_year" class="form-input"></div></div>
      <div class="form-group"><label class="form-label" for="new-lit-tags">标签（逗号分隔）</label><input type="text" id="new-lit-tags" name="new_lit_tags" class="form-input"></div>
      <div class="form-group"><label class="form-label" for="new-lit-notes">笔记</label><textarea id="new-lit-notes" name="new_lit_notes" class="form-textarea" rows="3"></textarea></div>`;
    UI.showModal('添加文献', body, '<button class="btn btn-secondary" onclick="UI.hideModal()">取消</button><button class="btn btn-primary" onclick="App.createLiterature()">保存</button>');
  }

  async function createLiterature() {
    const title = document.getElementById('new-lit-title')?.value.trim();
    if (!title) { UI.toast('请输入文献标题', 'warning'); return; }
    try {
      await fetch('/api/data/knowledge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ type: 'literature', title, tags: (document.getElementById('new-lit-tags')?.value||'').split(',').map(t=>t.trim()).filter(Boolean), content: { authors: document.getElementById('new-lit-authors')?.value, year: document.getElementById('new-lit-year')?.value, notes: document.getElementById('new-lit-notes')?.value } })
      });
      UI.hideModal();
      UI.toast('文献已添加', 'success');
      _invalidatePage('knowledge');
      await navigate('knowledge');
    } catch(e) { UI.toast('添加失败', 'danger'); }
  }

  // ============================================================
  // 公开 API
  // ============================================================
  return {
    init, navigate, logout, forceLogout,
    toggleTheme, refreshPage,
    _invalidatePage, _invalidateAllPages, _refreshPage,
    _pageCache, _pageCacheValid,
    // 页面渲染
    renderDashboard, renderUploadPage, renderExperimentsPage,
    renderToolsPage, renderKnowledgePage, renderPrescriptionPage, renderSamplePage,
    // 上传
    upload, analyzeWithSkill, showSaveToExperiment, doSaveToExperiment,
    onSaveExpSelectChange, onSaveSampleChange, toggleSelectAllRows,
    // 实验操作
    deleteExperimentGroup, viewExperimentCards,
    // 计算器
    showToolCalculator, showCalculator,
    runEE, runDL, runCumulative, runModels, runF2, runResidual,
    // 模板管理
    _setDefaultTemplate, _deleteTemplate, _cloneTemplate,
    _previewBuiltinTemplate, _editTemplate, _resetDefaultTemplates,
    showCreateTemplateDialog, showCreateLiteratureDialog, createLiterature,
    // AI API 管理
    showAddApiDialog, setActiveApi, deleteApi
  };
})();

// ======== DOM 就绪后启动 ========
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
