/* ========================================
   ui.js — UI 组件库
   通用 UI 组件：Toast、模态框、表格、表单等
   ======================================== */

const UI = (() => {

  // --- Toast ---
  function toast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'toast-in 0.3s reverse ease-in';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  // --- 模态框 ---
  function showModal(title, bodyHtml, footerHtml = '') {
    const overlay = document.getElementById('modal-overlay');
    const container = document.getElementById('modal-container');

    if (!overlay || !container) {
      console.error('模态框元素未找到');
      return null;
    }

    container.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">${title}</span>
        <button class="modal-close" onclick="UI.hideModal()">&times;</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
    `;

    // 使用 classList 控制显示/隐藏（与 CSS .hidden 类配合）
    overlay.classList.remove('hidden');
    return container;
  }

  function hideModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }

  // --- 确认对话框 ---
  function confirm(title, message, onConfirm) {
    const body = `<p style="color:var(--color-text-secondary);line-height:1.8">${message}</p>`;
    const footer = `
      <button class="btn btn-secondary" onclick="UI.hideModal()">取消</button>
      <button class="btn btn-danger" id="modal-confirm-btn">确认</button>
    `;
    showModal(title, body, footer);
    document.getElementById('modal-confirm-btn').onclick = () => {
      hideModal();
      onConfirm();
    };
  }

  // --- 数据表格 ---
  function renderTable(headers, rows, options = {}) {
    const { onRowClick, emptyText = '暂无数据' } = options;

    if (rows.length === 0) {
      return `<div class="empty-state">
        <p class="empty-state-title">${emptyText}</p>
      </div>`;
    }

    let html = '<table class="data-table"><thead><tr>';
    for (const h of headers) {
      html += `<th>${h}</th>`;
    }
    html += '</tr></thead><tbody>';

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const clickAttr = onRowClick ? `onclick="(${onRowClick})(${i})" style="cursor:pointer"` : '';
      html += `<tr ${clickAttr}>`;
      for (const h of headers) {
        const val = row[h] !== undefined ? row[h] : '';
        html += `<td>${formatCell(val)}</td>`;
      }
      html += '</tr>';
    }

    html += '</tbody></table>';
    return html;
  }

  function formatCell(val) {
    if (typeof val === 'number') {
      // 数字保留适当位数
      if (Number.isInteger(val)) return val.toString();
      return val.toFixed(2);
    }
    if (Array.isArray(val)) {
      return val.map(v => `<span class="tag tag-default">${v}</span>`).join(' ');
    }
    if (val === null || val === undefined || val === '') return '<span style="color:var(--color-text-tertiary)">—</span>';
    return val.toString();
  }

  // --- Tab 页 ---
  function renderTabs(tabs, defaultTab = 0) {
    let html = '<div class="tab-bar">';
    for (let i = 0; i < tabs.length; i++) {
      const active = i === defaultTab ? 'active' : '';
      html += `<div class="tab-item ${active}" data-tab="${i}" onclick="UI.switchTab(this, ${i})">${tabs[i].label}</div>`;
    }
    html += '</div>';

    for (let i = 0; i < tabs.length; i++) {
      const active = i === defaultTab ? 'active' : '';
      html += `<div class="tab-content ${active}" data-tab-content="${i}">${tabs[i].content}</div>`;
    }

    return html;
  }

  function switchTab(el, index) {
    const tabBar = el.parentElement;
    const tabItems = tabBar.querySelectorAll('.tab-item');
    tabItems.forEach(item => item.classList.remove('active'));
    el.classList.add('active');

    const container = tabBar.parentElement;
    const contents = container.querySelectorAll('.tab-content');
    contents.forEach(content => content.classList.remove('active'));
    contents[index].classList.add('active');
  }

  // --- 统计卡片 ---
  function renderStatCards(stats) {
    let html = '<div class="stats-grid">';
    for (const stat of stats) {
      const changeClass = stat.change > 0 ? 'up' : stat.change < 0 ? 'down' : '';
      const changeText = stat.change !== undefined ?
        (stat.change > 0 ? `+${stat.change}%` : stat.change < 0 ? `${stat.change}%` : '0%') : '';

      html += `<div class="stat-card">
        <div class="stat-label">${stat.label}</div>
        <div class="stat-value">${stat.value}</div>
        ${changeText ? `<div class="stat-change ${changeClass}">${changeText}</div>` : ''}
      </div>`;
    }
    html += '</div>';
    return html;
  }

  // --- 文件上传区 ---
  function renderUploadZone(options = {}) {
    const { accept = '*', multiple = true, id = 'upload-zone' } = options;
    return `<div class="upload-zone" id="${id}"
      onclick="document.getElementById('${id}-input').click()"
      ondragover="event.preventDefault();this.classList.add('dragover')"
      ondragleave="this.classList.remove('dragover')"
      ondrop="event.preventDefault();this.classList.remove('dragover');App.upload.handleDrop(event)">
      <div class="upload-zone-icon">
        <svg width="40" height="40" viewBox="0 0 18 18" fill="none">
          <path d="M9 2v10M5 6l4-4 4 4M2 14h14" stroke="#8c94a6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="upload-zone-text">点击或拖拽文件到此区域</div>
      <div class="upload-zone-hint">支持 xlsx、csv、pdf、docx、pzfx、图片、JSON</div>
      <input type="file" id="${id}-input" accept="${accept}" multiple="${multiple}" style="display:none"
        onchange="App.upload.handleFiles(this.files)">
    </div>`;
  }

  // --- 预警卡片 ---
  function renderAlerts(alerts) {
    if (alerts.length === 0) return '';
    let html = '';
    for (const alert of alerts) {
      html += `<div class="alert-card alert-${alert.severity || 'info'}">${alert.icon || ''} ${alert.message}</div>`;
    }
    return html;
  }

  // --- 图片画廊 ---
  function renderImageGallery(images, expId) {
    if (images.length === 0) {
      return '<div class="empty-state"><p class="empty-state-desc">暂无图片</p></div>';
    }

    let html = '<div class="image-gallery">';
    for (const img of images) {
      html += `<div class="gallery-item" onclick="App.viewImage('${expId}', '${img.filename}')">
        <img class="gallery-thumb" src="" data-exp="${expId}" data-thumb="${img.filename}_thumb.jpg" data-original="${img.filename}" alt="${img.description || img.filename}">
        <div class="gallery-label">${img.type} · ${img.description || img.filename}</div>
      </div>`;
    }
    html += '</div>';
    return html;
  }

  // --- 时间线 ---
  function renderTimeline(items) {
    if (items.length === 0) return '<p style="color:var(--color-text-tertiary)">暂无活动</p>';
    let html = '<ul class="timeline">';
    for (const item of items) {
      html += `<li class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-time">${item.time}</div>
          <div class="timeline-text">${item.text}</div>
        </div>
      </li>`;
    }
    html += '</ul>';
    return html;
  }

  // --- 弹窗式输入框（替代 window.prompt） ---
  function prompt(title, defaultValue = '', onConfirm) {
    const body = `
      <div class="prompt-dialog">
        <p style="color:var(--color-text-secondary);margin-bottom:12px;font-size:14px">${title}</p>
        <input class="form-input" id="prompt-input" value="${defaultValue}" autofocus style="width:100%;box-sizing:border-box">
      </div>
    `;
    const footer = `
      <button class="btn btn-secondary" onclick="UI.hideModal()">取消</button>
      <button class="btn btn-primary" id="prompt-confirm-btn">确认</button>
    `;
    showModal('输入', body, footer);
    const input = document.getElementById('prompt-input');
    input.focus();
    input.select();
    input.onkeydown = (e) => {
      if (e.key === 'Enter') document.getElementById('prompt-confirm-btn').click();
    };
    document.getElementById('prompt-confirm-btn').onclick = () => {
      const val = document.getElementById('prompt-input').value;
      hideModal();
      if (onConfirm) onConfirm(val);
    };
  }

  // --- 弹窗式提示（替代 window.alert） ---
  function alert(title, message, onClose) {
    const body = `<p style="color:var(--color-text-secondary);line-height:1.8;font-size:14px">${message}</p>`;
    const footer = `<button class="btn btn-primary" id="alert-close-btn">确定</button>`;
    showModal(title, body, footer);
    document.getElementById('alert-close-btn').onclick = () => {
      hideModal();
      if (onClose) onClose();
    };
  }

  // --- 公式校验结果弹窗 ---
  function showFormulaValidation(result) {
    const icon = result.valid ? '✅' : '❌';
    const body = `
      <div class="formula-validation-dialog">
        <div style="text-align:center;font-size:32px;margin-bottom:12px">${icon}</div>
        ${result.valid
          ? `<p style="color:var(--color-success);text-align:center">公式语法检查通过</p>
             <p style="color:var(--color-text-secondary);text-align:center;margin-top:8px">
               预览结果: <strong style="color:var(--color-text-primary)">${result.preview}</strong>
             </p>`
          : `<p style="color:var(--color-danger);text-align:center">公式语法错误</p>
             <p style="color:var(--color-text-secondary);text-align:center;margin-top:8px">${result.error}</p>`
        }
      </div>
    `;
    const footer = `<button class="btn btn-primary" onclick="UI.hideModal()">确定</button>`;
    showModal('公式校验', body, footer);
  }

  // --- 内部日期选择器（替代浏览器原生 date picker） ---
  // 状态管理
  const _datePicker = {
    currentYear: 0,
    currentMonth: 0,
    selectedDate: '',
    onSelect: null,
  };

  /** 渲染日期选择器面板 */
  function renderDatePicker(inputId, currentValue, onSelect) {
    const now = currentValue ? new Date(currentValue) : new Date();
    _datePicker.currentYear = now.getFullYear();
    _datePicker.currentMonth = now.getMonth();
    _datePicker.selectedDate = currentValue;
    _datePicker.onSelect = onSelect;

    const input = document.getElementById(inputId);
    if (!input) return;

    // 创建面板（如果不存在）
    let panel = document.getElementById('date-picker-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'date-picker-panel';
      panel.className = 'date-picker-panel';
      document.body.appendChild(panel);
    }

    // 点击 input 时切换面板
    input.onclick = (e) => {
      e.stopPropagation();
      const rect = input.getBoundingClientRect();
      panel.style.top = (rect.bottom + 4) + 'px';
      panel.style.left = rect.left + 'px';
      panel.classList.toggle('visible');
      _renderDateGrid(panel);
    };

    // 点击外部关闭
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== input) {
        panel.classList.remove('visible');
      }
    });

    // 初始渲染
    _renderDateGrid(panel);
  }

  /** 渲染日期网格 */
  function _renderDateGrid(panel) {
    const { currentYear, currentMonth, selectedDate } = _datePicker;

    const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();

    let html = `
      <div class="date-picker-header">
        <button class="date-nav-btn" onclick="UI._dateNav(-1)">‹</button>
        <span class="date-nav-label">${currentYear}年 ${monthNames[currentMonth]}</span>
        <button class="date-nav-btn" onclick="UI._dateNav(1)">›</button>
      </div>
      <table class="date-grid">
        <thead><tr><th>日</th><th>一</th><th>二</th><th>三</th><th>四</th><th>五</th><th>六</th></tr></thead>
        <tbody>
    `;

    let day = 1;
    for (let row = 0; row < 6; row++) {
      if (day > daysInMonth) break;
      html += '<tr>';
      for (let col = 0; col < 7; col++) {
        if ((row === 0 && col < firstDay) || day > daysInMonth) {
          html += '<td class="date-empty"></td>';
        } else {
          const dateStr = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          const isToday = dateStr === new Date().toISOString().slice(0, 10);
          const isSelected = dateStr === selectedDate;
          html += `<td class="${isToday?'date-today':''} ${isSelected?'date-selected':''}"
                    onclick="UI._dateSelect('${dateStr}')">${day}</td>`;
          day++;
        }
      }
      html += '</tr>';
    }

    html += '</tbody></table>';
    panel.innerHTML = html;
  }

  /** 日期导航 */
  function _dateNav(delta) {
    _datePicker.currentMonth += delta;
    if (_datePicker.currentMonth > 11) { _datePicker.currentMonth = 0; _datePicker.currentYear++; }
    if (_datePicker.currentMonth < 0) { _datePicker.currentMonth = 11; _datePicker.currentYear--; }
    const panel = document.getElementById('date-picker-panel');
    if (panel) _renderDateGrid(panel);
  }

  /** 选择日期 */
  function _dateSelect(dateStr) {
    _datePicker.selectedDate = dateStr;
    if (_datePicker.onSelect) _datePicker.onSelect(dateStr);
    const panel = document.getElementById('date-picker-panel');
    if (panel) {
      panel.classList.remove('visible');
      _renderDateGrid(panel);
    }
  }

  /** 清理日期选择器 */
  function destroyDatePicker() {
    const panel = document.getElementById('date-picker-panel');
    if (panel) panel.remove();
  }

  // ============================================================
  // 登录表单渲染（邮箱 + OTP 验证码登录）
  // ============================================================

  /**
   * 渲染登录表单到指定容器
   * @param {HTMLElement} container - #login-form-container 元素
   */
  function renderLoginForm(container) {
    container.innerHTML = `
      <div class="login-field">
        <label for="login-email">邮箱地址</label>
        <input type="email" class="form-input" id="login-email"
          placeholder="请输入您的邮箱" autocomplete="email" autofocus>
      </div>

      <div class="login-field">
        <label for="login-otp">验证码</label>
        <div class="login-input-group">
          <input type="text" class="form-input" id="login-otp"
            placeholder="输入 6 位验证码" maxlength="6" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code">
          <button class="btn btn-secondary" id="login-send-otp-btn" type="button">发送验证码</button>
        </div>
      </div>

      <button class="btn btn-primary login-btn" id="login-submit-btn" type="button">
        <span id="login-btn-text">登 录</span>
        <span id="login-btn-spinner" class="spinner" style="display:none;width:16px;height:16px;border-width:2px;margin:0 auto"></span>
      </button>

      <div id="login-error-msg" class="login-error"></div>
      <div class="login-hint">验证码将发送至您的邮箱，有效期 5 分钟</div>
    `;

    // --- 状态变量 ---
    let email = '';
    let countdown = 0;
    let countdownTimer = null;

    const emailInput = container.querySelector('#login-email');
    const otpInput = container.querySelector('#login-otp');
    const sendBtn = container.querySelector('#login-send-otp-btn');
    const submitBtn = container.querySelector('#login-submit-btn');
    const errorEl = container.querySelector('#login-error-msg');
    const btnText = container.querySelector('#login-btn-text');
    const btnSpinner = container.querySelector('#login-btn-spinner');

    // --- 工具函数 ---

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.classList.add('visible');
    }

    function hideError() {
      errorEl.classList.remove('visible');
      errorEl.textContent = '';
    }

    function setLoading(loading) {
      if (loading) {
        btnText.style.display = 'none';
        btnSpinner.style.display = 'block';
        submitBtn.disabled = true;
      } else {
        btnText.style.display = 'inline';
        btnSpinner.style.display = 'none';
        submitBtn.disabled = false;
      }
    }

    function startCountdown(seconds) {
      countdown = seconds;
      sendBtn.disabled = true;
      if (countdownTimer) clearInterval(countdownTimer);
      countdownTimer = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
          clearInterval(countdownTimer);
          countdownTimer = null;
          sendBtn.disabled = false;
          sendBtn.textContent = '重新发送';
        } else {
          sendBtn.textContent = `${countdown}s 后重发`;
        }
      }, 1000);
    }

    // --- 发送验证码 ---

    sendBtn.addEventListener('click', async () => {
      hideError();
      const val = emailInput.value.trim();
      if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        showError('请输入有效的邮箱地址');
        emailInput.focus();
        return;
      }
      email = val;

      sendBtn.disabled = true;
      sendBtn.textContent = '发送中...';

      try {
        const res = await fetch('/api/auth/otp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          startCountdown(60);
          otpInput.focus();
        } else {
          sendBtn.disabled = false;
          sendBtn.textContent = '重新发送';
          showError(data.error || '验证码发送失败，请稍后重试');
        }
      } catch (err) {
        sendBtn.disabled = false;
        sendBtn.textContent = '重新发送';
        showError('网络错误，请检查连接后重试');
      }
    });

    // --- 登录（验证 OTP） ---

    submitBtn.addEventListener('click', async () => {
      hideError();
      const e = emailInput.value.trim();
      const otp = otpInput.value.trim();

      if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        showError('请输入有效的邮箱地址');
        emailInput.focus();
        return;
      }
      if (!otp || otp.length < 4) {
        showError('请输入验证码');
        otpInput.focus();
        return;
      }
      email = e;

      setLoading(true);
      try {
        const res = await fetch('/api/auth/otp/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          body: JSON.stringify({ email, otp })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          // ==== 登录成功：持久化凭证 + 硬跳转 ====
          // 1. 保存用户信息到 localStorage（供 init() 快速判断登录状态）
          try {
            if (data.user) {
              localStorage.setItem('auth_user', JSON.stringify(data.user));
            }
          } catch (e) {
            console.warn('[Login] localStorage 写入失败:', e.message);
          }
          // 2. 登录状态标识
          try {
            sessionStorage.setItem('logged_in', '1');
          } catch (e) {}

          console.log('[Login] OTP 验证成功，用户:', data.user?.email);

          // 3. 硬跳转首页（比 window.location.reload() 更可靠）
          //    浏览器会携带 HttpOnly auth_token cookie，init() 通过
          //    localStorage auth_user 判断 + /api/auth/me 验证进入主应用
          window.location.href = '/';
        } else {
          setLoading(false);
          showError(data.error || '验证失败，请检查验证码');
        }
      } catch (err) {
        console.error('[Login] OTP 验证请求异常:', err.message);
        setLoading(false);
        showError('网络错误，请检查连接后重试');
      }
    });

    // 回车键快捷操作
    otpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitBtn.click();
    });
    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendBtn.click();
    });

    // 自动聚焦邮箱
    setTimeout(() => emailInput.focus(), 100);
  }

  // --- 空状态 ---
  function renderEmptyState(title, desc, actionLabel, actionFn) {
    return `<div class="empty-state">
      <div class="empty-state-icon">
        <svg width="48" height="48" viewBox="0 0 18 18" fill="none">
          <rect x="3" y="3" width="12" height="12" rx="2" stroke="#8c94a6" stroke-width="1.5"/>
          <path d="M6 8h6M6 11h3" stroke="#8c94a6" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </div>
      <p class="empty-state-title">${title}</p>
      <p class="empty-state-desc">${desc}</p>
      ${actionLabel ? `<button class="btn btn-primary" onclick="${actionFn}">${actionLabel}</button>` : ''}
    </div>`;
  }

  return {
    toast,
    showModal,
    hideModal,
    confirm,
    prompt,
    alert,
    showFormulaValidation,
    renderDatePicker,
    destroyDatePicker,
    _dateNav,
    _dateSelect,
    renderTable,
    renderTabs,
    switchTab,
    renderStatCards,
    renderUploadZone,
    renderAlerts,
    renderImageGallery,
    renderTimeline,
    renderEmptyState,
    renderLoginForm,
    formatCell
  };
})();
