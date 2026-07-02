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

  /** 渲染登录表单（EdgeOne 版 OTP 登录） */
  function renderLoginForm(container) {
    container.innerHTML = `
      <div class="login-form-group">
        <label for="login-email">邮箱地址</label>
        <input type="email" id="login-email" placeholder="请输入您的邮箱" autocomplete="email" autofocus>
      </div>
      <div class="login-form-group">
        <label for="login-otp">验证码</label>
        <div class="login-otp-row">
          <input type="text" id="login-otp" class="login-otp-input" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
          <button id="btn-send-otp" class="btn btn-secondary">发送验证码</button>
        </div>
      </div>
      <button id="btn-login" class="btn btn-primary login-btn" disabled>登录</button>
      <div id="login-message" class="login-message" style="display:none"></div>
      <div class="login-footer">
        验证码将发送到您的邮箱，有效期 10 分钟
      </div>
    `;

    // 绑定事件
    const emailInput = document.getElementById('login-email');
    const otpInput = document.getElementById('login-otp');
    const sendBtn = document.getElementById('btn-send-otp');
    const loginBtn = document.getElementById('btn-login');
    const msgEl = document.getElementById('login-message');

    let sendingOtp = false;
    let verifyingOtp = false;
    let cooldownTimer = null;
    let cooldownSeconds = 0;

    // 邮箱校验
    function isValidEmail(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    // 显示消息
    function showMessage(text, type) {
      msgEl.style.display = 'block';
      msgEl.className = `login-message ${type}`;
      msgEl.textContent = text;
    }

    function clearMessage() {
      msgEl.style.display = 'none';
    }

    // 更新登录按钮状态
    function updateLoginBtn() {
      loginBtn.disabled = verifyingOtp || !otpInput.value || otpInput.value.length < 6;
    }

    // 发送验证码
    sendBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      if (!isValidEmail(email)) {
        showMessage('请输入有效的邮箱地址', 'error');
        emailInput.focus();
        return;
      }

      if (sendingOtp) return;
      sendingOtp = true;
      sendBtn.disabled = true;
      sendBtn.textContent = '发送中...';
      clearMessage();

      try {
        const res = await fetch('/api/auth/otp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
          showMessage(data.message || '验证码已发送，请查收邮件', 'success');
          startCooldown();
        } else {
          showMessage(data.error || '发送失败', 'error');
          sendBtn.disabled = false;
          sendBtn.textContent = '发送验证码';
        }
      } catch (err) {
        showMessage('网络错误，请重试', 'error');
        sendBtn.disabled = false;
        sendBtn.textContent = '发送验证码';
      } finally {
        sendingOtp = false;
      }
    });

    // 60秒倒计时
    function startCooldown() {
      cooldownSeconds = 60;
      sendBtn.disabled = true;
      sendBtn.textContent = `${cooldownSeconds}s 后重新发送`;
      cooldownTimer = setInterval(() => {
        cooldownSeconds--;
        if (cooldownSeconds <= 0) {
          clearInterval(cooldownTimer);
          sendBtn.disabled = false;
          sendBtn.textContent = '发送验证码';
        } else {
          sendBtn.textContent = `${cooldownSeconds}s 后重新发送`;
        }
      }, 1000);
    }

    // OTP 输入校验
    otpInput.addEventListener('input', () => {
      otpInput.value = otpInput.value.replace(/\D/g, '').slice(0, 6);
      updateLoginBtn();
    });

    emailInput.addEventListener('input', () => {
      if (msgEl.style.display !== 'none') clearMessage();
    });

    // 登录
    loginBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      const otp = otpInput.value.trim();

      if (!isValidEmail(email)) {
        showMessage('请输入有效的邮箱地址', 'error');
        return;
      }
      if (otp.length < 6) {
        showMessage('请输入完整的 6 位验证码', 'error');
        return;
      }

      if (verifyingOtp) return;
      verifyingOtp = true;
      loginBtn.disabled = true;
      loginBtn.textContent = '登录中...';
      clearMessage();

      try {
        const res = await fetch('/api/auth/otp/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, otp })
        });
        const data = await res.json();
        if (data.success) {
          showMessage('登录成功，正在跳转...', 'success');
          // 硬跳转，携带 Cookie
          setTimeout(() => { window.location.href = '/'; }, 300);
        } else {
          showMessage(data.error || '验证失败，请重试', 'error');
          loginBtn.disabled = false;
          loginBtn.textContent = '登录';
        }
      } catch (err) {
        showMessage('网络错误，请重试', 'error');
        loginBtn.disabled = false;
        loginBtn.textContent = '登录';
      } finally {
        verifyingOtp = false;
      }
    });

    // Enter 键触发
    otpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !loginBtn.disabled) loginBtn.click();
    });
    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (!sendBtn.disabled) sendBtn.click();
      }
    });
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
    renderTable,
    renderTabs,
    switchTab,
    renderStatCards,
    renderUploadZone,
    renderAlerts,
    renderImageGallery,
    renderTimeline,
    renderLoginForm,
    renderEmptyState,
    formatCell
  };
})();
