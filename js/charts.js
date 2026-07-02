/* ========================================
   charts.js — Chart.js 封装
   释放曲线、模型拟合图、处方饼图
   ======================================== */

const Charts = (() => {
  const instances = {};

  function destroy(id) {
    if (instances[id]) {
      instances[id].destroy();
      delete instances[id];
    }
  }

  // --- 释放曲线 ---
  function renderReleaseCurve(canvasId, datasets, options = {}) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const colors = ['#0d7377', '#1e3a5f', '#e74c3c', '#f39c12', '#27ae60', '#3498db', '#8e44ad'];

    const chartDatasets = datasets.map((ds, i) => ({
      label: ds.label || `曲线 ${i + 1}`,
      data: ds.timePoints.map((t, j) => ({ x: t, y: ds.cumulativeRelease[j] })),
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length] + '20',
      fill: false,
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 6
    }));

    instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: { datasets: chartDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: options.xLabel || '时间 (h)', font: { family: 'PingFang SC' } },
            min: 0
          },
          y: {
            title: { display: true, text: options.yLabel || '累积释放率 (%)', font: { family: 'PingFang SC' } },
            min: 0,
            max: 100
          }
        },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: t=${ctx.parsed.x}h, Q=${ctx.parsed.y}%`
            }
          }
        }
      }
    });

    return instances[canvasId];
  }

  // --- 模型拟合图 ---
  function renderModelFit(canvasId, timePoints, actualRelease, fitResults, options = {}) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const colors = { actual: '#0d7377', zero: '#e74c3c', first: '#f39c12', higuchi: '#27ae60', peppas: '#3498db', hixson: '#8e44ad' };

    const datasets = [{
      label: '实测值',
      data: timePoints.map((t, i) => ({ x: t, y: actualRelease[i] })),
      borderColor: colors.actual,
      backgroundColor: colors.actual + '20',
      fill: false,
      pointRadius: 5,
      pointHoverRadius: 7,
      borderWidth: 2
    }];

    for (const fit of fitResults) {
      if (fit.predicted) {
        datasets.push({
          label: `${fit.type} (R²=${fit.R2.toFixed(4)})`,
          data: timePoints.map((t, i) => ({ x: t, y: fit.predicted[i] })),
          borderColor: colors[fit.typeKey] || '#999',
          fill: false,
          pointRadius: 0,
          borderWidth: 1.5,
          borderDash: [5, 3]
        });
      }
    }

    instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { type: 'linear', title: { display: true, text: '时间 (h)' }, min: 0 },
          y: { title: { display: true, text: '累积释放率 (%)' }, min: 0, max: 100 }
        },
        plugins: { legend: { position: 'top' } }
      }
    });

    return instances[canvasId];
  }

  // --- 处方组成饼图 ---
  function renderFormulationPie(canvasId, components) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const labels = components.map(c => c.name);
    const data = components.map(c => c.amount);
    const colors = ['#0d7377', '#1e3a5f', '#e74c3c', '#f39c12', '#27ae60', '#3498db', '#8e44ad'];

    instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors.slice(0, data.length),
          borderWidth: 1,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${ctx.parsed} ${components[ctx.dataIndex].unit}`
            }
          }
        }
      }
    });

    return instances[canvasId];
  }

  // --- 对比条形图 (模型 R²) ---
  function renderModelR2Bar(canvasId, fitResults) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const labels = fitResults.map(f => f.type);
    const data = fitResults.map(f => f.R2);
    const bgColors = data.map(v => v >= 0.95 ? '#27ae60' : v >= 0.9 ? '#f39c12' : '#e74c3c');

    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'R²',
          data,
          backgroundColor: bgColors,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { min: 0, max: 1, title: { display: true, text: 'R²' } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `R² = ${ctx.parsed.y.toFixed(4)}`
            }
          }
        }
      }
    });

    return instances[canvasId];
  }

  return {
    destroy,
    renderReleaseCurve,
    renderModelFit,
    renderFormulationPie,
    renderModelR2Bar
  };
})();
