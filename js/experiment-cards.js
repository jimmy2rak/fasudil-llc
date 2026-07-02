/* ========================================
   experiment-cards.js
   实验记录卡片视图 — 以卡片形式展示样品数据
   实验级数据隔离，composite DOM ID
   ======================================== */

const ExperimentCards = (() => {
  let currentExperimentId = null;
  let analysisResults = {};

  // ============================================================
  // 自动计算引擎
  // ============================================================
  const CALC = {
    concentration(absVal) {
      return 2 * (absVal - 0.00414128) / 0.0136697;
    },
    cumulativeRelease(concs, totalVol, sampleVol) {
      const result = [];
      for (let i = 0; i < concs.length; i++) {
        let sampleSum = 0;
        for (let j = 0; j < i; j++) sampleSum += concs[j] * sampleVol;
        result.push((concs[i] * totalVol + sampleSum) / 1000);
      }
      return result;
    },
    releaseRate(cumulative, totalDrug) {
      return cumulative.map(c => (c / totalDrug) * 100);
    }
  };

  // ============================================================
  // 主渲染入口
  // ============================================================
  function render(container, meta, experimentId) {
    currentExperimentId = experimentId;
    const exp = experimentId ? ExperimentData.getExperiment(experimentId) : null;
    const samples = exp ? exp.samples : [];
    const groupName = exp ? exp.name : (meta?.name || '实验记录');

    container.innerHTML = '';

    let html = buildPageHeader(groupName, exp);
    html += '<div class="exp-cards-container">';

    for (const sample of samples) {
      html += renderSampleCard(sample);
    }

    html += '</div>';
    container.innerHTML = html;

    setTimeout(() => {
      renderAllCharts(samples);
      restoreReportsUI();
    }, 200);
  }

  // ============================================================
  // 页面头部
  // ============================================================
  function buildPageHeader(name, exp) {
    const sampleCount = exp ? exp.samples.length : 0;
    return `
      <div class="page-header">
        <div>
          <div class="page-title">${name}</div>
          <div class="page-subtitle">${exp ? (exp.date || '') + ' · ' : ''}${sampleCount} 个样品</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-primary" onclick="ExperimentCards.showCreateDialog()">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="vertical-align:middle;margin-right:3px"><path d="M7 1v12M1 7h12" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>
            创建实验组
          </button>
          ${exp ? `
          <button class="btn btn-secondary" onclick="ExperimentCards.showCreateDialog(ExperimentData.getExperiment('${exp.id}'))">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="vertical-align:middle;margin-right:3px"><rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 4.5h5M4.5 7h3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            编辑实验组
          </button>` : ''}
          <button class="btn btn-secondary" onclick="App.navigate('experiments')">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="vertical-align:middle;margin-right:3px"><path d="M9 2L4 7l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            返回列表
          </button>
          <button class="btn btn-primary" onclick="ExperimentCards.analyzeAll()">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="vertical-align:middle;margin-right:3px"><path d="M7 1C4.5 3 2 4.5 2 7.5c0 2.5 2 4.5 5 4.5s5-2 5-4.5c0-3-2.5-4.5-5-6.5z" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M7 5v3M7 9.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            一键分析
          </button>
        </div>
      </div>
    `;
  }

  // ============================================================
  // 渲染单个样品卡片
  // ============================================================
  function renderSampleCard(sample) {
    const expId = currentExperimentId || '';
    const reports = ExperimentData.getReports(expId, sample.id);
    const reportsHtml = reports.length > 0
      ? reports.map((r, i) => `<div class="report-item"><span class="report-name">报告 #${i+1}: ${r.title||'分析报告'}</span><div style="display:flex;gap:6px"><button class="btn btn-sm btn-secondary" onclick="ExperimentCards.queryReport('${expId}','${sample.id}',${i})">查询</button><button class="btn btn-sm btn-danger" onclick="ExperimentCards.deleteReportInline('${expId}','${sample.id}',${i})">删除</button></div></div>`).join('')
      : '<div style="font-size:12px;color:var(--color-text-tertiary);padding:4px 0">暂无保存的报告</div>';

    const domId = (expId + '-' + sample.id).replace(/[^a-zA-Z0-9-]/g, '');

    return `
      <div class="sample-card">
        <div class="sample-card-header">
          <div class="sample-card-title-row">
            <div class="sample-card-badge">${sample.id}</div>
            <div class="sample-card-title">${sample.formulation || '—'}</div>
            <span class="tag tag-teal">总药量 ${sample.totalDrug.toFixed(1)} mg</span>
          </div>
          <div class="sample-card-actions-top">
            <button class="btn btn-sm btn-primary" onclick="ExperimentCards.analyzeSample('${expId}','${sample.id}')">一键分析所有数据</button>
          </div>
        </div>

        <div class="sample-card-body">
          <div class="seg-tabs">
            <button class="seg-tab active" onclick="ExperimentCards.switchSegTab(this, '${domId}')" data-target="seg-release-${domId}">📈 释放曲线</button>
            <button class="seg-tab" onclick="ExperimentCards.switchSegTab(this, '${domId}')" data-target="seg-overview-${domId}">📊 总览</button>
            <button class="seg-tab" onclick="ExperimentCards.switchSegTab(this, '${domId}')" data-target="seg-formulation-${domId}">🧪 处方</button>
            <button class="seg-tab" onclick="ExperimentCards.switchSegTab(this, '${domId}')" data-target="seg-llc-${domId}">🔬 LLC 表征</button>
            <button class="seg-tab" onclick="ExperimentCards.switchSegTab(this, '${domId}')" data-target="seg-residual-${domId}">📉 残留率</button>
            <button class="seg-tab" onclick="ExperimentCards.switchSegTab(this, '${domId}')" data-target="seg-calculation-${domId}">📐 计算结果</button>
          </div>

          <!-- 释放曲线（默认） -->
          <div class="seg-panel active" id="seg-release-${domId}">
            <div class="section-block release-primary">
              <div class="section-content">
                <div class="chart-container"><canvas id="release-chart-${domId}" height="200"></canvas></div>
                <div style="margin-bottom:10px">
                  <div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:4px">释放总览汇总</div>
                  <table class="data-table" style="box-shadow:none;width:100%">
                    <thead><tr>
                      <th style="text-align:center;padding:4px 6px;font-size:11px">编号</th>
                      <th style="text-align:center;padding:4px 6px;font-size:11px">累计释放率</th>
                      <th style="text-align:center;padding:4px 6px;font-size:11px">残留吸光度</th>
                      <th style="text-align:center;padding:4px 6px;font-size:11px">残留药量</th>
                      <th style="text-align:center;padding:4px 6px;font-size:11px">残留率</th>
                      <th style="text-align:center;padding:4px 6px;font-size:11px">总回收率</th>
                    </tr></thead>
                    <tbody>${renderSummaryRow(sample, domId)}</tbody>
                  </table>
                </div>
                <div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:6px">时间点 / 吸光度 / 取样体积 / 总体积 为手动输入，其余自动计算</div>
                <div class="table-scroll" style="max-height:400px">
                  <table class="data-table release-data-table" style="box-shadow:none">
                    <thead><tr>
                      <th style="min-width:60px">时间点</th><th style="min-width:70px">吸光度</th>
                      <th style="min-width:60px">取样体积 (mL)</th><th style="min-width:60px">总体积 (mL)</th>
                      <th class="col-auto" style="min-width:80px">浓度 (μg/mL)</th>
                      <th class="col-auto" style="min-width:90px">累计释放量 (mg)</th>
                      <th class="col-auto" style="min-width:90px">累计释放率 (%)</th>
                    </tr></thead>
                    <tbody id="tbody-${domId}"></tbody>
                  </table>
                </div>
                <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                  <button class="btn btn-sm btn-secondary" onclick="ExperimentCards.addRow('${expId}','${sample.id}')">+ 添加行</button>
                  <button class="btn btn-sm btn-secondary" onclick="ExperimentCards.removeLastRow('${expId}','${sample.id}')">− 删除末行</button>
                  <button class="btn btn-sm btn-secondary" onclick="ExperimentCards.clearTableData('${expId}','${sample.id}')" style="color:var(--color-danger)">重置为空白</button>
                  <span style="font-size:11px;color:var(--color-text-tertiary)">自动保存 · 数据不会丢失</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 总览 -->
          <div class="seg-panel" id="seg-overview-${domId}">
            <div class="section-block"><div class="section-content">${renderOverview(sample)}</div></div>
          </div>

          <!-- 处方 -->
          <div class="seg-panel" id="seg-formulation-${domId}">
            <div class="section-block"><div class="section-content">${renderFormulationTable(sample)}</div></div>
          </div>

          <!-- LLC -->
          <div class="seg-panel" id="seg-llc-${domId}">
            <div class="section-block"><div class="section-content"><div style="padding:12px;text-align:center;color:var(--color-text-tertiary);font-size:13px"><p>偏光显微镜 / SAXS / SEM 图片可通过上传添加</p></div></div></div>
          </div>

          <!-- 残留率 -->
          <div class="seg-panel" id="seg-residual-${domId}">
            <div class="section-block"><div class="section-content">
              <table class="data-table" style="box-shadow:none"><thead><tr><th>参数</th><th>值</th></tr></thead><tbody>
                <tr><td>残留吸光度</td><td>${(sample.residualAbs||0).toFixed(3)}</td></tr>
                <tr><td>残留药量</td><td>${(sample.residualAmount||0).toFixed(4)} mg</td></tr>
                <tr><td>残留率</td><td id="residual-rate-${domId}">${(sample.residualRate||0).toFixed(2)}%</td></tr>
                <tr><td>累计释放率</td><td id="final-rate-display-${domId}">${(sample.finalRate||0).toFixed(2)}%</td></tr>
                <tr><td>总回收率</td><td id="total-recovery-${domId}">${(sample.totalRecovery||0).toFixed(2)}%</td></tr>
              </tbody></table>
            </div></div>
          </div>

          <!-- 计算结果 -->
          <div class="seg-panel" id="seg-calculation-${domId}">
            <div class="section-block"><div class="section-content">
              <table class="data-table" style="box-shadow:none"><thead><tr><th>计算项</th><th>结果</th><th>说明</th></tr></thead><tbody>
                <tr><td>最终累计释放率</td><td id="calc-final-${domId}"><strong>${(sample.finalRate||0).toFixed(2)}%</strong></td><td>${sample.id} 终点释放百分比</td></tr>
                <tr><td>残留率</td><td id="calc-residual-${domId}"><strong>${(sample.residualRate||0).toFixed(2)}%</strong></td><td>制剂中残余药量百分比</td></tr>
                <tr><td>总回收率</td><td id="calc-total-${domId}"><strong>${(sample.totalRecovery||0).toFixed(2)}%</strong></td><td>释放率 + 残留率</td></tr>
                <tr><td>总药量</td><td>${sample.totalDrug.toFixed(2)} mg</td><td>理论载药量</td></tr>
              </tbody></table>
              <div style="margin-top:8px;text-align:right;display:flex;gap:8px;justify-content:flex-end">
                <button class="btn btn-sm btn-primary" onclick="ExperimentCards.analyzeSample('${expId}','${sample.id}')">一键分析</button>
                <button class="btn btn-sm btn-secondary" onclick="ExperimentCards.saveReport('${expId}','${sample.id}')">保存报告</button>
              </div>
            </div></div>
          </div>
        </div>

        <div class="sample-card-footer">
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <button class="btn btn-sm btn-primary" onclick="ExperimentCards.analyzeSample('${expId}','${sample.id}')">一键分析所有数据</button>
          </div>
          <div class="section-header" style="border-bottom:none;padding:0 0 4px 0"><span class="section-label">📋 分析报告</span></div>
          <div class="report-list" id="report-list-${expId}-${sample.id}">${reportsHtml}</div>
        </div>
      </div>
    `;
  }

  // ============================================================
  // 释放总览汇总行
  // ============================================================
  function renderSummaryRow(sample, domId) {
    const fr = (sample.finalRate || 0).toFixed(2);
    const ra = (sample.residualAbs || 0).toFixed(3);
    const ramt = (sample.residualAmount || 0).toFixed(4);
    const rr = (sample.residualRate || 0).toFixed(2);
    const tr = (sample.totalRecovery || 0).toFixed(2);
    return `<tr>
      <td style="text-align:center;padding:4px 6px;font-size:12px;font-weight:500">${sample.id}</td>
      <td style="text-align:center;padding:4px 6px;font-size:12px;color:var(--color-teal);font-weight:600" id="sum-final-${domId}">${fr}%</td>
      <td style="text-align:center;padding:4px 6px;font-size:12px;font-family:var(--font-mono)" id="sum-abs-${domId}">${ra}</td>
      <td style="text-align:center;padding:4px 6px;font-size:12px;font-family:var(--font-mono)" id="sum-amt-${domId}">${ramt}</td>
      <td style="text-align:center;padding:4px 6px;font-size:12px;color:var(--color-warning);font-weight:600" id="sum-residual-${domId}">${rr}%</td>
      <td style="text-align:center;padding:4px 6px;font-size:12px;font-weight:600" id="sum-total-${domId}">${tr}%</td>
    </tr>`;
  }

  // ============================================================
  // 总览
  // ============================================================
  function renderOverview(sample) {
    return `<div class="overview-grid">
      <div class="overview-item"><span class="overview-label">样品编号</span><span class="overview-value">${sample.id}</span></div>
      <div class="overview-item"><span class="overview-label">所属处方</span><span class="overview-value">${sample.formulation||'—'}</span></div>
      <div class="overview-item"><span class="overview-label">总药量</span><span class="overview-value">${sample.totalDrug.toFixed(2)} mg</span></div>
      <div class="overview-item highlight"><span class="overview-label">最终累计释放率</span><span class="overview-value">${(sample.finalRate||0).toFixed(2)}%</span></div>
      <div class="overview-item highlight"><span class="overview-label">残留率</span><span class="overview-value">${(sample.residualRate||0).toFixed(2)}%</span></div>
      <div class="overview-item highlight"><span class="overview-label">总回收率</span><span class="overview-value">${(sample.totalRecovery||0).toFixed(2)}%</span></div>
    </div>`;
  }

  // ============================================================
  // 处方组成表格
  // ============================================================
  function renderFormulationTable(sample) {
    const comps = sample.formulationComponents || {};
    const total = sample.formulationTotal || Object.values(comps).reduce((a,b)=>a+b, 0) || 1;
    const rows = Object.entries(comps).map(([name, amount]) => ({
      '组分': name, '用量 (g)': amount.toFixed(2), '占比 (%)': ((amount/total)*100).toFixed(1)
    }));
    if (rows.length === 0) return '<p style="color:var(--color-text-tertiary)">无处方数据</p>';
    rows.push({ '组分': '<strong>合计</strong>', '用量 (g)': total.toFixed(2), '占比 (%)': '100.0' });
    return `<table class="data-table" style="box-shadow:none"><thead><tr><th>组分</th><th>用量 (g)</th><th>占比 (%)</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r['组分']}</td><td>${r['用量 (g)']}</td><td>${r['占比 (%)']}</td></tr>`).join('')}</tbody></table><div style="margin-top:4px;font-size:12px;color:var(--color-text-tertiary)">处方名称: ${sample.formulation||'—'}</div>`;
  }

  // ============================================================
  // Seg Tab 切换
  // ============================================================
  function switchSegTab(btn, domId) {
    const container = btn.closest('.sample-card-body');
    container.querySelectorAll('.seg-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    container.querySelectorAll('.seg-panel').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(btn.dataset.target);
    if (target) target.classList.add('active');
  }

  // ============================================================
  // 初始化表格
  // ============================================================
  function initTable(experimentId, sampleId) {
    const sample = ExperimentData.getSample(experimentId, sampleId);
    if (!sample) return;
    const domId = (experimentId + '-' + sampleId).replace(/[^a-zA-Z0-9-]/g, '');
    const tbody = document.getElementById('tbody-' + domId);
    if (!tbody) return;
    tbody.innerHTML = '';

    const saved = ExperimentData.getSavedTableData(experimentId, sampleId);
    if (saved && saved.timePoints && saved.timePoints.length > 0) {
      for (let i = 0; i < saved.timePoints.length; i++) {
        const tr = document.createElement('tr'); tr.dataset.index = i;
        const timeVal = saved.timePoints[i] || '';
        const absVal = saved.absorbance[i];
        // 空值红框：time 为空 或 absorbance 为 null/NaN
        const absIsEmpty = absVal == null || (typeof absVal === 'number' && isNaN(absVal));
        const timeClass = !timeVal ? ' cell-input-empty' : '';
        const absClass = absIsEmpty ? ' cell-input-empty' : '';
        const absDisplay = absIsEmpty ? '' : absVal;
        tr.innerHTML = `
          <td><input class="cell-input cell-time${timeClass}" type="text" value="${timeVal}" data-field="time"></td>
          <td><input class="cell-input cell-num${absClass}" type="number" step="any" value="${absDisplay}" onwheel="return false" data-field="absorbance"></td>
          <td><input class="cell-input cell-num" type="number" step="any" value="${saved.sampleVols[i]}" onwheel="return false" data-field="sampleVol"></td>
          <td><input class="cell-input cell-num" type="number" step="any" value="${saved.totalVols[i]}" onwheel="return false" data-field="totalVol"></td>
          <td class="col-auto calc-cell" id="conc-${domId}-${i}">—</td>
          <td class="col-auto calc-cell" id="cum-${domId}-${i}">—</td>
          <td class="col-auto calc-cell" id="rate-${domId}-${i}">—</td>
        `;
        tbody.appendChild(tr);
      }
      bindInputEvents(experimentId, sampleId);
      recalcTable(experimentId, sampleId);
      return;
    }

    // 无保存数据：空表
    return;
  }

  function bindInputEvents(experimentId, sampleId) {
    const domId = (experimentId + '-' + sampleId).replace(/[^a-zA-Z0-9-]/g, '');
    const tbody = document.getElementById('tbody-' + domId);
    if (!tbody) return;
    tbody.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        recalcTable(experimentId, sampleId);
        updateChart(experimentId, sampleId);
      });
    });
  }

  // ============================================================
  // 自动计算
  // ============================================================
  function recalcTable(experimentId, sampleId) {
    const sample = ExperimentData.getSample(experimentId, sampleId);
    if (!sample) return;
    const domId = (experimentId + '-' + sampleId).replace(/[^a-zA-Z0-9-]/g, '');
    const tbody = document.getElementById('tbody-' + domId);
    if (!tbody) return;

    const rows = tbody.querySelectorAll('tr');
    const data = [];
    rows.forEach(tr => {
      const timeInput = tr.querySelector('.cell-time');
      const absInput = tr.querySelector('input[data-field="absorbance"]');
      const svInput = tr.querySelector('input[data-field="sampleVol"]');
      const tvInput = tr.querySelector('input[data-field="totalVol"]');
      if (!timeInput || !absInput) return;
      data.push({
        time: timeInput.value,
        absorbance: parseFloat(absInput.value) || 0,
        sampleVol: parseFloat(svInput ? svInput.value : 2) || 2,
        totalVol: parseFloat(tvInput ? tvInput.value : 30) || 30
      });
    });

    const totalVol = data.length > 0 ? data[0].totalVol : 30;
    const sampleVol = data.length > 0 ? data[0].sampleVol : 2;
    const concs = data.map(r => CALC.concentration(r.absorbance));
    const cumRelease = CALC.cumulativeRelease(concs, totalVol, sampleVol);
    const rates = CALC.releaseRate(cumRelease, sample.totalDrug);
    const finalRate = rates.length > 0 ? rates[rates.length - 1] : 0;

    // 更新表格
    rows.forEach((tr, i) => {
      const c = document.getElementById(`conc-${domId}-${i}`);
      const cr = document.getElementById(`cum-${domId}-${i}`);
      const rr = document.getElementById(`rate-${domId}-${i}`);
      if (c) c.textContent = concs[i].toFixed(4);
      if (cr) cr.textContent = cumRelease[i].toFixed(4);
      if (rr) rr.innerHTML = `<strong>${rates[i].toFixed(2)}%</strong>`;
    });

    // 保存
    ExperimentData.saveTableData(experimentId, sampleId, data);

    // 更新汇总
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('sum-final-' + domId, finalRate.toFixed(2) + '%');
    set('sum-residual-' + domId, (sample.residualRate || 0).toFixed(2) + '%');
    set('sum-total-' + domId, (finalRate + (sample.residualRate || 0)).toFixed(2) + '%');
    set('final-rate-display-' + domId, finalRate.toFixed(2) + '%');
    set('total-recovery-' + domId, (finalRate + (sample.residualRate || 0)).toFixed(2) + '%');
    set('calc-final-' + domId, finalRate.toFixed(2) + '%');
    set('calc-total-' + domId, (finalRate + (sample.residualRate || 0)).toFixed(2) + '%');
  }

  // ============================================================
  // 图表
  // ============================================================
  function updateChart(experimentId, sampleId) {
    const domId = (experimentId + '-' + sampleId).replace(/[^a-zA-Z0-9-]/g, '');
    const canvasId = 'release-chart-' + domId;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    Charts.destroy(canvasId);

    const tbody = document.getElementById('tbody-' + domId);
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    const times = [], ratesArr = [];
    rows.forEach(tr => {
      const ti = tr.querySelector('.cell-time');
      const rc = tr.querySelector('.calc-cell:last-child strong');
      if (ti && ti.value && rc) { times.push(ti.value); ratesArr.push(parseFloat(rc.textContent)); }
    });

    if (times.length === 0) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = '#8c94a6'; ctx.font = '13px PingFang SC, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('请点击「+ 添加行」输入数据', canvas.width/2, canvas.height/2);
      return;
    }

    const timeNums = times.map(t => {
      if (t.endsWith('h')) return parseFloat(t);
      if (t.endsWith('d')) return parseFloat(t)*24;
      return parseFloat(t)||0;
    });

    new Chart(canvas, {
      type:'line',
      data:{datasets:[{label:sampleId+' 释放曲线',data:timeNums.map((t,i)=>({x:t,y:ratesArr[i]})),borderColor:'#0d7377',backgroundColor:'#0d737720',fill:true,tension:.3,pointRadius:4}]},
      options:{responsive:true,maintainAspectRatio:false,scales:{x:{type:'linear',title:{display:true,text:'时间 (h)'},min:0},y:{title:{display:true,text:'累计释放率 (%)'},min:0,max:100}},plugins:{legend:{position:'top'}}}
    });
  }

  function renderAllCharts(samples) {
    for (const s of samples) {
      initTable(currentExperimentId, s.id);
      updateChart(currentExperimentId, s.id);
    }
  }

  // ============================================================
  // 行操作
  // ============================================================
  function addRow(experimentId, sampleId) {
    const domId = (experimentId + '-' + sampleId).replace(/[^a-zA-Z0-9-]/g, '');
    const tbody = document.getElementById('tbody-' + domId);
    if (!tbody) return;
    const idx = tbody.children.length;
    const tr = document.createElement('tr'); tr.dataset.index = idx;
    tr.innerHTML = `
      <td><input class="cell-input cell-time" type="text" value="" placeholder="输入时间" data-field="time"></td>
      <td><input class="cell-input cell-num" type="number" step="any" value="0" onwheel="return false" data-field="absorbance"></td>
      <td><input class="cell-input cell-num" type="number" step="any" value="2" onwheel="return false" data-field="sampleVol"></td>
      <td><input class="cell-input cell-num" type="number" step="any" value="30" onwheel="return false" data-field="totalVol"></td>
      <td class="col-auto calc-cell" id="conc-${domId}-${idx}">0.0000</td>
      <td class="col-auto calc-cell" id="cum-${domId}-${idx}">0.0000</td>
      <td class="col-auto calc-cell" id="rate-${domId}-${idx}"><strong>0.00%</strong></td>
    `;
    tbody.appendChild(tr);
    bindInputEvents(experimentId, sampleId);
    recalcTable(experimentId, sampleId);
    updateChart(experimentId, sampleId);
  }

  function removeLastRow(experimentId, sampleId) {
    const domId = (experimentId + '-' + sampleId).replace(/[^a-zA-Z0-9-]/g, '');
    const tbody = document.getElementById('tbody-' + domId);
    if (!tbody || tbody.children.length <= 1) { UI.toast('至少保留一行数据','warning'); return; }
    tbody.removeChild(tbody.lastChild);
    recalcTable(experimentId, sampleId);
    updateChart(experimentId, sampleId);
  }

  function clearTableData(experimentId, sampleId) {
    ExperimentData.clearSavedTableData(experimentId, sampleId);
    const domId = (experimentId + '-' + sampleId).replace(/[^a-zA-Z0-9-]/g, '');
    const tbody = document.getElementById('tbody-' + domId);
    if (tbody) tbody.innerHTML = '';
    const canvasId = 'release-chart-' + domId;
    const canvas = document.getElementById(canvasId);
    if (canvas) { Charts.destroy(canvasId); const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); }
    UI.toast('已重置为空白', 'success');
  }

  // ============================================================
  // 创建实验组对话框
  // ============================================================
  function showCreateDialog(editGroup) {
    const now = new Date().toISOString().slice(0, 10);
    const isEdit = !!editGroup;
    const title = isEdit ? '编辑实验组' : '创建实验组';
    const btnLabel = isEdit ? '保存修改' : '确认创建';
    const initName = isEdit ? editGroup.name : '';
    const initDate = isEdit ? (editGroup.date || now) : now;
    const initDrug = isEdit ? (editGroup.drugAmount || '') : '';
    const initForms = isEdit ? (editGroup.formulations || []) : [];

    let formRowsHtml = '';
    if (initForms.length > 0) {
      initForms.forEach(f => {
        const c = f.components || {};
        formRowsHtml += `<tr class="form-row-entry">
          <td><input class="cf-input cf-name" data-field="formulationName" value="${f.name}"></td>
          <td><input class="cf-input" data-field="spc" type="number" step="any" value="${(c.SPC||0).toFixed(2)}" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td>
          <td><input class="cf-input" data-field="gmo" type="number" step="any" value="${(c.GMO||0).toFixed(2)}" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td>
          <td><input class="cf-input" data-field="nmp" type="number" step="any" value="${(c.NMP||0).toFixed(2)}" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td>
          <td><input class="cf-input" data-field="water" type="number" step="any" value="${(c.水||0).toFixed(2)}" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td>
          <td><input class="cf-input" data-field="etoh" type="number" step="any" value="${(c.EtOH||0).toFixed(2)}" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td>
          <td><input class="cf-input" data-field="dopg" type="number" step="any" value="${(c['DOPG-Na']||0).toFixed(2)}" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td>
          <td><span class="cf-total" data-field="total">${(f.total||0).toFixed(2)}</span></td>
          <td><input class="cf-input cf-samples" data-field="samples" value="${(f.samples||[]).join('、')}"></td>
        </tr>`;
      });
    } else {
      formRowsHtml = `<tr class="form-row-entry">
        <td><input class="cf-input cf-name" data-field="formulationName" placeholder="如 GMO-N" value=""></td>
        <td><input class="cf-input" data-field="spc" type="number" step="any" value="" placeholder="0" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td>
        <td><input class="cf-input" data-field="gmo" type="number" step="any" value="" placeholder="0" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td>
        <td><input class="cf-input" data-field="nmp" type="number" step="any" value="" placeholder="0" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td>
        <td><input class="cf-input" data-field="water" type="number" step="any" value="" placeholder="0" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td>
        <td><input class="cf-input" data-field="etoh" type="number" step="any" value="" placeholder="0" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td>
        <td><input class="cf-input" data-field="dopg" type="number" step="any" value="" placeholder="0" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td>
        <td><span class="cf-total" data-field="total">0.00</span></td>
        <td><input class="cf-input cf-samples" data-field="samples" placeholder="如 N1、N2" value=""></td>
      </tr>`;
    }

    const body = `
      <style>.create-form-table{width:100%;border-collapse:collapse;table-layout:fixed}.create-form-table th{font-size:12px;font-weight:500;color:var(--color-text-secondary);background:var(--color-bg-tertiary);padding:10px 4px;text-align:center;border:1px solid var(--color-border)}.create-form-table td{padding:4px;border:1px solid var(--color-border-light)}.create-form-table .cf-input{width:100%;min-width:0;border:1px solid var(--color-border);padding:6px 8px;border-radius:var(--radius-sm);font-size:13px;font-family:var(--font-sans);background:var(--color-bg-primary);outline:none;box-sizing:border-box;transition:border-color .15s}.create-form-table .cf-input:focus{border-color:var(--color-teal);box-shadow:0 0 0 2px rgba(13,115,119,.12)}.create-form-table .cf-input[type="number"]{text-align:right;font-family:var(--font-mono)}.create-form-table .cf-total{font-weight:600;color:var(--color-teal);font-family:var(--font-mono);text-align:center;font-size:14px;padding:7px 2px;background:var(--color-info-bg);border-radius:var(--radius-sm);display:block}</style>
      <div class="form-row"><div class="form-group" style="flex:2"><label class="form-label">实验组名称 *</label><input class="form-input" id="create-exp-name" value="${initName}">${isEdit?`<input type="hidden" id="edit-group-id" value="${editGroup.id}">`:''}</div><div class="form-group" style="flex:1"><label class="form-label">日期</label><input class="form-input" id="create-exp-date" type="date" value="${initDate}"></div></div>
      <label class="form-label" style="margin-bottom:4px">处方组成</label>
      <table class="create-form-table"><colgroup><col style="width:90px"><col style="width:55px"><col style="width:55px"><col style="width:55px"><col style="width:50px"><col style="width:55px"><col style="width:65px"><col style="width:60px"><col style="width:115px"></colgroup><thead><tr><th>处方名称</th><th>SPC</th><th>GMO</th><th>NMP</th><th>水</th><th>EtOH</th><th>DOPG-Na</th><th>总重</th><th>对应样品</th></tr></thead><tbody id="create-form-tbody">${formRowsHtml}</tbody></table>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center"><button class="btn btn-sm btn-secondary" onclick="ExperimentCards.addFormRow()">+ 添加处方</button><button class="btn btn-sm btn-secondary" onclick="ExperimentCards.removeLastFormRow()">− 删除末行</button><span style="font-size:11px;color:var(--color-text-tertiary)">每行一个处方，总重自动求和</span></div>
      <label class="form-label" style="margin:8px 0 2px 0">实验参数</label>
      <div class="form-row"><div class="form-group" style="flex:1"><label class="form-label">基重 (g)</label><div class="form-input" id="create-base-weight" style="background:var(--color-info-bg);color:var(--color-teal);font-weight:600;font-family:var(--font-mono)">0.00</div></div><div class="form-group" style="flex:1"><label class="form-label">加入药量 (mg) *</label><input class="form-input" id="create-drug-amount" type="number" step="any" value="${initDrug}" onwheel="return false" oninput="ExperimentCards.updateDrugLoading()"></div><div class="form-group" style="flex:1"><label class="form-label">载药浓度 (mg/ml)</label><div class="form-input" id="create-drug-conc" style="background:var(--color-info-bg);color:var(--color-teal);font-weight:600;font-family:var(--font-mono)">0.00</div></div></div>
    `;
    const footer = `<button class="btn btn-secondary" onclick="UI.hideModal()">取消</button><button class="btn btn-primary" id="create-exp-confirm">${btnLabel}</button>`;
    UI.showModal(title, body, footer);
    document.getElementById('create-exp-confirm').onclick = isEdit ? () => updateExperiment(editGroup.id) : createExperiment;
    setTimeout(updateFormTotal, 50);
  }

  function addFormRow() {
    const tbody = document.getElementById('create-form-tbody');
    if (!tbody) return;
    const idx = tbody.children.length + 1;
    const tr = document.createElement('tr'); tr.className = 'form-row-entry';
    tr.innerHTML = `<td><input class="cf-input cf-name" data-field="formulationName" placeholder="如 GMO-N" value=""></td><td><input class="cf-input" data-field="spc" type="number" step="any" value="" placeholder="0" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td><td><input class="cf-input" data-field="gmo" type="number" step="any" value="" placeholder="0" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td><td><input class="cf-input" data-field="nmp" type="number" step="any" value="" placeholder="0" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td><td><input class="cf-input" data-field="water" type="number" step="any" value="" placeholder="0" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td><td><input class="cf-input" data-field="etoh" type="number" step="any" value="" placeholder="0" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td><td><input class="cf-input" data-field="dopg" type="number" step="any" value="" placeholder="0" onwheel="return false" oninput="ExperimentCards.updateFormTotal()"></td><td><span class="cf-total" data-field="total">0.00</span></td><td><input class="cf-input cf-samples" data-field="samples" placeholder="如 D1、D2" value=""></td>`;
    tbody.appendChild(tr);
    updateFormTotal();
  }

  function removeLastFormRow() {
    const tbody = document.getElementById('create-form-tbody');
    if (!tbody || tbody.children.length <= 1) { UI.toast('至少保留一个处方','warning'); return; }
    tbody.removeChild(tbody.lastChild);
    updateFormTotal();
  }

  function updateFormTotal() {
    const tbody = document.getElementById('create-form-tbody');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach(tr => {
      const get = f => parseFloat(tr.querySelector(`[data-field="${f}"]`).value) || 0;
      const sum = get('spc')+get('gmo')+get('nmp')+get('water')+get('etoh')+get('dopg');
      tr.querySelector('[data-field="total"]').textContent = sum.toFixed(2);
    });
    updateDrugLoading();
  }

  function updateDrugLoading() {
    const tbody = document.getElementById('create-form-tbody');
    if (!tbody) return;
    const firstRow = tbody.querySelector('tr');
    if (!firstRow) return;
    const baseG = parseFloat(firstRow.querySelector('[data-field="total"]').textContent) || 0;
    const drugMg = parseFloat(document.getElementById('create-drug-amount').value) || 0;
    const conc = drugMg / (baseG + drugMg / 1000);
    const baseEl = document.getElementById('create-base-weight');
    const concEl = document.getElementById('create-drug-conc');
    if (baseEl) baseEl.textContent = baseG.toFixed(2);
    if (concEl) concEl.textContent = drugMg > 0 ? conc.toFixed(2) : '0.00';
  }

  function createExperiment() {
    const name = document.getElementById('create-exp-name').value.trim();
    const date = document.getElementById('create-exp-date').value;
    const drugAmount = parseFloat(document.getElementById('create-drug-amount').value);
    const concEl = document.getElementById('create-drug-conc');
    const drugConc = parseFloat(concEl ? concEl.textContent : '0');
    if (!name) { UI.toast('请输入实验组名称','warning'); return; }
    if (isNaN(drugAmount) || drugAmount <= 0) { UI.toast('请输入加入药量','warning'); return; }

    const tbody = document.getElementById('create-form-tbody');
    const formRows = tbody.querySelectorAll('tr');
    const formulations = []; const allSampleIds = [];
    for (const tr of formRows) {
      const get = f => tr.querySelector(`[data-field="${f}"]`).value.trim();
      const fn = get('formulationName');
      if (!fn) { UI.toast('请填写处方名称','warning'); return; }
      const components = { SPC:parseFloat(get('spc'))||0, GMO:parseFloat(get('gmo'))||0, NMP:parseFloat(get('nmp'))||0, 水:parseFloat(get('water'))||0, EtOH:parseFloat(get('etoh'))||0, 'DOPG-Na':parseFloat(get('dopg'))||0 };
      const ft = Object.values(components).reduce((a,b)=>a+b,0);
      const st = get('samples');
      const sids = st.split(/[,，\s、]+/).filter(s=>s.length>0);
      if (sids.length===0) { UI.toast(`处方"${fn}"的对应样品不能为空`,'warning'); return; }
      formulations.push({name:fn,components,total:ft,samples:sids});
      allSampleIds.push(...sids);
    }
    const totalDrug = allSampleIds.length > 0 ? drugAmount / allSampleIds.length : 0;

    const data = { experimentName:name, date, totalDrug, drugAmount, drugConc, groupName:name, formulations };
    const group = ExperimentData.createExperiment(data);
    UI.hideModal();
    UI.toast(`已创建「${name}」，${group.samples.length} 个样品`, 'success');
    App.navigate('experiments');
  }

  function updateExperiment(groupId) {
    const name = document.getElementById('create-exp-name').value.trim();
    const date = document.getElementById('create-exp-date').value;
    const drugAmount = parseFloat(document.getElementById('create-drug-amount').value);
    const concEl = document.getElementById('create-drug-conc');
    const drugConc = parseFloat(concEl ? concEl.textContent : '0');
    if (!name) { UI.toast('请输入实验组名称','warning'); return; }

    const tbody = document.getElementById('create-form-tbody');
    const formRows = tbody.querySelectorAll('tr');
    const formulations = []; const allSampleIds = [];
    for (const tr of formRows) {
      const get = f => tr.querySelector(`[data-field="${f}"]`).value.trim();
      const fn = get('formulationName');
      if (!fn) { UI.toast('请填写处方名称','warning'); return; }
      const components = { SPC:parseFloat(get('spc'))||0, GMO:parseFloat(get('gmo'))||0, NMP:parseFloat(get('nmp'))||0, 水:parseFloat(get('water'))||0, EtOH:parseFloat(get('etoh'))||0, 'DOPG-Na':parseFloat(get('dopg'))||0 };
      const ft = Object.values(components).reduce((a,b)=>a+b,0);
      const st = get('samples');
      const sids = st.split(/[,，\s、]+/).filter(s=>s.length>0);
      if (sids.length===0) { UI.toast(`处方"${fn}"的对应样品不能为空`,'warning'); return; }
      formulations.push({name:fn,components,total:ft,samples:sids});
      allSampleIds.push(...sids);
    }
    const totalDrug = allSampleIds.length > 0 ? drugAmount / allSampleIds.length : 0;
    const data = { experimentName:name, date, totalDrug, drugAmount, drugConc, groupName:name, formulations };
    ExperimentData.updateExperiment(groupId, data);
    UI.hideModal();
    UI.toast(`已更新「${name}」`, 'success');

    // 如果当前卡片视图显示的是这个组，重新渲染
    if (currentExperimentId === groupId) {
      const container = document.getElementById('app-content');
      if (container) render(container, { name }, groupId);
    }
    App.navigate('experiments');
  }

  // ============================================================
  // 分析 & 报告
  // ============================================================
  function analyzeAll() {
    const expId = currentExperimentId;
    if (!expId) { UI.toast('请先从实验列表进入','warning'); return; }
    const samples = ExperimentData.getExperimentSamples(expId);
    const results = [];
    for (const s of samples) {
      const r = generateAnalysis(s, 'basic');
      results.push(r);
    }
    analysisResults = { results, timestamp: Date.now() };
    const body = `<div style="max-height:500px;overflow-y:auto">${results.map(r=>`<div class="analysis-summary-item"><h4 style="margin:0 0 8px;color:var(--color-teal)">${r.sampleId}</h4>${r.html}</div>`).join('')}</div>`;
    UI.showModal('全样品分析结果', body, '<button class="btn btn-secondary" onclick="ExperimentCards.saveAllReports()">保存所有报告</button><button class="btn btn-secondary" onclick="UI.hideModal()">关闭</button>');
    UI.toast('已分析所有样品数据', 'success');
  }

  // ============================================================
  // 预置分析 Skill
  // ============================================================
  const ANALYSIS_SKILLS = [
    { id: 'basic', name: '基础概览', desc: '释放模式 / 突释指数 / 基础参数' },
    { id: 'kinetics', name: '释放动力学', desc: '释放速率 / 溶出曲线斜率 / 拟合评估' },
    { id: 'comparison', name: '处方对比', desc: '与其他样品对比 / 性能差异分析' }
  ];

  let _skillResults = {}; // 缓存各 skill 的分析结果

  function analyzeSample(experimentId, sampleId) {
    const sample = ExperimentData.getSample(experimentId, sampleId);
    if (!sample) { UI.toast('未找到样品','warning'); return; }

    _skillResults = {};
    const defaultSkill = ANALYSIS_SKILLS[0].id;
    _skillResults[defaultSkill] = generateAnalysis(sample, defaultSkill);

    const skillsHtml = ANALYSIS_SKILLS.map((sk, i) =>
      `<button class="seg-tab ${i===0?'active':''}" data-skill="${sk.id}" onclick="ExperimentCards.switchAnalysisSkill(this,'${experimentId}','${sampleId}')" style="flex:1;font-size:11px;padding:5px 8px">${sk.name}</button>`
    ).join('');

    const skillDescs = ANALYSIS_SKILLS.map(sk =>
      `<div style="font-size:10px;color:var(--color-text-tertiary);text-align:center;margin-top:2px;display:${sk.id===defaultSkill?'block':'none'}" id="skill-desc-${sk.id}">${sk.desc}</div>`
    ).join('');

    const body = `<div style="max-height:500px;overflow-y:auto">
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong style="font-size:16px;color:var(--color-teal)">${sampleId} 分析报告</strong>
          <span style="font-size:12px;color:var(--color-text-tertiary)">${new Date().toLocaleString()}</span>
        </div>
      </div>
      <div class="seg-tabs" style="margin-bottom:8px" id="skill-tabs-${experimentId}-${sampleId}">${skillsHtml}</div>
      ${skillDescs}
      <div id="analysis-content-${experimentId}-${sampleId}">${_skillResults[defaultSkill].html}</div>
    </div>`;

    UI.showModal(`分析结果 — ${sampleId}`, body, `<button class="btn btn-primary" onclick="ExperimentCards.saveReport('${experimentId}','${sampleId}')">保存报告</button><button class="btn btn-secondary" onclick="UI.hideModal()">关闭</button>`);
  }

  function switchAnalysisSkill(btn, experimentId, sampleId) {
    const skill = btn.dataset.skill;
    const modal = btn.closest('.modal-container');
    // 切换按钮
    modal.querySelectorAll('.seg-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    // 切换描述
    modal.querySelectorAll('[id^="skill-desc-"]').forEach(d => d.style.display = 'none');
    const desc = document.getElementById('skill-desc-' + skill);
    if (desc) desc.style.display = 'block';
    // 缓存 + 切换内容
    if (!_skillResults[skill]) {
      const sample = ExperimentData.getSample(experimentId, sampleId);
      if (sample) _skillResults[skill] = generateAnalysis(sample, skill);
    }
    const content = document.getElementById('analysis-content-' + experimentId + '-' + sampleId);
    if (content && _skillResults[skill]) content.innerHTML = _skillResults[skill].html;
  }

  function generateAnalysis(sample, skillId) {
    const rates = sample.releaseRate.length > 0 ? sample.releaseRate : [sample.finalRate];
    const maxRate = rates.length > 0 ? Math.max(...rates) : 0;
    const finalRate = sample.finalRate || 0;
    const avgRate = rates.length > 0 ? rates.reduce((a,b)=>a+b,0)/rates.length : 0;
    let burstIndex = 0;
    if (rates.length >= 3) burstIndex = rates[1] - rates[0];

    let html = '';
    if (skillId === 'basic') {
      let releasePattern = '无数据';
      if (maxRate > 80) releasePattern = '快速释放';
      else if (maxRate > 50) releasePattern = '中等释放';
      else if (maxRate > 0) releasePattern = '缓慢释放';
      const burstDesc = burstIndex < 3 ? '无显著突释' : burstIndex < 8 ? '轻微突释' : '明显突释';
      html = `<div style="background:var(--color-bg-secondary);border-radius:8px;padding:16px;margin-bottom:12px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px"><div><strong>样品:</strong> ${sample.id}</div><div><strong>处方:</strong> ${sample.formulation||'—'}</div><div><strong>最终释放率:</strong> ${finalRate.toFixed(2)}%</div><div><strong>释放模式:</strong> ${releasePattern}</div><div><strong>突释指数:</strong> ${burstIndex.toFixed(2)} (${burstDesc})</div></div></div><div style="font-size:13px;color:var(--color-text-secondary);line-height:1.8"><p><strong>分析结论:</strong></p><p>• ${sample.id} 累计释放率为 ${finalRate.toFixed(2)}%，${releasePattern}特征${maxRate>0?'明显':'（数据不足）'}。</p><p>• ${burstDesc}（突释指数 = ${burstIndex.toFixed(2)}）。</p></div>`;
    } else if (skillId === 'kinetics') {
      // 释放速率: 前段(前20%) vs 后段(后50%)
      const total = rates.length;
      const earlyRate = rates.slice(0, Math.max(1, Math.floor(total * 0.2))).reduce((a,b)=>a+b,0) / Math.max(1, Math.floor(total * 0.2));
      const lateRate = rates.slice(Math.floor(total * 0.5)).reduce((a,b)=>a+b,0) / Math.max(1, total - Math.floor(total * 0.5));
      const slope = total >= 2 ? (rates[total-1] - rates[0]) / total : 0;
      html = `<div style="background:var(--color-bg-secondary);border-radius:8px;padding:16px;margin-bottom:12px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px"><div><strong>前段释放速率:</strong> ${earlyRate.toFixed(2)}%</div><div><strong>后段释放速率:</strong> ${lateRate.toFixed(2)}%</div><div><strong>平均速率:</strong> ${avgRate.toFixed(2)}%</div><div><strong>整体斜率:</strong> ${slope.toFixed(2)}%/点</div></div></div><div style="font-size:13px;color:var(--color-text-secondary);line-height:1.8"><p><strong>动力学评估:</strong></p><p>• 前段释放速率 ${earlyRate.toFixed(2)}%，后段 ${lateRate.toFixed(2)}%，${lateRate>earlyRate?'后段加速释放':'前段释放较快'}。</p><p>• 整体斜率 ${slope.toFixed(2)}%/点，释放${slope>2?'较快':'平稳'}。</p></div>`;
    } else if (skillId === 'comparison') {
      html = `<div style="background:var(--color-bg-secondary);border-radius:8px;padding:16px;margin-bottom:12px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px"><div><strong>样品:</strong> ${sample.id}</div><div><strong>处方:</strong> ${sample.formulation||'—'}</div><div><strong>最终释放率:</strong> ${finalRate.toFixed(2)}%</div><div><strong>平均释放率:</strong> ${avgRate.toFixed(2)}%</div></div></div><div style="font-size:13px;color:var(--color-text-secondary);line-height:1.8"><p><strong>对比参考:</strong></p><p>• ${sample.id} 在所属实验组中独立分析，最终释放率 ${finalRate.toFixed(2)}%。</p><p>• 建议在"实验记录"页面的实验组卡片中查看该组其他样品的释放数据以进行横向对比。</p></div>`;
    }

    return { sampleId: sample.id, timestamp: new Date().toISOString(), html };
  }

  function saveReport(experimentId, sampleId) {
    const sample = ExperimentData.getSample(experimentId, sampleId);
    if (!sample) return;
    const result = generateAnalysis(sample, 'basic');
    ExperimentData.saveReport(experimentId, sampleId, { title: `分析报告 ${new Date().toLocaleString('zh-CN')}`, timestamp: new Date().toISOString(), result });
    updateReportUI(experimentId, sampleId);
    UI.toast(`${sampleId} 报告已保存`, 'success');
  }

  function saveAllReports() {
    const expId = currentExperimentId;
    if (!expId) return;
    const samples = ExperimentData.getExperimentSamples(expId);
    let count = 0;
    for (const s of samples) {
      const result = generateAnalysis(s, 'basic');
      ExperimentData.saveReport(expId, s.id, { title: `全量分析报告 ${new Date().toLocaleString('zh-CN')}`, timestamp: new Date().toISOString(), result });
      updateReportUI(expId, s.id);
      count++;
    }
    UI.toast(`已保存 ${count} 份报告`, 'success');
  }

  function queryReport(experimentId, sampleId, index) {
    const reports = ExperimentData.getReports(experimentId, sampleId);
    if (!reports || !reports[index]) { UI.toast('报告未找到','warning'); return; }
    const r = reports[index];
    const body = `<div style="max-height:500px;overflow-y:auto"><div style="margin-bottom:12px"><strong style="font-size:16px;color:var(--color-teal)">${sampleId} — ${r.title}</strong><div style="font-size:12px;color:var(--color-text-tertiary);margin-top:4px">${new Date(r.timestamp).toLocaleString('zh-CN')}</div></div>${r.result.html}</div>`;
    UI.showModal('查询报告', body, `<button class="btn btn-secondary" onclick="ExperimentCards.deleteReportFn('${experimentId}','${sampleId}',${index})" style="color:var(--color-danger)">删除报告</button><button class="btn btn-secondary" onclick="UI.hideModal()">关闭</button>`);
  }

  function deleteReportFn(experimentId, sampleId, index) {
    ExperimentData.deleteReport(experimentId, sampleId, index);
    updateReportUI(experimentId, sampleId);
    UI.hideModal();
  }

  function deleteReportInline(experimentId, sampleId, index) {
    ExperimentData.deleteReport(experimentId, sampleId, index);
    updateReportUI(experimentId, sampleId);
    UI.toast('报告已删除', 'success');
  }

  function updateReportUI(experimentId, sampleId) {
    const el = document.getElementById(`report-list-${experimentId}-${sampleId}`);
    if (!el) return;
    const reports = ExperimentData.getReports(experimentId, sampleId);
    el.innerHTML = reports.length === 0 ? '<div style="font-size:12px;color:var(--color-text-tertiary);padding:4px 0">暂无保存的报告</div>' : reports.map((r,i)=>`<div class="report-item"><span class="report-name">报告 #${i+1}: ${r.title}</span><div style="display:flex;gap:6px"><button class="btn btn-sm btn-secondary" onclick="ExperimentCards.queryReport('${experimentId}','${sampleId}',${i})">查询</button><button class="btn btn-sm btn-danger" onclick="ExperimentCards.deleteReportInline('${experimentId}','${sampleId}',${i})">删除</button></div></div>`).join('');
  }

  function restoreReportsUI() {
    if (!currentExperimentId) return;
    const samples = ExperimentData.getExperimentSamples(currentExperimentId);
    for (const s of samples) {
      updateReportUI(currentExperimentId, s.id);
    }
  }

  // ============================================================
  // 公开 API
  // ============================================================
  return {
    render,
    switchSegTab,
    addRow,
    removeLastRow,
    clearTableData,
    updateChart,
    analyzeAll,
    analyzeSample,
    saveReport,
    saveAllReports,
    queryReport,
    deleteReportFn,
    deleteReportInline,
    switchAnalysisSkill,
    showCreateDialog,
    createExperiment,
    updateExperiment,
    updateFormTotal,
    updateDrugLoading,
    addFormRow,
    removeLastFormRow
  };
})();
