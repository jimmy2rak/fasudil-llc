/* ========================================
   ml.js — 自学习规则引擎 + 模式识别
   规则匹配、趋势检测、异常检测、建议生成
   V2: 移除 FSManager 依赖，改用 ExperimentData API
   ======================================== */

const ML = (() => {
  let rules = [];

  // --- 加载规则（从知识库 API 或内置规则） ---
  async function loadRules() {
    try {
      // 尝试从 API 加载用户自定义规则
      const res = await fetch('/api/data/knowledge?type=rule', {
        credentials: 'same-origin',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (res && res.ok) {
        const d = await res.json();
        if (d.data && Array.isArray(d.data)) {
          rules = d.data.map(entry => ({
            id: entry.id,
            name: entry.title || '',
            condition: entry.content?.condition || '',
            suggestion: entry.content?.suggestion || '',
            severity: entry.content?.severity || 'info',
            enabled: true
          }));
          return;
        }
      }
    } catch (e) {
      // 静默失败
    }
    // 使用内置默认规则
    rules = [
      { id: 'R001', name: '突释过高', condition: 'release2h > 30', suggestion: '建议包衣或降低表面药物', severity: 'warning', enabled: true },
      { id: 'R002', name: '突释过低', condition: 'release2h < 5', suggestion: '检查药物晶型或溶解性', severity: 'info', enabled: true },
      { id: 'R003', name: '平台期', condition: 'avgIncrement < 2 && totalRelease < 80', suggestion: '载体束缚过强', severity: 'warning', enabled: true },
      { id: 'R004', name: '包封率偏低', condition: 'EE < 60', suggestion: '优化药物-脂质比例', severity: 'warning', enabled: true },
      { id: 'R005', name: '载药量偏高', condition: 'DL > 15', suggestion: '突释风险增加', severity: 'info', enabled: true },
      { id: 'R006', name: '模型拟合不佳', condition: 'R2 < 0.95', suggestion: '检查数据质量', severity: 'warning', enabled: true }
    ];
  }

  // --- 规则匹配 ---
  function evaluateRules(experimentData) {
    const alerts = [];

    // 1. 突释检测
    if (experimentData.release && experimentData.release.timePoints && experimentData.release.cumulativeRelease) {
      const tp = experimentData.release.timePoints;
      const cr = experimentData.release.cumulativeRelease;

      // 找 2h 附近的释放率
      const idx2h = tp.findIndex(t => t >= 2);
      if (idx2h >= 0) {
        const release2h = cr[idx2h];
        if (release2h > 30) {
          alerts.push({ severity: 'warning', rule: 'R001', message: `突释过高: 2h释放${release2h.toFixed(1)}% > 30%，建议包衣或降低表面药物`, icon: '▲' });
        }
        if (release2h < 5) {
          alerts.push({ severity: 'info', rule: 'R002', message: `突释过低: 2h释放${release2h.toFixed(1)}% < 5%，检查药物晶型或溶解性`, icon: '▼' });
        }
      }

      // 3. 平台期检测
      const idx12h = tp.findIndex(t => t >= 12);
      if (idx12h >= 0) {
        const lastFew = cr.slice(-3);
        const increments = [];
        for (let i = 1; i < lastFew.length; i++) {
          increments.push(lastFew[i] - lastFew[i - 1]);
        }
        const avgIncrement = increments.reduce((a, b) => a + b, 0) / increments.length;
        const totalRelease = cr[cr.length - 1];
        if (avgIncrement < 2 && totalRelease < 80) {
          alerts.push({ severity: 'warning', rule: 'R003', message: `平台期: 12h后平均增量${avgIncrement.toFixed(2)}%，总释放${totalRelease.toFixed(1)}%，载体束缚过强`, icon: '■' });
        }
      }
    }

    // 4. EE 检测
    if (experimentData.ee_dl && experimentData.ee_dl.EE) {
      const ee = parseFloat(experimentData.ee_dl.EE);
      if (ee < 60) {
        alerts.push({ severity: 'warning', rule: 'R004', message: `包封率偏低: EE=${ee.toFixed(1)}% < 60%，优化药物-脂质比例`, icon: '◆' });
      }
    }

    // 5. DL 检测
    if (experimentData.ee_dl && experimentData.ee_dl.DL) {
      const dl = parseFloat(experimentData.ee_dl.DL);
      if (dl > 15) {
        alerts.push({ severity: 'info', rule: 'R005', message: `载药量偏高: DL=${dl.toFixed(1)}% > 15%，突释风险增加`, icon: '●' });
      }
    }

    // 6. R² 检测
    if (experimentData.releaseFit && experimentData.releaseFit.bestModel) {
      const r2 = experimentData.releaseFit.bestModel.R2;
      if (r2 < 0.95) {
        alerts.push({ severity: 'warning', rule: 'R006', message: `模型拟合不佳: 最佳R²=${r2.toFixed(4)} < 0.95，检查数据质量`, icon: '☆' });
      }
    }

    return alerts;
  }

  // --- 模式识别 ---
  function detectPatterns(timePoints, cumulativeRelease) {
    const patterns = [];

    // 趋势检测：释放速率变化
    if (timePoints.length < 3) return patterns;

    const rates = [];
    for (let i = 1; i < cumulativeRelease.length; i++) {
      const dt = timePoints[i] - timePoints[i - 1];
      const dQ = cumulativeRelease[i] - cumulativeRelease[i - 1];
      rates.push({ time: timePoints[i], rate: dQ / dt });
    }

    // 找拐点（释放速率突变）
    const rateChanges = [];
    for (let i = 1; i < rates.length; i++) {
      const change = rates[i].rate - rates[i - 1].rate;
      rateChanges.push({ time: rates[i].time, change });
    }

    const maxChange = rateChanges.reduce((max, rc) => Math.abs(rc.change) > Math.abs(max.change) ? rc : max, { change: 0 });
    if (Math.abs(maxChange.change) > 5) {
      patterns.push({ type: '拐点', time: maxChange.time, description: `t=${maxChange.time}h处释放速率突变${maxChange.change.toFixed(2)}%/h` });
    }

    // 平台期检测
    const lastRate = rates.slice(-3);
    const avgLastRate = lastRate.reduce((sum, r) => sum + r.rate, 0) / lastRate.length;
    if (avgLastRate < 1 && cumulativeRelease[cumulativeRelease.length - 1] < 80) {
      patterns.push({ type: '平台期', description: `后期平均释放速率${avgLastRate.toFixed(2)}%/h，释放趋于停滞` });
    }

    // 异常检测 (IQR)
    const Q1 = percentile(cumulativeRelease, 25);
    const Q3 = percentile(cumulativeRelease, 75);
    const IQR = Q3 - Q1;
    const lowerBound = Q1 - 1.5 * IQR;
    const upperBound = Q3 + 1.5 * IQR;

    for (let i = 0; i < cumulativeRelease.length; i++) {
      if (cumulativeRelease[i] < lowerBound || cumulativeRelease[i] > upperBound) {
        patterns.push({ type: '异常值', time: timePoints[i], value: cumulativeRelease[i], description: `t=${timePoints[i]}h处释放率${cumulativeRelease[i].toFixed(1)}%可能异常` });
      }
    }

    return patterns;
  }

  function percentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
  }

  // --- 智能建议生成（V2: 使用 ExperimentData API） ---
  async function generateSuggestions() {
    const suggestions = [];

    // 获取实验列表
    let experiments = [];
    try {
      experiments = await ExperimentData.getAllExperiments();
    } catch (e) {
      return suggestions;
    }

    // 基于实验数量的建议
    if (experiments.length === 0) {
      suggestions.push({ priority: 1, message: '开始第一个实验！上传你的 xlsx/PDF 数据文件即可自动分析。', action: 'upload' });
      return suggestions;
    }

    // 检查每个实验的规则匹配
    for (const exp of experiments) {
      try {
        const expData = {};

        // 检查每个样品的释放数据
        for (const s of (exp.samples || [])) {
          const saved = ExperimentData.getSavedTableData(exp.id, s.id);
          if (saved && saved.timePoints && saved.timePoints.length > 0) {
            // 计算累计释放率
            const absVals = saved.absorbance || [];
            if (absVals.length > 0) {
              const concs = absVals.map(a => 2 * (a - 0.00414128) / 0.0136697);
              const tv = saved.totalVols[0] || 30, sv = saved.sampleVols[0] || 2;
              const cum = [];
              for (let i = 0; i < concs.length; i++) {
                let ss = 0;
                for (let j = 0; j < i; j++) ss += concs[j] * sv;
                cum.push((concs[i] * tv + ss) / 1000);
              }
              const drugAmount = s.expDrugAmount !== undefined ? s.expDrugAmount : (s.totalDrug || 0);
              const rates = cum.map(c => drugAmount > 0 ? (c / drugAmount) * 100 : 0);

              expData.release = {
                timePoints: saved.timePoints.map(t => parseFloat(t) || 0),
                cumulativeRelease: rates
              };
            }
          }

          // EE/DL 检测
          if (s.eeData) expData.ee_dl = s.eeData;
        }

        if (expData.release) {
          const alerts = evaluateRules(expData);
          for (const alert of alerts) {
            suggestions.push({ priority: 2, experiment: exp.name, message: alert.message, severity: alert.severity });
          }

          // 释放曲线模式识别
          const patterns = detectPatterns(expData.release.timePoints, expData.release.cumulativeRelease);
          for (const pattern of patterns) {
            suggestions.push({ priority: 3, experiment: exp.name, message: `模式: ${pattern.description}`, severity: 'info' });
          }
        }
      } catch (e) {
        console.warn(`生成建议时出错: ${exp.id}`, e.message);
      }
    }

    // 按优先级排序
    suggestions.sort((a, b) => a.priority - b.priority);
    return suggestions.slice(0, 5); // 最多5条建议
  }

  // --- 用户经验提炼为规则（V2: 使用 knowledge API） ---
  async function addRule(condition, suggestion, severity) {
    const newRule = {
      id: `R${String(rules.length + 1).padStart(3, '0')}`,
      name: condition,
      condition: condition,
      suggestion: suggestion,
      severity: severity || 'info',
      enabled: true
    };

    try {
      await fetch('/api/data/knowledge', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'rule',
          title: condition,
          content: { condition, suggestion, severity: severity || 'info' },
          tags: ['auto-rule']
        })
      });
    } catch (e) {
      console.warn('[ML] 保存规则到API失败:', e.message);
    }

    rules.push(newRule);
    return newRule;
  }

  return {
    loadRules,
    evaluateRules,
    detectPatterns,
    generateSuggestions,
    addRule,
    getRules: () => rules
  };
})();
