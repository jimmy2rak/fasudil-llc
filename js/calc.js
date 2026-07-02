/* ========================================
   calc.js — 计算引擎
   EE/DL、累积释放校正、5种释放动力学模型、f2、残留率
   ======================================== */

const Calc = (() => {

  // --- 包封率 EE% ---
  function calcEE(totalAmount, freeAmount) {
    const encapsulated = totalAmount - freeAmount;
    const EE = (encapsulated / totalAmount) * 100;
    return { totalAmount, freeAmount, encapsulated, EE: EE.toFixed(2) };
  }

  // --- 载药量 DL% ---
  function calcDL(encapsulatedAmount, totalFormulationWeight) {
    const DL = (encapsulatedAmount / totalFormulationWeight) * 100;
    return { encapsulatedAmount, totalFormulationWeight, DL: DL.toFixed(2) };
  }

  // --- 累积释放校正（取样补液） ---
  function calcCumulativeRelease(concentrations, vesselVolume, sampleVolume, initialDrugAmount) {
    // Qn = [Cn·V + Σ(i=1..n-1) Ci·Vs] / W₀ × 100
    const corrected = [];
    let cumulative = 0;

    for (let i = 0; i < concentrations.length; i++) {
      const Cn = concentrations[i];
      const currentAmount = Cn * vesselVolume;
      cumulative += currentAmount;

      // 加上之前所有取样中移除的药量
      let removedSum = 0;
      for (let j = 0; j < i; j++) {
        removedSum += concentrations[j] * sampleVolume;
      }

      const Qn = ((cumulative + removedSum) / initialDrugAmount) * 100;
      corrected.push(Math.min(Qn, 100)); // 不超过100%
    }

    return { concentrations, corrected, vesselVolume, sampleVolume, initialDrugAmount };
  }

  // --- 线性回归辅助 ---
  function linearRegression(xArr, yArr) {
    const n = xArr.length;
    if (n < 2) return null;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += xArr[i];
      sumY += yArr[i];
      sumXY += xArr[i] * yArr[i];
      sumX2 += xArr[i] * xArr[i];
      sumY2 += yArr[i] * yArr[i];
    }

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    // R² 计算
    const yMean = sumY / n;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
      const yPred = slope * xArr[i] + intercept;
      ssTot += (yArr[i] - yMean) ** 2;
      ssRes += (yArr[i] - yPred) ** 2;
    }
    const R2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

    return { slope, intercept, R2, n };
  }

  // --- 零级模型 ---
  function fitZeroOrder(timePoints, releasePercent) {
    const reg = linearRegression(timePoints, releasePercent);
    if (!reg) return null;

    const predicted = timePoints.map(t => reg.slope * t + reg.intercept);
    return {
      type: '零级模型',
      typeKey: 'zero',
      equation: `Q = ${reg.intercept.toFixed(4)} + ${reg.slope.toFixed(4)}·t`,
      params: { k0: reg.slope, Q0: reg.intercept },
      R2: reg.R2,
      predicted,
      n: reg.n
    };
  }

  // --- 一级模型 ---
  function fitFirstOrder(timePoints, releasePercent) {
    const y = releasePercent.map(Q => Math.log(100 - Q));
    const validIndices = y.map((v, i) => !isNaN(v) && 100 - releasePercent[i] > 0 ? i : -1).filter(i => i >= 0);

    if (validIndices.length < 2) return null;

    const x = validIndices.map(i => timePoints[i]);
    const yValid = validIndices.map(i => y[i]);

    const reg = linearRegression(x, yValid);
    if (!reg) return null;

    const k1 = -reg.slope;
    const predicted = timePoints.map(t => 100 - (100 - reg.intercept) * Math.exp(-k1 * t));

    return {
      type: '一级模型',
      typeKey: 'first',
      equation: `ln(100-Q) = ${reg.intercept.toFixed(4)} - ${k1.toFixed(4)}·t`,
      params: { k1 },
      R2: reg.R2,
      predicted,
      n: reg.n
    };
  }

  // --- Higuchi ---
  function fitHiguchi(timePoints, releasePercent) {
    const sqrtT = timePoints.map(t => Math.sqrt(t));
    const reg = linearRegression(sqrtT, releasePercent);
    if (!reg) return null;

    const predicted = timePoints.map(t => reg.slope * Math.sqrt(t) + reg.intercept);
    return {
      type: 'Higuchi',
      typeKey: 'higuchi',
      equation: `Q = ${reg.intercept.toFixed(4)} + ${reg.slope.toFixed(4)}·√t`,
      params: { kH: reg.slope },
      R2: reg.R2,
      predicted,
      n: reg.n
    };
  }

  // --- Korsmeyer-Peppas ---
  function fitPeppas(timePoints, releasePercent) {
    // 取前60%释放数据
    const cutoff = 60;
    const indices = [];
    for (let i = 0; i < releasePercent.length; i++) {
      if (releasePercent[i] <= cutoff && timePoints[i] > 0 && releasePercent[i] > 0) {
        indices.push(i);
      }
    }

    if (indices.length < 2) return null;

    const lnT = indices.map(i => Math.log(timePoints[i]));
    const lnQ = indices.map(i => Math.log(releasePercent[i]));

    const reg = linearRegression(lnT, lnQ);
    if (!reg) return null;

    const n = reg.slope;
    const kKP = Math.exp(reg.intercept);
    let mechanism = '';
    if (n < 0.45) mechanism = 'Fickian扩散';
    else if (n <= 0.89) mechanism = '异常转运（扩散+溶蚀）';
    else mechanism = 'Case II转运（溶蚀主导）';

    const predicted = timePoints.map(t => kKP * Math.pow(t, n));

    return {
      type: 'Korsmeyer-Peppas',
      typeKey: 'peppas',
      equation: `Q = ${kKP.toFixed(4)}·t^${n.toFixed(4)}`,
      params: { kKP, n, mechanism },
      R2: reg.R2,
      predicted,
      n: reg.n
    };
  }

  // --- Hixson-Crowell ---
  function fitHixsonCrowell(timePoints, releasePercent) {
    const y = releasePercent.map(Q => Math.pow(100, 1/3) - Math.pow(100 - Q, 1/3));
    const validIndices = y.map((v, i) => !isNaN(v) && 100 - releasePercent[i] > 0 ? i : -1).filter(i => i >= 0);

    if (validIndices.length < 2) return null;

    const x = validIndices.map(i => timePoints[i]);
    const yValid = validIndices.map(i => y[i]);

    const reg = linearRegression(x, yValid);
    if (!reg) return null;

    const kHC = reg.slope;
    const predicted = timePoints.map(t => 100 - Math.pow(Math.pow(100, 1/3) - kHC * t, 3));

    return {
      type: 'Hixson-Crowell',
      typeKey: 'hixson',
      equation: `100^(1/3) - (100-Q)^(1/3) = ${reg.intercept.toFixed(4)} + ${kHC.toFixed(4)}·t`,
      params: { kHC },
      R2: reg.R2,
      predicted,
      n: reg.n
    };
  }

  // --- 全部模型拟合 ---
  function fitAllModels(timePoints, releasePercent) {
    const models = [
      fitZeroOrder(timePoints, releasePercent),
      fitFirstOrder(timePoints, releasePercent),
      fitHiguchi(timePoints, releasePercent),
      fitPeppas(timePoints, releasePercent),
      fitHixsonCrowell(timePoints, releasePercent)
    ].filter(m => m !== null);

    // 找最佳模型（R² 最高）
    const best = models.reduce((best, m) => m.R2 > best.R2 ? m : best, models[0]);

    return { models, bestModel: best };
  }

  // --- f2 相似因子 ---
  function calcF2(refTimePoints, refRelease, testTimePoints, testRelease) {
    // 对齐时间点（取交集）
    const commonTimes = refTimePoints.filter(t => testTimePoints.includes(t));

    if (commonTimes.length < 3) {
      return { f2: null, note: '时间点不足（至少需要3个公共时间点）' };
    }

    const refAtCommon = commonTimes.map(t => refRelease[refTimePoints.indexOf(t)]);
    const testAtCommon = commonTimes.map(t => testRelease[testTimePoints.indexOf(t)]);

    const n = commonTimes.length;
    let sumDiffSq = 0;
    for (let i = 0; i < n; i++) {
      sumDiffSq += (refAtCommon[i] - testAtCommon[i]) ** 2;
    }

    const f2 = 50 * Math.log10(100 / Math.sqrt(1 + sumDiffSq / n));
    const similar = f2 >= 50;

    return {
      f2: f2.toFixed(2),
      similar,
      interpretation: similar ? '两条释放曲线相似 (f2≥50)' : '两条释放曲线差异显著 (f2<50)',
      commonTimes,
      refAtCommon,
      testAtCommon
    };
  }

  // --- 释放残留率 ---
  function calcResidualRate(initialAmount, remainingAmount) {
    const rate = (remainingAmount / initialAmount) * 100;
    return {
      initialAmount,
      remainingAmount,
      residualRate: rate.toFixed(2),
      releasedPercent: (100 - rate).toFixed(2)
    };
  }

  // --- AIC/BIC 计算（高级选项） ---
  function calcAIC(R2, n, k) {
    // AIC = n·ln(SSres/n) + 2k
    const SSres = (1 - R2); // 简化
    const AIC = n * Math.log(SSres / n) + 2 * k;
    return AIC;
  }

  function calcBIC(R2, n, k) {
    const SSres = (1 - R2);
    const BIC = n * Math.log(SSres / n) + k * Math.log(n);
    return BIC;
  }

  return {
    calcEE,
    calcDL,
    calcCumulativeRelease,
    fitZeroOrder,
    fitFirstOrder,
    fitHiguchi,
    fitPeppas,
    fitHixsonCrowell,
    fitAllModels,
    calcF2,
    calcResidualRate,
    calcAIC,
    calcBIC,
    linearRegression
  };
})();
