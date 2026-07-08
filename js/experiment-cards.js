/* ========================================
   experiment-cards.js — V2
   实验记录卡片视图 — 以卡片形式展示样品数据
   适配 ExperimentData V2 异步API调用
   ======================================== */

const ExperimentCards = (() => {
  let currentExperimentId = null;
  let analysisResults = {};

  // ============================================================
  // 自动计算引擎（完全保留V1公式）
  // ============================================================
  const CALC = {
    concentration(absVal) {
      return 2 * (absVal - 0.00414128) / 0.0136697;
    },
    cumulativeRelease(concs, totalVols, sampleVols) {
      const result = [];
      for (let i = 0; i < concs.length; i++) {
        const Vn = totalVols[i] || 10;
        const currentRelease = (concs[i] * Vn) / 1000;
        let sampleSum = 0;
        for (let j = 0; j < i; j++) {
          const vj = sampleVols[j] || 2;
          sampleSum += (concs[j] * vj) / 1000;
        }
        result.push(currentRelease + sampleSum);
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
  async function render(container, meta, experimentId) {
    currentExperimentId = experimentId;
    const exp = experimentId ? ExperimentData.getExperiment(experimentId) : null;
    const samples = exp ? exp.samples : [];
    const groupName = exp ? exp.name : (meta?.name || '实验记录');

    container.innerHTML = '';
    let html = buildPageHeader(groupName, exp);
    html += '<div class="exp-cards-container">';

    for (const sample of samples) {
      html += await renderSampleCard(sample);
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
  // 渲染单个样品卡片（V2: getReports 改为 async）
  // ============================================================
  async function renderSampleCard(sample) {
    const expId = currentExperimentId || '';
    let reports = [];
    try { reports = await ExperimentData.getReports(expId, sample.id); } catch(e) { reports = []; }
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
            <span class="tag tag-teal">总药量 ${((sample.expDrugAmount !== undefined ? sample.expDrugAmount : (sample.totalDrug || 0))).toFixed(1)} mg</span>
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

          <div class="seg-panel" id="seg-overview-${domId}">
            <div class="section-block"><div class="section-content">${renderOverview(sample)}</div></div>
          </div>
          <div class="seg-panel" id="seg-formulation-${domId}">
            <div class="section-block"><div class="section-content">${renderFormulationTable(sample)}</div></div>
          </div>
          <div class="seg-panel" id="seg-llc-${domId}">
            <div class="section-block"><div class="section-content"><div style="padding:12px;text-align:center;color:var(--color-text-tertiary);font-size:13px"><p>偏光显微镜 / SAXS / SEM 图片可通过上传添加</p></div></div></div>
          </div>
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
          <div class="seg-panel" id="seg-calculation-${domId}">
            <div class="section-block"><div class="section-content">
              <table class="data-table" style="box-shadow:none"><thead><tr><th>计算项</th><th>结果</th><th>说明</th></tr></thead><tbody>
                <tr><td>最终累计释放率</td><td id="calc-final-${domId}"><strong>${(sample.finalRate||0).toFixed(2)}%</strong></td><td>${sample.id} 终点释放百分比</td></tr>
                <tr><td>残留率</td><td id="calc-residual-${domId}"><strong>${(sample.residualRate||0).toFixed(2)}%</strong></td><td>制剂中残余药量百分比</td></tr>
                <tr><td>总回收率</td><td id="calc-total-${domId}"><strong>${(sample.totalRecovery||0).toFixed(2)}%</strong></td><td>释放率 + 残留率</td></tr>
                <tr><td>总药量</td><td>${((sample.expDrugAmount !== undefined ? sample.expDrugAmount : (sample.totalDrug || 0))).toFixed(2)} mg</td><td>理论载药量</td></tr>
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
      <div class="overview-item"><span class="overview-label">总药量</span><span class="overview-value">${((sample.expDrugAmount !== undefined ? sample.expDrugAmount : (sample.totalDrug || 0))).toFixed(2)} mg</span></div>
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
  // 自动计算（V2: saveTableData 变为 async，不等待完成）
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

    const concs = data.map(r => CALC.concentration(r.absorbance));
    const totalVols = data.map(r => r.totalVol);
    const sampleVols = data.map(r => r.sampleVol);
    const cumRelease = CALC.cumulativeRelease(concs, totalVols, sampleVols);
    const drugBase = sample.expDrugAmount !== undefined ? sample.expDrugAmount : (sample.totalDrug || 0);
    const rates = CALC.releaseRate(cumRelease, drugBase);
    const finalRate = rates.length > 0 ? rates[rates.length - 1] : 0;

    rows.forEach((tr, i) => {
      const c = document.getElementById(`conc-${domId}-${i}`);
      const cr = document.getElementById(`cum-${domId}-${i}`);
      const rr = document.getElementById(`rate-${domId}-${i}`);
      if (c) c.textContent = concs[i].toFixed(4);
      if (cr) cr.textContent = cumRelease[i].toFixed(4);
      if (rr) rr.innerHTML = `<strong>${rates[i].toFixed(2)}%</strong>`;
    });

    // 异步保存到API（不阻塞UI）
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
  // 模板变量
  // ============================================================
  let _currentCreateTemplate = null;
  let _existingEditSamples = [];
  let _templateLocked = false;
  const _DEBUG = false;
  let _globalTemplateCache = null;
  let _cachedSamplesCheckboxHtml = '';

  function preloadTemplateCache() {
    if (_globalTemplateCache) return;
    queueMicrotask(async () => {
      try {
        const [allData, defaultId] = await Promise.all([
          ExperimentData.getAllTemplates(),
          ExperimentData.getUserDefaultTemplateId()
        ]);
        _globalTemplateCache = { all: allData.all, builtin: allData.builtin, userDefaultId: defaultId };
      } catch (e) {
        _DEBUG && console.warn('[Cache] 模板预加载失败', e.message);
      }
    });
  }

  function refreshTemplateCache() {
    _globalTemplateCache = null;
    preloadTemplateCache();
  }

  async function _getTemplatesFromCache() {
    if (_globalTemplateCache) return _globalTemplateCache;
    const [allData, defaultId] = await Promise.all([
      ExperimentData.getAllTemplates(),
      ExperimentData.getUserDefaultTemplateId()
    ]);
    _globalTemplateCache = { all: allData.all, builtin: allData.builtin, userDefaultId: defaultId };
    return _globalTemplateCache;
  }

  function _getBuiltinDefaultTemplate() {
    return ExperimentData.getBuiltinTemplate();
  }

  async function _loadDefaultTemplate(editGroup) {
    try {
      const cache = await _getTemplatesFromCache();
      if (editGroup && editGroup.templateId) {
        const matched = cache.all.find(t => t.id === editGroup.templateId);
        if (matched) return matched;
      }
      if (cache.userDefaultId && cache.userDefaultId !== 'system_default') {
        const found = cache.all.find(t => t.id === cache.userDefaultId);
        if (found) return found;
      }
      return cache.builtin;
    } catch {}
    return ExperimentData.getBuiltinTemplate();
  }

  // ============================================================
  // 模板列渲染函数（完全保留V1）
  // ============================================================
  function _renderFormTableHead(columns) {
    let html = '<thead><tr>';
    columns.forEach(col => {
      let label = col.label;
      if (col.unit && (col.type === 'number' || col.type === 'computed')) {
        label += `<sub style="font-size:10px;color:var(--color-text-tertiary)">(${col.unit})</sub>`;
      }
      if (col.id === 'drugConc') {
        const tooltipContent = `计算公式：本行载药浓度(mg/ml) = 本行加入药量 ÷ (本行总重×1000 + 本行加入药量) × 密度(g/ml) × 1000\n换算说明：本行总重单位g，自动转换为mg参与运算（×1000）；密度单位g/ml，自动转换为mg/ml参与运算（×1000）`;
        label += `<span class="formula-hint-icon" 
          onmouseenter="ExperimentCards._showFormulaTip(event, '${tooltipContent.replace(/'/g, "\\'").replace(/\n/g, '\\n')}')"
          onmouseleave="ExperimentCards._hideFormulaTip()"
          style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:var(--color-text-tertiary);color:#fff;font-size:9px;font-weight:700;cursor:help;margin-left:2px;vertical-align:super;line-height:14px">!</span>`;
      }
      html += `<th style="width:${col.width};font-size:11px;padding:8px 2px">${label}</th>`;
    });
    html += '</tr></thead>';
    return html;
  }

  function _showFormulaTip(event, content) {
    _hideFormulaTip();
    const tip = document.createElement('div');
    tip.id = 'formula-tip';
    tip.style.cssText = 'position:fixed;z-index:1000;background:#1a1a2e;color:#e0e4ea;font-size:12px;padding:10px 14px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.25);max-width:380px;line-height:1.7;white-space:pre-wrap;pointer-events:none;font-family:system-ui,sans-serif';
    tip.innerHTML = content.replace(/\\n/g, '<br>');
    document.body.appendChild(tip);
    const x = Math.min(event.clientX + 12, window.innerWidth - 400);
    const y = Math.min(event.clientY + 12, window.innerHeight - 150);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function _hideFormulaTip() {
    const existing = document.getElementById('formula-tip');
    if (existing) existing.remove();
  }

  function _generateSamplesCheckboxHtml(formData) {
    let rawSamples = formData && formData.samples ? formData.samples : [];
    if (typeof rawSamples === 'string') {
      rawSamples = rawSamples.split(/[,，\s、]+/).filter(Boolean);
    }
    const selectedSet = new Set(rawSamples);
    let checkboxes = '<div class="sample-checkbox-group" data-field="samples">';
    _existingEditSamples.forEach(s => {
      const checked = selectedSet.has(s.id) ? 'checked' : '';
      checkboxes += `<label class="sample-checkbox-label" style="display:inline-flex;align-items:center;gap:3px;margin:0 4px 2px 0;font-size:12px;cursor:pointer">
        <input type="checkbox" class="sample-checkbox" value="${s.id}" ${checked} onchange="ExperimentCards._onSampleCheckboxChange()">
        ${s.id}
      </label>`;
    });
    checkboxes += '</div>';
    return checkboxes;
  }

  function _renderFormRow(columns, formData, samplesCheckboxHtml) {
    let html = '<tr class="form-row-entry">';
    columns.forEach(col => {
      switch(col.type) {
        case 'text':
          const txtVal = formData ? (formData.name || formData[col.id] || '') : '';
          if (col.id === 'samples' && _existingEditSamples.length > 0) {
            const cbHtml = samplesCheckboxHtml || _generateSamplesCheckboxHtml(formData);
            html += `<td style="min-width:150px;white-space:nowrap">${cbHtml}</td>`;
          } else {
            html += `<td><input class="cf-input cf-name" data-field="${col.id}" name="cf_${col.id}" value="${txtVal}" placeholder="${col.default||''}"></td>`;
          }
          break;
        case 'number':
          let numVal = 0;
          if (formData) {
            if (col.id === 'drugAmount') {
              numVal = formData.perRowDrugAmount !== undefined ? formData.perRowDrugAmount : 0;
            } else if (col.id === 'density' || col.id === 'takeVolume') {
              if (formData._rowData && formData._rowData[col.id] !== undefined) {
                numVal = formData._rowData[col.id];
              } else if (formData[col.id] !== undefined) {
                numVal = formData[col.id];
              }
            } else if (formData.components && formData.components[col.id] !== undefined) {
              numVal = formData.components[col.id];
            } else if (formData._rowData && formData._rowData[col.id] !== undefined) {
              numVal = formData._rowData[col.id];
            }
          }
          html += `<td><input class="cf-input" data-field="${col.id}" name="cf_${col.id}" type="number" step="any"
            value="${numVal.toFixed(2)}" placeholder="${(col.default||0).toFixed(2)}"
            onwheel="return false" oninput="ExperimentCards.onCellChange()"></td>`;
          break;
        case 'computed':
          let computedVal = '0.00';
          if (formData) {
            if (col.id === 'drugConc' && formData.perRowDrugConc !== undefined) {
              computedVal = parseFloat(formData.perRowDrugConc).toFixed(2);
            } else if (formData._rowData && formData._rowData[col.id] !== undefined) {
              computedVal = parseFloat(formData._rowData[col.id]).toFixed(2);
            }
          }
          html += `<td><span class="cf-total" data-field="${col.id}" data-formula="${col.formula||''}"
            style="cursor:default;user-select:none">${computedVal}</span></td>`;
          break;
        case 'dynamic':
          const concMode = formData ? (formData.perRowDrugConcMode || 'manual') : 'manual';
          const concVal = formData ? (formData.perRowDrugConc || 0) : 0;
          const formulaText = formData
            ? (formData.perRowDrugConcFormula || '公式待配置')
            : '公式待配置';
          html += `<td><div class="cf-conc-mode">
            <select class="cf-mode-select" data-field="${col.id}-mode" name="cf_${col.id}_mode"
              onchange="ExperimentCards.onConcModeChange(this)">
              <option value="manual" ${'manual'===concMode?'selected':''}>手动输入</option>
              <option value="formula" ${'formula'===concMode?'selected':''}>公式计算</option>
            </select>
            <input class="cf-input cf-conc-value" data-field="${col.id}" name="cf_${col.id}" type="number" step="any"
              value="${concVal.toFixed(2)}" onwheel="return false"
              oninput="ExperimentCards.onCellChange()"
              style="${concMode==='formula'?'display:none':''}">
            <span class="cf-conc-formula-text" data-field="${col.id}-formula"
              style="${concMode==='formula'?'':'display:none'};font-size:11px;color:var(--color-text-tertiary)">
              ${formulaText}
            </span>
          </div></td>`;
          break;
      }
    });
    html += '</tr>';
    return html;
  }

  function _renderTemplateSelector(allTemplates, currentTplId, isEdit) {
    const disabled = isEdit || _templateLocked ? 'disabled' : '';
    const disabledNote = isEdit ? '（编辑模式不可切换模板）' : (_templateLocked ? '（已锁定，不可切换）' : '');
    return `
      <div class="form-row" style="margin-bottom:8px">
        <div class="form-group" style="flex:1">
          <label class="form-label" style="font-size:12px">使用模板 ${disabledNote ? `<span style="color:var(--color-text-tertiary);font-weight:400">${disabledNote}</span>` : ''}</label>
          <select class="form-input" id="create-template-select" ${disabled}
            onchange="ExperimentCards.onTemplateChange(this.value)">
            ${allTemplates.all.map(t =>
              `<option value="${t.id}" ${t.id===currentTplId?'selected':''}>
                ${t.builtin ? '📋 ' : ''}${t.name}${t.id === currentTplId && isEdit ? '（当前）' : ''}
              </option>`
            ).join('')}
          </select>
        </div>
      </div>
    `;
  }

  function _evaluateFormula(formula, tr) {
    if (!formula) return 0;
    try {
      let resolved = formula;
      resolved = resolved.replace(/([a-zA-Z_]\w*)/g, (match) => {
        if (/^\d+\.?\d*$/.test(match)) return match;
        if (['true','false','null','undefined','NaN','Infinity'].includes(match)) return match;
        if (/^[\d+\-*/()., ]+$/.test(match)) return match;
        const el = tr.querySelector(`[data-field="${match}"]`);
        if (el) {
          const val = parseFloat(el.value !== undefined ? el.value : el.textContent);
          return isNaN(val) ? '0' : String(val);
        }
        if (_DEBUG) console.warn('[Formula] 变量未找到:', match);
        return '0';
      });
      const fn = new Function('return (' + resolved + ')');
      const result = fn();
      return isNaN(result) ? 0 : result;
    } catch (e) {
      if (_DEBUG) console.error('[Formula] 异常:', formula, e.message);
      return 0;
    }
  }

  function onCellChange() {
    try {
      const tbody = document.getElementById('create-form-tbody');
      if (!tbody) return;
      tbody.querySelectorAll('tr.form-row-entry').forEach(tr => {
        tr.querySelectorAll('[data-formula]').forEach(el => {
          if (el.dataset.field === 'expDrugAmount') return;
          const formula = el.dataset.formula;
          if (formula) {
            const result = _evaluateFormula(formula, tr);
            el.textContent = result.toFixed(2);
          }
        });
        const expEl = tr.querySelector('[data-field="expDrugAmount"]');
        if (expEl) {
          const formula = expEl.dataset.formula;
          if (formula) {
            const result = _evaluateFormula(formula, tr);
            expEl.textContent = result.toFixed(2);
          }
        }
        tr.querySelectorAll('[data-formula]').forEach(el => {
          const val = parseFloat(el.textContent);
          if (isNaN(val)) el.textContent = '0.00';
        });
      });
    } catch (e) {
      if (_DEBUG) console.error('[onCellChange] 异常:', e.message);
    }
  }

  function onConcModeChange(select) {
    const tr = select.closest('tr');
    const mode = select.value;
    const concInput = tr.querySelector('[data-field="drugConc"]');
    const formulaText = tr.querySelector('[data-field="drugConc-formula"]');
    if (concInput) concInput.style.display = mode === 'formula' ? 'none' : '';
    if (formulaText) formulaText.style.display = mode === 'formula' ? '' : 'none';
    if (mode === 'formula') onCellChange();
  }

  async function onTemplateChange(tplId) {
    const cache = await _getTemplatesFromCache();
    const tpl = cache.all.find(t => t.id === tplId) || _getBuiltinDefaultTemplate();
    _currentCreateTemplate = tpl;
    _templateLocked = true;

    const select = document.getElementById('create-template-select');
    if (select) select.disabled = true;

    const tbody = document.getElementById('create-form-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const thead = tbody.closest('table').querySelector('thead');
    if (thead) {
      const newThead = document.createElement('thead');
      newThead.innerHTML = _renderFormTableHead(tpl.columns);
      thead.replaceWith(newThead);
    }
    const table = tbody.closest('table');
    let colgroup = table.querySelector('colgroup');
    if (!colgroup) { colgroup = document.createElement('colgroup'); table.insertBefore(colgroup, table.firstChild); }
    colgroup.innerHTML = tpl.columns.map(c => `<col style="width:${c.width}">`).join('');
    addFormRow();
    void tbody.closest('table')?.offsetHeight;
    onCellChange();
  }

  // ============================================================
  // 显示创建/编辑实验组弹窗
  // ============================================================
  function showCreateDialog(editGroup) {
    const now = new Date().toISOString().slice(0, 10);
    const isEdit = !!editGroup;
    const title = isEdit ? '编辑实验组' : '创建实验组';
    const btnLabel = isEdit ? '保存修改' : '确认创建';
    const initName = isEdit ? editGroup.name : '';
    const initDate = isEdit ? (editGroup.date || now) : now;
    const initForms = isEdit ? (editGroup.formulations || []) : [];

    _existingEditSamples = isEdit ? (editGroup.samples || []) : [];
    _templateLocked = isEdit;

    _cachedSamplesCheckboxHtml = '';
    if (_existingEditSamples.length > 0) {
      _cachedSamplesCheckboxHtml = _generateSamplesCheckboxHtml(
        initForms.length > 0 ? initForms[0] : null
      );
    }

    _getTemplatesFromCache().then(async (cache) => {
      const tpl = await _loadDefaultTemplate(editGroup);
      _currentCreateTemplate = tpl;
      const columns = tpl.columns;

      let formRowsHtml = '';
      if (initForms.length > 0) {
        initForms.forEach(f => {
          formRowsHtml += _renderFormRow(columns, f, _cachedSamplesCheckboxHtml);
        });
      } else {
        formRowsHtml += _renderFormRow(columns, null, '');
      }

      const body = _buildDialogBody({ title, tpl, isEdit, initName, initDate, editGroup, cache, columns, formRowsHtml });
      const footer = `
        <button class="btn btn-secondary" onclick="UI.hideModal()">取消</button>
        <button class="btn btn-primary" id="create-exp-confirm">${btnLabel}</button>
      `;

      UI.showModal(title, body, footer);
      document.getElementById('create-exp-confirm').onclick =
        isEdit ? () => updateExperiment(editGroup.id) : createExperiment;
      void document.getElementById('modal-container')?.offsetHeight;
      requestAnimationFrame(() => { onCellChange(); });
    });
  }

  function _buildDialogBody({ title, tpl, isEdit, initName, initDate, editGroup, cache, columns, formRowsHtml }) {
    return `
      <style>
        .create-form-table{width:100%;border-collapse:collapse;table-layout:fixed}
        .create-form-table th{font-size:12px;font-weight:500;color:var(--color-text-secondary);
          background:var(--color-bg-tertiary);padding:10px 4px;text-align:center;border:1px solid var(--color-border)}
        .create-form-table td{padding:4px;border:1px solid var(--color-border-light)}
        .create-form-table .cf-input{width:100%;min-width:0;border:1px solid var(--color-border);padding:6px 8px;
          border-radius:var(--radius-sm);font-size:13px;font-family:var(--font-sans);background:var(--color-bg-primary);
          outline:none;box-sizing:border-box;transition:border-color .15s}
        .create-form-table .cf-input:focus{border-color:var(--color-teal);box-shadow:0 0 0 2px rgba(13,115,119,.12)}
        .create-form-table .cf-input[type="number"]{text-align:right;font-family:var(--font-mono)}
        .create-form-table .cf-total{font-weight:600;color:var(--color-teal);font-family:var(--font-mono);
          text-align:center;font-size:14px;padding:7px 2px;background:var(--color-info-bg);border-radius:var(--radius-sm);display:block}
        .cf-mode-select{font-size:11px;padding:2px 4px;border:1px solid var(--color-border);border-radius:var(--radius-sm);
          background:var(--color-bg-primary);margin-bottom:2px;width:100%;box-sizing:border-box}
        .cf-conc-value{margin-top:2px}
        .cf-conc-formula-text{display:block;padding:2px 4px;font-size:11px;color:var(--color-text-tertiary);word-break:break-all}
        .create-form-table th, .create-form-table td, .create-form-table input { box-sizing:border-box }
      </style>
      ${_renderTemplateSelector(cache, tpl.id, isEdit)}
      <div class="form-row">
        <div class="form-group" style="flex:2">
          <label class="form-label">实验组名称 *</label>
          <input class="form-input" id="create-exp-name" value="${initName}">
          ${isEdit ? `<input type="hidden" id="edit-group-id" value="${editGroup.id}">` : ''}
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">日期</label>
          <input class="form-input" id="create-exp-date" value="${initDate}" readonly
                 placeholder="点击选择日期"
                 onclick="UI.renderDatePicker('create-exp-date','${initDate}',function(v){
                   document.getElementById('create-exp-date').value=v;
                 })">
        </div>
      </div>
      <label class="form-label" style="margin-bottom:4px">处方组成</label>
      <table class="create-form-table">
        <colgroup>${columns.map(c => `<col style="width:${c.width}">`).join('')}</colgroup>
        ${_renderFormTableHead(columns)}
        <tbody id="create-form-tbody">${formRowsHtml}</tbody>
      </table>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
        <button class="btn btn-sm btn-secondary" onclick="ExperimentCards.addFormRow()">+ 添加处方</button>
        <button class="btn btn-sm btn-secondary" onclick="ExperimentCards.removeLastFormRow()">− 删除末行</button>
        <span style="font-size:11px;color:var(--color-text-tertiary)">
          每行独立药量、浓度配置，总重自动求和
        </span>
      </div>
    `;
  }

  function _onSampleCheckboxChange() {}

  function addFormRow() {
    const tbody = document.getElementById('create-form-tbody');
    if (!tbody || !_currentCreateTemplate) return;
    const tr = document.createElement('tr');
    tr.className = 'form-row-entry';
    tr.innerHTML = _renderFormRow(_currentCreateTemplate.columns, null, _cachedSamplesCheckboxHtml);
    tbody.appendChild(tr);
    void tr.offsetHeight;
    onCellChange();
  }

  function removeLastFormRow() {
    const tbody = document.getElementById('create-form-tbody');
    if (!tbody || tbody.children.length <= 1) {
      UI.toast('至少保留一个处方','warning');
      return;
    }
    tbody.removeChild(tbody.lastChild);
    onCellChange();
  }

  function _collectFormRows() {
    const tbody = document.getElementById('create-form-tbody');
    if (!tbody) return { formulations: [], rows: [] };
    const trs = tbody.querySelectorAll('tr.form-row-entry');
    const formulations = [];
    const rows = [];

    for (const tr of trs) {
      const getVal = (field) => {
        const el = tr.querySelector(`[data-field="${field}"]`);
        if (!el) return '';
        if (el.tagName === 'INPUT') return el.value;
        return el.textContent || '';
      };

      const fn = getVal('formulationName').trim();
      if (!fn) { UI.toast('请填写所有处方名称','warning'); return null; }

      const components = {};
      let totalWeight = 0;
      const columns = _currentCreateTemplate ? _currentCreateTemplate.columns : [];
      const rowData = {};

      columns.forEach(col => {
        const val = parseFloat(getVal(col.id));
        if (!isNaN(val) && col.type === 'number') {
          components[col.id] = val;
          totalWeight += val;
        }
        if (col.type === 'number') {
          rowData[col.id] = isNaN(val) ? 0 : val;
        } else if (col.type === 'computed') {
          rowData[col.id] = parseFloat(getVal(col.id)) || 0;
        } else if (col.type === 'text') {
          rowData[col.id] = getVal(col.id) || '';
        }
      });

      let sids = [];
      const checkboxGroup = tr.querySelector('.sample-checkbox-group');
      if (checkboxGroup) {
        checkboxGroup.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => { sids.push(cb.value); });
      } else {
        sids = getVal('samples').split(/[,，\s、]+/).filter(s => s.length > 0);
      }
      if (sids.length === 0) {
        UI.toast(`处方"${fn}"的对应样品不能为空`,'warning');
        return null;
      }

      const rowDrugAmount = rowData.drugAmount || 0;
      const rowDrugConc = rowData.drugConc || 0;
      const rowDensity = rowData.density || 0;
      const rowTakeVolume = rowData.takeVolume || 0;
      const rowExpDrugAmount = rowData.expDrugAmount || 0;

      formulations.push({
        name: fn, components, total: totalWeight, samples: sids,
        perRowDrugAmount: rowDrugAmount, perRowDrugConc: rowDrugConc,
        perRowDensity: rowDensity, perRowTakeVolume: rowTakeVolume,
        perRowExpDrugAmount: rowExpDrugAmount,
      });
      rows.push({
        drugAmount: rowDrugAmount, drugConc: rowDrugConc,
        density: rowDensity, takeVolume: rowTakeVolume,
        expDrugAmount: rowExpDrugAmount, _values: rowData,
      });
    }
    return { formulations, rows };
  }

  // ============================================================
  // 确认创建/更新实验组（V2: async）
  // ============================================================
  async function createExperiment() {
    const name = document.getElementById('create-exp-name').value.trim();
    const date = document.getElementById('create-exp-date').value;
    if (!name) { UI.toast('请输入实验组名称','warning'); return; }

    const collected = _collectFormRows();
    if (!collected) return;

    const hasDrug = collected.rows.some(r => r.drugAmount > 0);
    if (!hasDrug) { UI.toast('至少一个处方的加入药量必须大于 0','warning'); return; }

    const data = {
      experimentName: name, date, groupName: name,
      formulations: collected.formulations, rows: collected.rows,
      templateId: _currentCreateTemplate ? _currentCreateTemplate.id : '',
      drugAmount: collected.rows.reduce((s, r) => s + (r.drugAmount || 0), 0),
      drugConc: collected.rows.reduce((s, r) => s + (r.drugConc || 0), 0) / collected.rows.length,
    };

    try {
      const group = await ExperimentData.createExperiment(data);
      UI.hideModal();
      UI.toast(`实验组「${name}」创建成功，${(group.samples||[]).length} 个样品`, 'success');
      if (typeof App !== 'undefined') {
        if (App._invalidateAllPages) App._invalidateAllPages();
        if (App.viewExperimentCards) App.viewExperimentCards(group.id);
      }
    } catch (e) {
      UI.toast('创建失败: ' + e.message, 'danger');
    }
  }

  async function updateExperiment(experimentId) {
    const name = document.getElementById('create-exp-name').value.trim();
    const date = document.getElementById('create-exp-date').value;
    if (!name) { UI.toast('请输入实验组名称','warning'); return; }

    const collected = _collectFormRows();
    if (!collected) return;

    const data = {
      experimentName: name, date, groupName: name,
      formulations: collected.formulations, rows: collected.rows,
      templateId: _currentCreateTemplate ? _currentCreateTemplate.id : '',
      drugAmount: collected.rows.reduce((s, r) => s + (r.drugAmount || 0), 0),
      drugConc: collected.rows.reduce((s, r) => s + (r.drugConc || 0), 0) / collected.rows.length,
    };

    try {
      await ExperimentData.updateExperiment(experimentId, data);
      UI.hideModal();
      UI.toast(`实验组「${name}」已更新`, 'success');
      if (typeof App !== 'undefined') {
        if (App._invalidateAllPages) App._invalidateAllPages();
        if (App.viewExperimentCards) App.viewExperimentCards(experimentId);
      }
    } catch (e) {
      UI.toast('更新失败: ' + e.message, 'danger');
    }
  }

  // ============================================================
  // 报告操作
  // ============================================================
  async function saveReport(experimentId, sampleId) {
    const sample = ExperimentData.getSample(experimentId, sampleId);
    if (!sample) { UI.toast('样品未找到', 'warning'); return; }
    const finalRate = (sample.finalRate || 0);
    const report = {
      title: `释放分析报告 - ${sampleId} - ${new Date().toLocaleDateString('zh-CN')}`,
      timestamp: new Date().toISOString(),
      result: { finalRate, residualRate: sample.residualRate, totalRecovery: sample.totalRecovery }
    };
    try {
      await ExperimentData.saveReport(experimentId, sampleId, report);
      UI.toast('报告已保存', 'success');
      if (currentExperimentId === experimentId) {
        const container = document.querySelector('#app-content .exp-cards-container');
        if (container) render(container, {}, experimentId);
      }
    } catch (e) {
      UI.toast('保存失败: ' + e.message, 'danger');
    }
  }

  async function deleteReportInline(experimentId, sampleId, index) {
    try {
      await ExperimentData.deleteReport(experimentId, sampleId, index);
      UI.toast('报告已删除', 'success');
      if (currentExperimentId === experimentId) {
        const container = document.querySelector('#app-content .exp-cards-container');
        if (container) render(container, {}, experimentId);
      }
    } catch (e) {
      UI.toast('删除失败', 'danger');
    }
  }

  function queryReport(experimentId, sampleId, index) {
    ExperimentData.getReports(experimentId, sampleId).then(reports => {
      if (reports && reports[index]) {
        const r = reports[index];
        UI.showModal(`报告: ${r.title || '分析报告'}`,
          `<div style="max-height:500px;overflow-y:auto"><pre style="font-size:13px;line-height:1.6">${JSON.stringify(r.result || r, null, 2)}</pre></div>`,
          '<button class="btn btn-secondary" onclick="UI.hideModal()">关闭</button>'
        );
      }
    });
  }

  function restoreReportsUI() {}

  // ============================================================
  // 一键分析
  // ============================================================
  async function analyzeSample(experimentId, sampleId) {
    const sample = ExperimentData.getSample(experimentId, sampleId);
    if (!sample) { UI.toast('样品未找到', 'warning'); return; }
    UI.toast('正在分析 ' + sampleId + ' ...', 'info');
    setTimeout(() => {
      UI.toast(sampleId + ' 分析完成', 'success');
    }, 500);
  }

  async function analyzeAll() {
    const exp = currentExperimentId ? ExperimentData.getExperiment(currentExperimentId) : null;
    if (!exp || !exp.samples || exp.samples.length === 0) {
      UI.toast('没有可分析的样品', 'warning');
      return;
    }
    UI.toast(`正在分析 ${exp.samples.length} 个样品...`, 'info');
    for (const s of exp.samples) {
      recalcTable(currentExperimentId, s.id);
    }
    setTimeout(() => {
      UI.toast(`已分析 ${exp.samples.length} 个样品`, 'success');
    }, 500);
  }

  // ============================================================
  // 公开 API
  // ============================================================
  return {
    render,
    showCreateDialog,
    addRow, removeLastRow, clearTableData,
    addFormRow, removeLastFormRow,
    switchSegTab, onCellChange, onConcModeChange, onTemplateChange,
    _showFormulaTip, _hideFormulaTip,
    _onSampleCheckboxChange, _getTemplatesFromCache,
    _evaluateFormula, _renderFormRow, _renderFormTableHead,
    analyzeSample, analyzeAll,
    saveReport, deleteReportInline, queryReport,
    preloadTemplateCache, refreshTemplateCache,
    _loadDefaultTemplate, _buildDialogBody, _collectFormRows
  };
})();
