/* ========================================
   app.js — 应用入口、路由、状态管理 (EdgeOne 版)
   含全局 401 拦截、登出凭证清除、前置鉴权
   ======================================== */

const App = (() => {
  let currentPage = 'dashboard';
  let experimentsCache = [];
  let initialized = false;
  let _parsedFiles = {};
  let _lastUploadFileName = '';

  // ============================================================
  // 全局 API 请求封装（自动处理 401 登出）
  // ============================================================

  /**
   * 统一的 API fetch 封装
   * - 捕获 401 → 自动执行登出流程
   * - 添加无缓存请求头
   */
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

      // 401 拦截：自动登出
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

  /**
   * 强制登出：清除所有凭证 → 跳转登录页
   */
  function forceLogout() {
    // 1. 清空 LocalStorage
    try {
      localStorage.clear();
    } catch (e) {}

    // 2. 清空 SessionStorage
    try {
      sessionStorage.clear();
    } catch (e) {}

    // 3. 清空所有 Cookie
    document.cookie.split(';').forEach(c => {
      document.cookie = c.replace(/^ +/, '')
        .replace(/=.*/, `=; expires=${new Date(0).toUTCString()}; path=/`);
    });

    // 4. 标记内存状态
    initialized = false;

    // 5. 硬跳转到登录页
    window.location.replace('/');
  }

  // ============================================================
  // 启动流程：前置鉴权 → 登录页 / 主应用
  // ============================================================

  async function init() {
    console.log('[Fasudil-LLC] App.init()');

    // 第一步：检查 localStorage 是否有已登录标记（快速路径）
    // 【注意】不能检查 document.cookie 中的 auth_token，因为该 cookie 是 HttpOnly，
    // 浏览器端的 JS 无法读取。必须通过 /api/auth/me 接口由服务端验证。
    const localUser = (() => {
      try { return JSON.parse(localStorage.getItem('auth_user')); } catch { return null; }
    })();

    if (!localUser) {
      // 无本地登录标记 → 直接显示登录页（无需发 API 请求）
      console.log('[Fasudil-LLC] 无本地登录标记，显示登录页');
      safeShowLoginScreen();
      return;
    }

    // 第二步：有本地标记，调用鉴权接口验证 token 有效性（服务端验证 HttpOnly cookie）
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });

      if (res.ok) {
        // 已登录 → 进入主应用
        console.log('[Fasudil-LLC] 鉴权通过，进入主应用');
        await enterMainApp();
      } else {
        // token 过期或无效 → 清除后显示登录页
        console.warn('[Fasudil-LLC] 鉴权失败（' + res.status + '），清除凭证');
        try { localStorage.removeItem('auth_user'); } catch {}
        initialized = false;
        safeShowLoginScreen();
      }
    } catch (err) {
      console.error('[Fasudil-LLC] 登录检查失败:', err.message);
      // 网络错误时尝试读取缓存的后台数据，不行就显示登录
      try { localStorage.removeItem('auth_user'); } catch {}
      safeShowLoginScreen();
    }
  }

  /**
   * 安全的登录页渲染（含完整容错，防止任何异常阻塞页面）
   */
  function safeShowLoginScreen() {
    // 确保第一个 try/catch 包裹全部逻辑，防止任何未捕获错误
    try {
      const loginScreen = document.getElementById('login-screen');
      const appMain = document.getElementById('app-main');

      // 隐藏主应用
      if (appMain) appMain.style.display = 'none';
      // 显示登录页
      if (loginScreen) loginScreen.style.display = 'flex';

      // 渲染登录表单
      const container = document.getElementById('login-form-container');
      if (!container) {
        console.warn('[SafeLogin] #login-form-container 元素不存在');
        return;
      }

      // 检查 UI.renderLoginForm 是否存在并合法
      if (typeof UI.renderLoginForm === 'function') {
        try {
          UI.renderLoginForm(container);
        } catch (renderErr) {
          console.error('[SafeLogin] renderLoginForm 执行异常:', renderErr);
          fallbackRenderLogin(container);
        }
      } else {
        console.warn('[SafeLogin] UI.renderLoginForm 未定义，使用兜底渲染');
        fallbackRenderLogin(container);
      }
    } catch (outerErr) {
      console.error('[SafeLogin] 登录页渲染严重错误:', outerErr);
      // 终极兜底：最简单的方式显示登录入口
      document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f4f8;font-family:sans-serif">
          <div style="background:#fff;padding:40px 36px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.12);width:360px;text-align:center">
            <h1 style="font-size:22px;color:#1e3a5f;margin-bottom:6px">Fasudil-LLC Analyzer</h1>
            <p style="font-size:12px;color:#8c94a6;margin-bottom:28px">盐酸法舒地尔缓释制剂 · 数据分析系统</p>
            <p style="font-size:14px;color:#e74c3c;margin-bottom:16px">系统加载异常，请刷新页面重试</p>
            <button onclick="location.reload()" style="padding:10px 24px;background:#0d7377;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer">刷新页面</button>
          </div>
        </div>
      `;
    }
  }

  /**
   * 兜底登录表单渲染（当 UI.renderLoginForm 不可用时）
   */
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
      <div class="login-hint">验证码将发送至您的邮箱，有效期 5 分钟</div>
    `;

    // 发送验证码
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

    // 登录
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
          // 登录成功：持久化用户信息 + 硬跳转
          try { if (d.user) localStorage.setItem('auth_user', JSON.stringify(d.user)); } catch (e) {}
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

  /** @deprecated 保留旧函数名作为兼容垫片，实际使用 safeShowLoginScreen */
  function showLoginScreen() {
    console.warn('[App] showLoginScreen 已废弃，建议直接使用 safeShowLoginScreen');
    safeShowLoginScreen();
  }

  /** 进入主应用 */
  async function enterMainApp() {
    // 切换 UI
    const loginScreen = document.getElementById('login-screen');
    const appMain = document.getElementById('app-main');
    if (loginScreen) loginScreen.style.display = 'none';
    if (appMain) appMain.style.display = 'block';

    try {
      try { await ML.loadRules(); } catch (e) { console.warn('加载规则失败:', e.message); }
      await navigate('dashboard');
      initialized = true;
      console.log('[Fasudil-LLC] 应用初始化成功');
    } catch (err) {
      console.error('[Fasudil-LLC] 初始化失败:', err.message);
      UI.toast('系统初始化失败: ' + err.message, 'error', 5000);
    }
  }

  // ============================================================
  // 退出登录（完整清除 + 强制跳转）
  // ============================================================

  /**
   * 退出登录：优先清空所有本地凭证，再跳转后端注销
   */
  function logout() {
    console.log('[Auth] 执行退出登录');

    // 1. 立即清空前端所有存储（防止跳转过程中残留）
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}

    // 2. 清除所有 Cookie
    document.cookie.split(';').forEach(c => {
      document.cookie = c.replace(/^ +/, '')
        .replace(/=.*/, `=; expires=${new Date(0).toUTCString()}; path=/`);
    });

    // 3. 清除内存状态
    initialized = false;
    experimentsCache = [];

    // 4. 跳转后端注销（清除 HTTP-only Cookie）+ 重定向到首页
    //    浏览器原生处理 302 → Set-Cookie → Location: /
    window.location.replace('/api/auth/logout');
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
      // analyzeWithSkill 是文件上传后的快速预览，此时无实验/样品对象
      // 使用固定占位值 3.43mg 作为预估总药量（用户导入后再精确计算）
      const DRUG_AMOUNT_PLACEHOLDER = 3.43;
      finalRate = absVals.length > 0 ? (cum[cum.length-1] / DRUG_AMOUNT_PLACEHOLDER) * 100 : 0;
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
        totalDrug: formObj ? (formObj.perRowExpDrugAmount !== undefined ? formObj.perRowExpDrugAmount : (exp.drugAmount || 0)) : (exp.drugAmount || 0),
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
          <td><strong>${s.id}</strong></td><td>${s.formulation||'—'}</td><td>${((s.expDrugAmount !== undefined ? s.expDrugAmount : (s.totalDrug || 0))||0).toFixed(2)}</td><td>${s.expName||'—'}</td>
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

    // ====== 实验表格模板管理（双架构：内置标准 + 用户自定义） ======
    const tplData = await ExperimentData.getAllTemplates();
    const userTemplates = tplData.userTemplates;
    const builtinTpl = tplData.builtin;
    const userDefaultId = await ExperimentData.getUserDefaultTemplateId();
    const totalCount = 1 + userTemplates.length; // 内置 + 用户自定义

    html += `<div class="card" style="margin-bottom:20px">
      <div class="card-title" style="display:flex;align-items:center;gap:8px">
        <span>📋 实验表格模板管理</span>
        <span class="tag tag-info">内置标准 + ${userTemplates.length} 套自定义</span>
      </div>
      <p style="color:var(--color-text-secondary);margin-bottom:16px">系统内置标准模板为只读基准模板；可创建自定义模板扩展列结构与计算规则。新建实验时自动加载首选模板。</p>

      <div id="template-list-container">
        <!-- 1. 系统内置标准模板卡片（只读） -->
        <div class="template-card" style="border:1px solid var(--color-border-light);border-radius:8px;padding:12px;margin-bottom:8px;
              background:var(--color-bg-tertiary);opacity:0.9">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
            <div>
              <strong>${builtinTpl.name}</strong>
              <span class="tag tag-default" style="margin-left:6px;font-size:10px;background:#8c94a6;color:#fff">内置·不可编辑</span>
              ${userDefaultId === 'system_default' ? '<span class="tag tag-primary" style="margin-left:6px">首选</span>' : ''}
              <span style="font-size:12px;color:var(--color-text-tertiary);margin-left:8px">
                ${builtinTpl.columns.length} 列 · ${builtinTpl.description||''}
              </span>
            </div>
            <div style="display:flex;gap:4px">
              <button class="btn btn-sm btn-secondary" onclick="App._previewBuiltinTemplate()">预览</button>
              <button class="btn btn-sm btn-secondary" onclick="App._setDefaultTemplate('system_default')"
                      style="${userDefaultId === 'system_default' ? 'opacity:0.5' : ''}">设为首选</button>
            </div>
          </div>
          <div style="font-size:12px;color:var(--color-text-tertiary);overflow-x:auto;white-space:nowrap">
            ${builtinTpl.columns.map(c => `<span style="display:inline-block;padding:2px 6px;margin-right:4px;
              border:1px solid var(--color-border);border-radius:4px;background:var(--color-bg-primary)">
              ${c.label}${c.unit ? '('+c.unit+')' : ''}${c.type === 'computed' ? ' ⚡' : ''}
            </span>`).join('')}
          </div>
        </div>

        <!-- 2. 用户自定义模板列表 -->
        ${userTemplates.length > 0
          ? userTemplates.map(tpl => _renderTemplateCard(tpl, userDefaultId)).join('')
          : '<div class="alert-card alert-info" style="margin-top:12px">暂无自定义模板。点击下方按钮创建第一个模板。</div>'
        }
      </div>

      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" onclick="App.showCreateTemplateDialog()">+ 新建模板</button>
        <button class="btn btn-secondary" onclick="App._resetDefaultTemplates()"
                title="清空全部自定义模板，仅保留系统内置标准模板">恢复到默认</button>
      </div>
    </div>`;

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
      <div class="form-group">
        <label class="form-label">项目数据目录</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input type="text" class="form-input" value="${FSManager.getDirName()}" disabled>
          <button class="btn btn-secondary btn-sm" onclick="App.changeDirectory()">更改</button>
        </div>
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
    try {
      const handle = await FSManager.selectDirectory();
      if (handle) {
        await FSManager.ensureProjectStructure();
        UI.toast('项目目录已更改', 'success');
        showSettings();
      }
    } catch (err) {
      UI.toast('更改目录失败: ' + err.message, 'danger');
    }
  }

  // ================================================================
  // 模板管理功能
  // ================================================================

  /** 渲染模板卡片 HTML */
  function _renderTemplateCard(tpl, userDefaultId) {
    const isDefault = (tpl.id === userDefaultId);
    return `
      <div class="template-card" style="border:1px solid var(--color-border-light);border-radius:8px;padding:12px;margin-bottom:8px;
            ${isDefault ? 'border-color:var(--color-teal);background:var(--color-info-bg)' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div>
            <strong>${tpl.name}</strong>
            ${isDefault ? '<span class="tag tag-primary" style="margin-left:6px">首选</span>' : ''}
            <span style="font-size:12px;color:var(--color-text-tertiary);margin-left:8px">
              ${(tpl.columns||[]).length} 列${tpl.description ? ' · ' + tpl.description : ''}
            </span>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm btn-secondary" onclick="App._editTemplate('${tpl.id}')">编辑</button>
            <button class="btn btn-sm btn-secondary" onclick="App._duplicateTemplate('${tpl.id}')">复制</button>
            <button class="btn btn-sm btn-secondary" onclick="App._setDefaultTemplate('${tpl.id}')"
                    style="${isDefault ? 'opacity:0.5' : ''}">设为首选</button>
            <button class="btn btn-sm btn-danger" onclick="App._deleteTemplate('${tpl.id}')">删除</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--color-text-tertiary);overflow-x:auto;white-space:nowrap">
          ${(tpl.columns||[]).map(c => `<span style="display:inline-block;padding:2px 6px;margin-right:4px;
            border:1px solid var(--color-border);border-radius:4px;background:var(--color-bg-primary)">
            ${c.label}${c.unit ? '('+c.unit+')' : ''}${c.type === 'computed' ? ' ⚡' : ''}
          </span>`).join('')}
        </div>
      </div>
    `;
  }

  /** 新建模板 */
  async function showCreateTemplateDialog() {
    const builtin = ExperimentData.getBuiltinTemplate();
    const newTpl = {
      id: 'tpl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: '',
      description: '',
      builtin: false,
      enabled: true,
      createdAt: new Date().toISOString(),
      columns: builtin.columns,
    };
    _editTemplate(newTpl);
  }

  /** 获取默认列配置（14列标准布局 - 已迁移至 ExperimentData.SYSTEM_DEFAULT_TEMPLATE） */
  function _getDefaultColumns() {
    return ExperimentData.getBuiltinTemplate().columns;
  }

  /** 预览内置模板 */
  function _previewBuiltinTemplate() {
    const builtin = ExperimentData.getBuiltinTemplate();
    _showTemplatePreviewInner(builtin.columns, '系统内置标准模板 · 预览');
  }

  /** 模板预览弹窗（通用） */
  function _showTemplatePreviewInner(columns, title) {
    let tableHtml = '<table class="data-table" style="font-size:12px"><thead><tr>';
    columns.forEach(col => {
      let label = col.label;
      if (col.unit) label += `<sub style="font-size:10px;color:#8c94a6">(${col.unit})</sub>`;
      if (col.type === 'computed') label += ' <span style="color:#0d7377;font-size:10px">⚡</span>';
      tableHtml += `<th style="padding:6px 4px;white-space:nowrap">${label}</th>`;
    });
    tableHtml += '</tr></thead><tbody><tr>';
    columns.forEach(col => {
      if (col.type === 'text' || col.type === 'samples') {
        tableHtml += '<td style="padding:4px"><input style="width:60px;padding:3px;border:1px solid #d8dce6;border-radius:3px;font-size:11px" disabled></td>';
      } else if (col.type === 'number') {
        tableHtml += '<td style="padding:4px"><input type="number" style="width:60px;padding:3px;border:1px solid #d8dce6;border-radius:3px;font-size:11px" disabled></td>';
      } else if (col.type === 'computed') {
        tableHtml += '<td style="padding:4px;text-align:center"><span style="padding:3px 8px;background:#f0f4f8;border-radius:3px;font-size:11px;color:#0d7377;font-weight:600">0.00</span></td>';
      }
    });
    tableHtml += '</tr></tbody></table>';
    UI.showModal(title || '模板表格预览', tableHtml, '<button class="btn btn-secondary" onclick="UI.hideModal()">关闭</button>');
  }

  /** 编辑模板 */
  async function _editTemplate(tplId) {
    const templates = await ExperimentData.getUserTemplates();
    const tpl = tplId ? templates.find(t => t.id === tplId) : null;
    const isNew = !tpl;
    const builtin = ExperimentData.getBuiltinTemplate();
    const data = tpl ? JSON.parse(JSON.stringify(tpl)) : {
      id: 'tpl-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
      name: '', description: '', builtin: false, enabled: true,
      createdAt: new Date().toISOString(), columns: builtin.columns
    };

    // 列编辑器
    let colsHtml = data.columns.map((col, i) => `
      <div class="tpl-column-row" data-index="${i}"
        style="display:flex;gap:8px;align-items:center;padding:8px;border:1px solid var(--color-border-light);
               border-radius:6px;margin-bottom:6px;background:var(--color-bg-primary)">
        <span style="cursor:grab;color:var(--color-text-tertiary)">⠿</span>
        <input class="form-input" data-edit="label" value="${col.label}" placeholder="列名" style="width:80px">
        <select class="form-input" data-edit="type" onchange="App._onColumnEditTypeChange(this,${i})" style="width:90px">
          <option value="text" ${col.type==='text'?'selected':''}>文本</option>
          <option value="number" ${col.type==='number'?'selected':''}>数值</option>
          <option value="computed" ${col.type==='computed'?'selected':''}>自动计算</option>
          <option value="samples" ${col.type==='samples'?'selected':''}>样品复选</option>
          <option value="dynamic" ${col.type==='dynamic'?'selected':''}>动态模式</option>
        </select>
        <input class="form-input tpl-unit-input" data-edit="unit" value="${col.unit||''}"
               placeholder="单位" style="width:50px;${col.type==='number'?'':'display:none'}">
        <input class="form-input tpl-formula-input" data-edit="formula" value="${col.formula||''}"
               placeholder="公式" style="flex:1;${col.type==='computed'?'':'display:none'}">
        <input class="form-input tpl-formula-desc-input" data-edit="formulaDescription" value="${col.formulaDescription||''}"
               placeholder="公式说明(选填)" style="width:120px;${col.type==='computed'?'':'display:none'}">
        <input class="form-input" data-edit="width" value="${col.width||'80px'}" placeholder="宽度" style="width:65px">
        <button class="btn btn-sm btn-danger" onclick="App._removeTemplateColumn(${i},this)">✕</button>
      </div>
    `).join('');

    const body = `
      <div>
        <div style="display:flex;gap:12px;margin-bottom:12px">
          <div style="flex:2">
            <label class="form-label">模板名称 *</label>
            <input class="form-input" id="tpl-edit-name" value="${data.name}" placeholder="如：标准脂质体处方">
          </div>
          <div style="flex:1">
            <label class="form-label">设为默认</label>
            <label class="switch" style="display:block;margin-top:4px">
              <input type="checkbox" id="tpl-edit-default" ${data.isDefault?'checked':''}>
              <span class="slider"></span>
            </label>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">模板描述</label>
          <input class="form-input" id="tpl-edit-desc" value="${data.description||''}" placeholder="选填">
        </div>
        <label class="form-label" style="display:flex;justify-content:space-between;align-items:center">
          <span>列配置</span>
          <button class="btn btn-sm btn-secondary" onclick="App._addTemplateColumn()">+ 新增列</button>
        </label>
        <div id="tpl-columns-container" style="margin-top:8px;max-height:400px;overflow-y:auto">
          ${colsHtml}
        </div>
        <div style="margin-top:12px;padding:12px;background:var(--color-bg-tertiary);border-radius:8px">
          <div style="font-weight:500;margin-bottom:8px;font-size:13px">🤖 AI 辅助</div>
          <button class="btn btn-sm btn-secondary" onclick="App._showAIGenerateFormulaDialog('${data.id}')">AI生成公式</button>
          <span style="font-size:12px;color:var(--color-text-tertiary);margin-left:8px">
            根据文字描述自动生成计算列公式
          </span>
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary" onclick="App._showTemplatePreview('${data.id}')">预览表格</button>
      <button class="btn btn-secondary" onclick="UI.hideModal()">取消</button>
      <button class="btn btn-primary" id="tpl-save-btn">保存模板</button>
    `;

    UI.showModal(isNew ? '新建模板' : '编辑模板', body, footer);
    document.getElementById('tpl-save-btn').onclick = () => _saveTemplateFromDialog(data.id, isNew);
  }

  /** 从弹窗收集数据并保存模板 */
  async function _saveTemplateFromDialog(tplId, isNew) {
    const name = document.getElementById('tpl-edit-name').value.trim();
    if (!name) { UI.toast('请输入模板名称','warning'); return; }

    // 【新增】重名校验
    const isDuplicate = await ExperimentData.isTemplateNameDuplicate(name, tplId);
    if (isDuplicate) {
      UI.toast(`模板名称「${name}」已存在，请更换名称`, 'warning');
      return;
    }

    const desc = document.getElementById('tpl-edit-desc').value.trim();

    // 收集列配置
    const columnRows = document.querySelectorAll('#tpl-columns-container .tpl-column-row');
    const columns = [];
    columnRows.forEach((row, i) => {
      const label = row.querySelector('[data-edit="label"]').value.trim();
      if (!label) return;
      const type = row.querySelector('[data-edit="type"]').value;
      const unit = row.querySelector('[data-edit="unit"]')?.value || '';
      const formula = row.querySelector('[data-edit="formula"]')?.value || '';
      const formulaDesc = row.querySelector('[data-edit="formulaDescription"]')?.value || '';
      const width = row.querySelector('[data-edit="width"]')?.value || '80px';
      columns.push({
        id: 'col_' + i + '_' + label.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, ''),
        label, type, unit, width, order: i,
        default: type === 'number' ? 0 : '',
        formula: type === 'computed' ? formula : undefined,
        formulaDescription: type === 'computed' ? (formulaDesc || undefined) : undefined,
        modes: type === 'dynamic' ? [{id:'manual',label:'手动输入'},{id:'formula',label:'公式计算'}] : undefined,
        defaultMode: type === 'dynamic' ? 'manual' : undefined,
      });
    });

    if (columns.length === 0) { UI.toast('至少需要一个列配置','warning'); return; }
    if (!columns.some(c => c.id === 'samples')) {
      UI.toast('列配置中必须包含"对应样品"列','warning');
      return;
    }

    const tpl = {
      id: tplId,
      name, description, builtin: false, enabled: true,
      columns, createdAt: isNew ? new Date().toISOString() : undefined,
    };

    await ExperimentData.saveUserTemplate(tpl);

    UI.hideModal();
    UI.toast(`模板「${name}」已保存`, 'success');
    showSettings();
  }

  /** 复制模板 */
  async function _duplicateTemplate(tplId) {
    let templates = await ExperimentData.getUserTemplates();
    const allData = await ExperimentData.getAllTemplates();
    let src = templates.find(t => t.id === tplId);
    // 如果是内置模板，从 builtin 复制
    if (!src && tplId === 'system_default') {
      src = allData.builtin;
    }
    if (!src) { UI.toast('模板不存在','error'); return; }
    const copy = ExperimentData.cloneTemplate(src);
    templates.push(copy);
    await ExperimentData.saveUserTemplates(templates);
    UI.toast('模板已复制', 'success');
    showSettings();
  }

  /** 设为首选模板 */
  async function _setDefaultTemplate(tplId) {
    await ExperimentData.saveUserDefaultTemplateId(tplId);
    UI.toast('首选模板已更新', 'success');
    showSettings();
  }

  /** 删除模板（仅限自定义模板） */
  async function _deleteTemplate(tplId) {
    if (tplId === 'system_default') {
      UI.toast('系统内置模板不可删除', 'warning');
      return;
    }
    const templates = await ExperimentData.getUserTemplates();
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return;
    UI.confirm('删除模板', `确定要删除模板「${tpl.name}」吗？`, async () => {
      await ExperimentData.deleteUserTemplate(tplId);
      UI.toast('模板已删除', 'success');
      showSettings();
    });
  }

  /** 添加列 */
  function _addTemplateColumn() {
    const container = document.getElementById('tpl-columns-container');
    if (!container) return;
    const i = container.children.length;
    const div = document.createElement('div');
    div.className = 'tpl-column-row';
    div.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px;border:1px solid var(--color-border-light);border-radius:6px;margin-bottom:6px;background:var(--color-bg-primary)';
    div.innerHTML = `
      <span style="cursor:grab;color:var(--color-text-tertiary)">⠿</span>
      <input class="form-input" data-edit="label" placeholder="列名" style="width:80px">
      <select class="form-input" data-edit="type" style="width:90px">
        <option value="text">文本</option>
        <option value="number" selected>数值</option>
        <option value="computed">自动计算</option>
        <option value="dynamic">动态模式</option>
      </select>
      <input class="form-input tpl-unit-input" data-edit="unit" placeholder="单位" style="width:50px">
      <input class="form-input tpl-formula-input" data-edit="formula" placeholder="公式" style="flex:1;display:none">
      <input class="form-input" data-edit="width" value="80px" placeholder="宽度" style="width:70px">
      <button class="btn btn-sm btn-danger" onclick="App._removeTemplateColumn(${i},this)">✕</button>
    `;
    div.querySelector('[data-edit="type"]').onchange = function() { App._onColumnEditTypeChange(this, i); };
    container.appendChild(div);
  }

  /** 删除列 */
  function _removeTemplateColumn(index, btn) {
    const row = btn.closest('.tpl-column-row');
    if (row) row.remove();
  }

  /** 列类型切换时显示/隐藏单位/公式字段 */
  function _onColumnEditTypeChange(select, index) {
    const row = select.closest('.tpl-column-row');
    const unitInput = row.querySelector('.tpl-unit-input');
    const formulaInput = row.querySelector('.tpl-formula-input');
    const type = select.value;
    unitInput.style.display = type === 'number' ? '' : 'none';
    const formulaDescInput = row.querySelector('.tpl-formula-desc-input');
    formulaInput.style.display = type === 'computed' ? '' : 'none';
    if (formulaDescInput) formulaDescInput.style.display = type === 'computed' ? '' : 'none';
  }

  /** 重置为默认（清空用户自定义模板，恢复系统内置为首选） */
  async function _resetDefaultTemplates() {
    UI.confirm('恢复到默认', '此操作将清空全部用户自定义模板，仅保留系统内置标准模板。确定继续？', async () => {
      await ExperimentData.saveUserTemplates([]);
      await ExperimentData.saveUserDefaultTemplateId('system_default');
      UI.toast('已恢复至系统内置标准模板', 'success');
      showSettings();
    });
  }

  /** AI生成公式弹窗 */
  function _showAIGenerateFormulaDialog(tplId) {
    const body = `
      <div>
        <p style="color:var(--color-text-secondary);margin-bottom:16px;font-size:14px">
          AI 将根据您的描述生成列计算公式。支持两种输入方式：
        </p>
        <div class="form-group" style="margin-bottom:16px">
          <label class="form-label">方式A：文字描述计算逻辑</label>
          <textarea class="form-input" id="ai-formula-desc" rows="3"
            placeholder="例如：计算本行总重，等于SPC+GMO+NMP+水+EtOH+DOPG-Na之和"
            style="width:100%;box-sizing:border-box;resize:vertical"></textarea>
        </div>
        <div style="text-align:center;margin:12px 0;color:var(--color-text-tertiary);font-size:13px">—— 或 ——</div>
        <div class="form-group" style="margin-bottom:16px">
          <label class="form-label">方式B：上传文档/图片（后续版本支持）</label>
          <div style="padding:20px;border:2px dashed var(--color-border);border-radius:8px;text-align:center;
                color:var(--color-text-tertiary);font-size:13px">
            📄 文件上传功能开发中
          </div>
        </div>
        <div id="ai-formula-result" style="display:none;margin-top:12px;padding:12px;
              background:var(--color-bg-tertiary);border-radius:8px">
          <label class="form-label">AI 生成的公式预览</label>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
            <code id="ai-formula-output" style="flex:1;padding:8px;background:var(--color-bg-primary);
                  border:1px solid var(--color-border);border-radius:4px;font-size:14px"></code>
            <button class="btn btn-sm btn-primary" onclick="App._applyGeneratedFormulaToEditor()">应用</button>
          </div>
        </div>
        <button class="btn btn-primary" id="ai-generate-btn" onclick="App._callAIGenerateFormula()"
                style="margin-top:12px;width:100%">🤖 生成公式</button>
      </div>
    `;
    const footer = `<button class="btn btn-secondary" onclick="App._showFormulaVariableHints()">变量参考</button><button class="btn btn-secondary" onclick="UI.hideModal()">关闭</button>`;
    UI.showModal('AI 生成公式', body, footer);
  }

  /** 调用 AI 生成公式（使用已有 API 配置） */
  async function _callAIGenerateFormula() {
    const desc = document.getElementById('ai-formula-desc').value.trim();
    if (!desc) { UI.toast('请输入计算公式的文字描述','warning'); return; }

    const btn = document.getElementById('ai-generate-btn');
    btn.disabled = true; btn.textContent = '生成中...';

    try {
      // 使用现有 AI API 代理端点
      const res = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: 'https://api.modelbest.co/v1/chat/completions',
          headers: { 'Authorization': 'Bearer sk-demo' },
          body: {
            model: 'minicpm-v4.6',
            messages: [
              { role: 'system', content: '你是一个实验配方计算公式生成器。根据用户描述，生成一个 JavaScript 可执行的公式表达式。'
                + '公式中引用表格中其他列的 ID 作为变量。只返回公式本身，不要加任何解释。'
                + '变量列表: spc(g), gmo(g), nmp(g), water(g), etoh(g), dopg(g), rowTotal(g), drugAmount(mg), density(g/ml), drugConc(mg/ml), takeVolume(μL)。'
                + '支持四则运算 + - * / 和括号 ()。单位换算乘除1000直接写在公式中。' },
              { role: 'user', content: desc }
            ],
            max_tokens: 200
          }
        })
      });

      const data = await res.json();
      let formula = '';
      if (data.choices && data.choices[0]) {
        formula = data.choices[0].message.content.trim();
        // 清理可能的代码块标记
        formula = formula.replace(/```/g, '').replace(/javascript/g, '').trim();
      } else {
        // 兜底：简单的关键词匹配
        if (desc.includes('总重') || desc.includes('求和') || desc.includes('之和')) {
          formula = 'spc+gmo+nmp+water+etoh+dopg';
        } else if (desc.includes('浓度') || desc.includes('药量')) {
          formula = 'drugAmount / (rowTotal + drugAmount / 1000)';
        }
      }

      if (formula) {
        document.getElementById('ai-formula-output').textContent = formula;
        document.getElementById('ai-formula-result').style.display = 'block';
        UI.toast('公式生成成功，点击"应用"使用', 'success');
      } else {
        UI.toast('AI 未能生成有效公式，请重试', 'warning');
      }
    } catch (err) {
      // AI 不可用时使用规则匹配
      let formula = '';
      if (desc.includes('总重') || desc.includes('求和') || desc.includes('之和')) {
        formula = 'spc+gmo+nmp+water+etoh+dopg';
      } else if (desc.includes('浓度') || desc.includes('载药')) {
        formula = 'drugAmount/(rowTotal*1000+drugAmount)*density*1000';
      } else if (desc.includes('实验药量')) {
        formula = 'drugConc*takeVolume/1000';
      } else {
        UI.toast('AI 服务不可用，请稍后重试', 'warning');
        btn.disabled = false; btn.textContent = '🤖 生成公式';
        return;
      }
      document.getElementById('ai-formula-output').textContent = formula;
      document.getElementById('ai-formula-result').style.display = 'block';
      UI.toast('已通过规则匹配生成公式', 'info');
    }

    btn.disabled = false; btn.textContent = '🤖 生成公式';
  }

  /** 将 AI 生成的公式应用到编辑器 */
  function _applyGeneratedFormulaToEditor() {
    const formula = document.getElementById('ai-formula-output').textContent;
    if (!formula) return;
    // 尝试找到当前打开的列编辑器中的 formula 输入框并填入
    const firstFormulaInput = document.querySelector('.tpl-formula-input:not([style*="display: none"])');
    if (firstFormulaInput) {
      firstFormulaInput.value = formula;
    }
    UI.hideModal();
    UI.toast('公式已应用到当前列', 'success');
  }

  /** 模板表格预览弹窗（使用内置模板） */
  function _showTemplatePreview(tplId) {
    const builtin = ExperimentData.getBuiltinTemplate();
    const columns = builtin.columns;
    // 构建简化版表头
    let tableHtml = '<table class="data-table" style="font-size:12px"><thead><tr>';
    columns.forEach(col => {
      let label = col.label;
      if (col.unit) label += `<sub style="font-size:10px;color:#8c94a6">(${col.unit})</sub>`;
      if (col.type === 'computed') label += ' <span style="color:#0d7377;font-size:10px">⚡</span>';
      tableHtml += `<th style="padding:6px 4px;white-space:nowrap">${label}</th>`;
    });
    tableHtml += '</tr></thead><tbody><tr>';
    columns.forEach(col => {
      if (col.type === 'text' || col.type === 'samples') {
        tableHtml += '<td style="padding:4px"><input style="width:60px;padding:3px;border:1px solid #d8dce6;border-radius:3px;font-size:11px" disabled></td>';
      } else if (col.type === 'number') {
        tableHtml += '<td style="padding:4px"><input type="number" style="width:60px;padding:3px;border:1px solid #d8dce6;border-radius:3px;font-size:11px" disabled></td>';
      } else if (col.type === 'computed') {
        tableHtml += '<td style="padding:4px;text-align:center"><span style="padding:3px 8px;background:#f0f4f8;border-radius:3px;font-size:11px;color:#0d7377;font-weight:600">0.00</span></td>';
      }
    });
    tableHtml += '</tr></tbody></table>';
    tableHtml += '<div style="margin-top:8px;font-size:11px;color:#8c94a6">预览仅展示标准14列布局。保存后可在创建实验组时选择此模板查看完整交互效果。</div>';
    UI.showModal('模板表格预览', tableHtml, '<button class="btn btn-secondary" onclick="UI.hideModal()">关闭</button>');
  }

  /** 公式变量提示列表 */
  function _showFormulaVariableHints() {
    const body = `
      <div style="font-size:13px;line-height:2">
        <p style="color:var(--color-text-secondary);margin-bottom:8px">可用变量列表（点击变量名复制到剪贴板）：</p>
        <table class="data-table" style="box-shadow:none;font-size:12px">
          <thead><tr><th>变量名</th><th>含义</th><th>单位</th></tr></thead>
          <tbody>
            <tr onclick="navigator.clipboard.writeText('spc')" style="cursor:pointer" title="点击复制">
              <td><code style="color:#0d7377">spc</code></td><td>SPC 用量</td><td>g</td>
            </tr>
            <tr onclick="navigator.clipboard.writeText('gmo')" style="cursor:pointer">
              <td><code style="color:#0d7377">gmo</code></td><td>GMO 用量</td><td>g</td>
            </tr>
            <tr onclick="navigator.clipboard.writeText('nmp')" style="cursor:pointer">
              <td><code style="color:#0d7377">nmp</code></td><td>NMP 用量</td><td>g</td>
            </tr>
            <tr onclick="navigator.clipboard.writeText('water')" style="cursor:pointer">
              <td><code style="color:#0d7377">water</code></td><td>水用量</td><td>g</td>
            </tr>
            <tr onclick="navigator.clipboard.writeText('etoh')" style="cursor:pointer">
              <td><code style="color:#0d7377">etoh</code></td><td>EtOH 用量</td><td>g</td>
            </tr>
            <tr onclick="navigator.clipboard.writeText('dopg')" style="cursor:pointer">
              <td><code style="color:#0d7377">dopg</code></td><td>DOPG-Na 用量</td><td>g</td>
            </tr>
            <tr onclick="navigator.clipboard.writeText('rowTotal')" style="cursor:pointer">
              <td><code style="color:#0d7377">rowTotal</code></td><td>本行总重</td><td>g</td>
            </tr>
            <tr onclick="navigator.clipboard.writeText('drugAmount')" style="cursor:pointer">
              <td><code style="color:#0d7377">drugAmount</code></td><td>本行加入药量</td><td>mg</td>
            </tr>
            <tr onclick="navigator.clipboard.writeText('density')" style="cursor:pointer">
              <td><code style="color:#0d7377">density</code></td><td>密度</td><td>g/ml</td>
            </tr>
            <tr onclick="navigator.clipboard.writeText('drugConc')" style="cursor:pointer">
              <td><code style="color:#0d7377">drugConc</code></td><td>本行载药浓度</td><td>mg/ml</td>
            </tr>
            <tr onclick="navigator.clipboard.writeText('takeVolume')" style="cursor:pointer">
              <td><code style="color:#0d7377">takeVolume</code></td><td>取用体积</td><td>μL</td>
            </tr>
          </tbody>
        </table>
        <p style="color:var(--color-text-tertiary);font-size:11px;margin-top:8px">点击变量名自动复制，可在公式输入框粘贴使用。支持四则运算 + - * / 和括号 ()。</p>
      </div>`;
    UI.showModal('公式变量参考', body, '<button class="btn btn-secondary" onclick="UI.hideModal()">关闭</button>');
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
    // 全局未捕获 Promise 异常处理（防止单个函数崩溃阻塞整个页面）
    window.addEventListener('unhandledrejection', (event) => {
      console.error('[Global] 未捕获的 Promise 异常:', event.reason?.message || event.reason);
      event.preventDefault();
    });

    // 全局未捕获异常处理
    window.addEventListener('error', (event) => {
      console.error('[Global] 未捕获的异常:', event.message, 'at', event.filename + ':' + event.lineno);
      // 如果是 JS 函数不存在等致命错误，尝试恢复显示登录页
      if (event.message && (
        event.message.includes('is not a function') ||
        event.message.includes('is not defined') ||
        event.message.includes('Cannot read properties')
      )) {
        try {
          const container = document.getElementById('login-form-container');
          if (container && !container.hasChildNodes()) {
            safeShowLoginScreen();
          }
        } catch (e) {}
      }
    });

    // 异步启动（确保任何未捕获错误不会阻塞页面）
    init().catch(err => {
      console.error('[Fasudil-LLC] 启动异常 (catch):', err.message);
      // 终极兜底
      try { safeShowLoginScreen(); } catch (e) {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif"><p style="color:#e74c3c">系统加载失败，请刷新页面</p></div>';
      }
    });
  });

  return {
    logout,
    navigate,
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
    exportZip,
    // 模板管理
    showCreateTemplateDialog,
    _editTemplate,
    _duplicateTemplate,
    _setDefaultTemplate,
    _deleteTemplate,
    _addTemplateColumn,
    _removeTemplateColumn,
    _onColumnEditTypeChange,
    _resetDefaultTemplates,
    _showAIGenerateFormulaDialog,
    _callAIGenerateFormula,
    _applyGeneratedFormulaToEditor,
    _showTemplatePreview,
    _previewBuiltinTemplate,
    _showTemplatePreviewInner,
    _showFormulaVariableHints
  };
})();
