/* ========================================
   ml.js — 自学习规则引擎 + 模式识别
   规则匹配、趋势检测、异常检测、建议生成
   ======================================== */

const ML = (() => {
  let rules = [];

  // --- 加载规则 ---
  async function loadRules() {
    try {
      const rulesData = await FSManager.getRules();
      rules = rulesData.data.rules || [];
    } catch (e) {
      rules = [];
    }
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

  // --- 智能建议生成 ---
  async function generateSuggestions() {
    const experiments = await FSManager.listExperiments();
    const suggestions = [];

    // 基于实验数量的建议
    if (experiments.length === 0) {
      suggestions.push({ priority: 1, message: '开始第一个实验！上传你的 xlsx/PDF 数据文件即可自动分析。', action: 'upload' });
    }

    // 检查每个实验的规则匹配
    for (const exp of experiments) {
      try {
        const expData = {};
        // 加载释放数据
        try {
          const releaseJson = await FSManager.readJSON(`experiments/${exp.id}/release.json`);
          if (releaseJson.data.timePoints.length > 0) {
            expData.release = releaseJson.data;
          }
        } catch (e) { /* 无释放数据 */ }

        try {
          const fitJson = await FSManager.readJSON(`experiments/${exp.id}/release-fit.json`);
          if (fitJson.data.bestModel) {
            expData.releaseFit = fitJson.data;
          }
        } catch (e) { /* 无拟合数据 */ }

        try {
          const calcJson = await FSManager.readJSON(`experiments/${exp.id}/calculations.json`);
          for (const item of calcJson.data.items) {
            if (item.type === 'ee_dl') expData.ee_dl = item.results;
          }
        } catch (e) { /* 无计算数据 */ }

        const alerts = evaluateRules(expData);
        for (const alert of alerts) {
          suggestions.push({ priority: 2, experiment: exp.name, message: alert.message, severity: alert.severity });
        }

        // 释放曲线模式识别
        if (expData.release) {
          const patterns = detectPatterns(expData.release.timePoints, expData.release.cumulativeRelease);
          for (const pattern of patterns) {
            suggestions.push({ priority: 3, experiment: exp.name, message: `模式: ${pattern.description}`, severity: 'info' });
          }
        }
      } catch (e) {
        console.warn(`生成建议时出错: ${exp.id}`, e);
      }
    }

    // 按优先级排序
    suggestions.sort((a, b) => a.priority - b.priority);
    return suggestions.slice(0, 5); // 最多5条建议
  }

  // --- 用户经验提炼为规则 ---
  async function addRule(condition, suggestion, severity) {
    const rulesData = await FSManager.getRules();
    const newRule = {
      id: `R${String(rulesData.data.rules.length + 1).padStart(3, '0')}`,
      name: condition,
      condition: condition,
      suggestion: suggestion,
      severity: severity || 'info',
      enabled: true
    };
    rulesData.data.rules.push(newRule);
    rulesData._updatedAt = new Date().toISOString();
    await FSManager.writeJSON('rules.json', rulesData);
    rules = rulesData.data.rules;
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
