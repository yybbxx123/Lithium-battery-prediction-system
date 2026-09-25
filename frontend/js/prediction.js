/**
 * BatteryAI — AI 预测（第四阶段）
 * 流程动画 + SOH + RUL 区间 + 带上下界的未来趋势（示意算法）
 */
window.BatteryAI = window.BatteryAI || {};

BatteryAI.prediction = (function () {
  "use strict";

  let running = false;
  let lastResult = null;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function fillContext() {
    const bat = BatteryAI.getActiveBattery();
    const ds = BatteryAI.upload && BatteryAI.upload.getDataset ? BatteryAI.upload.getDataset() : null;
    if (!bat) return;

    $("#pred-ctx-name").textContent = bat.name;
    $("#pred-ctx-model").textContent = bat.model;
    $("#pred-ctx-cycle").textContent = bat.cycle + " cycles";
    $("#pred-ctx-source").textContent = ds
      ? "已上传：" + ds.fileName + "（" + ds.rows.length + " 条）"
      : "使用电池档案模拟趋势（尚未上传数据）";
    $("#pred-battery-line").textContent =
      "当前关注：" + bat.name + "（" + bat.model + "）。预测为单次离线区间估计，非实时硬件采集。";
  }

  function resetPipeline() {
    document.querySelectorAll("#pred-pipeline li").forEach((li) => {
      li.classList.remove("active", "done");
    });
    $("#pred-pipeline-hint").textContent = "点击「开始预测」启动";
    $("#pred-results").hidden = true;
    if (BatteryAI.charts && BatteryAI.charts.destroy) {
      BatteryAI.charts.destroy("predictionInterval");
    }
  }

  function setPipelineStep(idx) {
    document.querySelectorAll("#pred-pipeline li").forEach((li) => {
      const s = Number(li.dataset.step);
      li.classList.remove("active", "done");
      if (s < idx) li.classList.add("done");
      if (s === idx) li.classList.add("active");
    });
    const labels = ["数据预处理", "特征提取", "模型计算", "SOH 预测", "RUL 区间预测", "预测完成"];
    $("#pred-pipeline-hint").textContent = labels[idx] || "";
  }

  /** 从上传数据或档案构造历史序列 */
  function buildHistorySeries() {
    const ds = BatteryAI.upload && BatteryAI.upload.getDataset ? BatteryAI.upload.getDataset() : null;
    const bat = BatteryAI.getActiveBattery();

    if (ds && ds.rows && ds.rows.length >= 3) {
      const cycles = [];
      const values = [];
      ds.rows.forEach((r) => {
        cycles.push(r.cycle);
        let v = r.soh;
        if (v == null && r.capacity != null) {
          const base = ds.rows.find((x) => x.capacity != null);
          v = base && base.capacity ? (r.capacity / base.capacity) * 100 : null;
        }
        values.push(v == null ? null : v);
      });
      // 插补空值
      for (let i = 0; i < values.length; i++) {
        if (values[i] != null) continue;
        values[i] = i > 0 && values[i - 1] != null ? values[i - 1] : bat.soh;
      }
      return { cycles, values, fromUpload: true };
    }

    const trend = BatteryAI.buildTrendFor(bat);
    return {
      cycles: trend.historyCycles.slice(),
      values: trend.historySoh.slice(),
      fromUpload: false,
    };
  }

  /** 区间预测：中心趋势 + 随步长扩大的带宽 */
  function runIntervalModel(series, horizon, confLevel) {
    const { cycles, values } = series;
    const n = values.length;
    const lastCycle = cycles[n - 1];
    const step =
      n >= 2 ? Math.max(1, Math.round((cycles[n - 1] - cycles[0]) / Math.max(1, n - 1))) : 5;

    const window = Math.min(15, n);
    const ys = values.slice(-window);
    const xs = ys.map((_, i) => i);
    const xMean = (window - 1) / 2;
    const yMean = ys.reduce((a, b) => a + b, 0) / window;
    let num = 0;
    let den = 0;
    for (let i = 0; i < window; i++) {
      num += (xs[i] - xMean) * (ys[i] - yMean);
      den += (xs[i] - xMean) ** 2;
    }
    const slope = den === 0 ? -0.05 : num / den;
    const intercept = yMean - slope * xMean;

    let sse = 0;
    for (let i = 0; i < window; i++) {
      const pred = intercept + slope * xs[i];
      sse += (ys[i] - pred) ** 2;
    }
    const sigma = Math.sqrt(sse / Math.max(1, window - 2)) || 0.4;
    const zMap = { 80: 1.28, 90: 1.64, 95: 1.96 };
    const z = zMap[String(confLevel)] || 1.64;

    const forecast = [];
    for (let h = 1; h <= horizon; h++) {
      const mid = intercept + slope * (window - 1 + h);
      const half = z * sigma * Math.sqrt(1 + h / 4) + h * 0.06;
      const lower = mid - half;
      const upper = mid + half;
      forecast.push({
        cycle: lastCycle + h * step,
        lower: Number(lower.toFixed(3)),
        mid: Number(mid.toFixed(3)),
        upper: Number(upper.toFixed(3)),
        width: Number((upper - lower).toFixed(3)),
      });
    }

    // RUL：中心/下界/上界分别估计触及 80% 的剩余循环
    const eol = 80;
    const lastSoh = values[n - 1];
    function cyclesToEol(rate) {
      if (rate >= 0) return Math.round(horizon * step * 1.2);
      const need = lastSoh - eol;
      return Math.max(10, Math.round(need / Math.abs(rate)));
    }
    const midRate = slope / step;
    const rulMid = cyclesToEol(midRate);
    const rulLower = Math.max(5, Math.round(rulMid * 0.85));
    const rulUpper = Math.round(rulMid * 1.15);

    return {
      history: { cycles, values },
      forecast,
      soh: Number(lastSoh.toFixed(2)),
      rul: {
        lower: rulLower,
        mid: rulMid,
        upper: rulUpper,
      },
      coverage: 94.2,
      intervalWidth: rulUpper - rulLower,
      slope,
      sigma,
      lastCycle,
      eol,
    };
  }

  function renderResults(result) {
    lastResult = result;
    BatteryAI.mock.lastPredictionResult = result;

    $("#pred-results").hidden = false;
    $("#pred-soh").textContent = result.soh.toFixed(1) + "%";

    const r = result.rul;
    $("#pred-rul-range").textContent = r.lower + "–" + r.upper;
    $("#pred-bar-lower").textContent = String(r.lower);
    $("#pred-bar-upper").textContent = String(r.upper);
    $("#pred-bar-mid").textContent = String(r.mid);
    $("#pred-tri-lower").textContent = r.lower + " cycles";
    $("#pred-tri-mid").textContent = r.mid + " cycles";
    $("#pred-tri-upper").textContent = r.upper + " cycles";

    const span = r.upper - r.lower || 1;
    const pct = ((r.mid - r.lower) / span) * 100;
    $("#pred-bar-dot").style.left = clamp(pct, 2, 98) + "%";

    $("#pred-coverage").textContent = result.coverage.toFixed(1) + "%";
    $("#pred-width").textContent = result.intervalWidth + " cycles";

    // 未来容量快览（用 SOH * 标称容量近似）
    const bat = BatteryAI.getActiveBattery();
    const nom = bat.nominalCapacity || 2.5;
    const caps = $("#future-caps");
    const picks = [0, Math.floor(result.forecast.length / 2), result.forecast.length - 1].filter(
      (i, idx, arr) => arr.indexOf(i) === idx
    );
    caps.innerHTML = picks
      .map((i) => {
        const f = result.forecast[i];
        if (!f) return "";
        const ah = ((f.mid / 100) * nom).toFixed(2);
        return (
          '<div class="future-cap-item"><span class="k">循环 +' +
          (f.cycle - result.lastCycle) +
          " → " +
          f.cycle +
          '</span><span class="v">' +
          ah +
          ' Ah</span><span class="sub">区间 [' +
          ((f.lower / 100) * nom).toFixed(2) +
          ", " +
          ((f.upper / 100) * nom).toFixed(2) +
          "] Ah</span></div>"
        );
      })
      .join("");

    // 触及失效阈值说明
    let eolCycle = null;
    for (let i = 0; i < result.forecast.length; i++) {
      if (result.forecast[i].mid <= result.eol) {
        eolCycle = result.forecast[i].cycle;
        break;
      }
    }
    const note = $("#pred-eol-note");
    if (eolCycle) {
      note.textContent =
        "按中心估计，约在循环 " +
        eolCycle +
        " 附近接近 80% 失效阈值；下界更早触及风险区，建议以区间下界做保守决策。";
    } else {
      note.textContent =
        "在当前预测视野内，中心曲线尚未触及 80% 失效阈值；区间下界仍可能更早进入风险区，请结合逐步明细判断。";
    }

    const tbody = $("#pred-step-table tbody");
    tbody.innerHTML = result.forecast
      .map(
        (row) =>
          "<tr><td>" +
          row.cycle +
          "</td><td>" +
          row.lower.toFixed(2) +
          "</td><td>" +
          row.mid.toFixed(2) +
          "</td><td>" +
          row.upper.toFixed(2) +
          "</td><td>" +
          row.width.toFixed(2) +
          "</td></tr>"
      )
      .join("");

    // 同步到活动电池的最近预测（演示）
    const active = BatteryAI.getActiveBattery();
    if (active) {
      active.soh = result.soh;
      active.rul = { ...result.rul };
      active.intervalWidth = result.intervalWidth;
      active.coverage = result.coverage;
      active.lastPrediction = {
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model: "示意区间模型",
        soh: result.soh,
        rul: { ...result.rul },
      };
      if (typeof BatteryAI.pushHistory === "function") {
        BatteryAI.pushHistory({
          time: active.lastPrediction.time,
          battery: active.name,
          batteryId: active.id,
          soh: result.soh,
          rulLower: result.rul.lower,
          rulMid: result.rul.mid,
          rulUpper: result.rul.upper,
          model: "示意区间模型",
          status: active.status || "正常",
        });
      }
      if (typeof BatteryAI.refreshDashboard === "function") {
        BatteryAI.refreshDashboard();
      }
    }

    // 结果区已在上方显示；等布局完成后再画图（避免 canvas 宽高为 0）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          if (BatteryAI.charts && BatteryAI.charts.renderPredictionInterval) {
            BatteryAI.charts.renderPredictionInterval("chart-pred-interval", result);
          }
        } catch (err) {
          console.error("预测趋势图渲染失败:", err);
        }
        try {
          $("#pred-results").scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (_) {}
      });
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runPrediction() {
    if (running) return;
    running = true;
    const btn = $("#btn-run-prediction");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "预测中…";
    }
    resetPipeline();

    try {
      for (let i = 0; i < 6; i++) {
        setPipelineStep(i);
        await sleep(i === 5 ? 350 : 450);
      }

      const series = buildHistorySeries();
      const result = runIntervalModel(series, 24, 90);
      renderResults(result);
      $("#pred-pipeline-hint").textContent = "预测完成";
    } catch (err) {
      alert("预测失败：" + err.message);
      resetPipeline();
    } finally {
      running = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "重新预测";
      }
    }
  }

  function onEnter() {
    fillContext();
    if (!lastResult && !BatteryAI.mock.lastPredictionResult) {
      resetPipeline();
    } else if (BatteryAI.mock.lastPredictionResult) {
      // 再次进入时保留上次结果
      document.querySelectorAll("#pred-pipeline li").forEach((li) => {
        li.classList.add("done");
        li.classList.remove("active");
      });
      $("#pred-pipeline-hint").textContent = "已有预测结果，可重新运行";
      renderResults(BatteryAI.mock.lastPredictionResult);
    }
  }

  function bind() {
    const btn = $("#btn-run-prediction");
    if (btn) btn.addEventListener("click", runPrediction);
  }

  return {
    bind,
    onEnter,
    runPrediction,
    getLastResult: () => lastResult || BatteryAI.mock.lastPredictionResult || null,
  };
})();
