/**
 * BatteryAI — 图表
 * 阶段1：Dashboard 趋势
 * 阶段2：电池详情 SOH 趋势
 */
window.BatteryAI = window.BatteryAI || {};

BatteryAI.charts = {
  dashboardTrend: null,
  detailTrend: null,

  destroy(key) {
    if (this[key] && typeof this[key].destroy === "function") {
      this[key].destroy();
      this[key] = null;
    }
  },

  _sohTrendConfig(battery, trend) {
    const labels = trend.historyCycles.map(String).concat(trend.forecastCycles.map(String));
    const hist = trend.historySoh.concat(trend.forecastCycles.map(() => null));
    const pred = trend.historySoh.map(() => null);
    pred[pred.length - 1] = trend.historySoh[trend.historySoh.length - 1];
    trend.forecastSoh.forEach((v) => pred.push(v));
    const eol = labels.map(() => trend.eol);

    return {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "历史 SOH (%)",
            data: hist,
            borderColor: "#0284c7",
            backgroundColor: "rgba(2, 132, 199, 0.08)",
            borderWidth: 2.2,
            pointRadius: 0,
            tension: 0.15,
            spanGaps: false,
          },
          {
            label: "未来预测（中心）",
            data: pred,
            borderColor: "#0d9488",
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            tension: 0.15,
            spanGaps: false,
          },
          {
            label: "失效阈值 80%",
            data: eol,
            borderColor: "#dc2626",
            borderWidth: 1.4,
            borderDash: [4, 3],
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => "循环 " + (items[0] && items[0].label),
              afterBody: () => [
                "电池: " + battery.name,
                "RUL 区间: " + battery.rul.lower + "–" + battery.rul.upper + " cycles",
              ],
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Cycle" },
            ticks: { maxTicksLimit: 8 },
            grid: { color: "#e8eef4" },
          },
          y: {
            title: { display: true, text: "SOH (%)" },
            min: 70,
            max: 105,
            grid: { color: "#e8eef4" },
          },
        },
      },
    };
  },

  renderDashboardTrend(canvasId) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === "undefined") return;
    const battery = BatteryAI.getActiveBattery();
    const trend = BatteryAI.buildTrendFor(battery);
    Chart.defaults.font.family = "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    Chart.defaults.color = "#5a6a7a";
    this.destroy("dashboardTrend");
    this.dashboardTrend = new Chart(el, this._sohTrendConfig(battery, trend));
  },

  renderDetailTrend(canvasId, battery) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === "undefined" || !battery) return;
    const trend = BatteryAI.buildTrendFor(battery);
    Chart.defaults.font.family = "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    Chart.defaults.color = "#5a6a7a";
    this.destroy("detailTrend");
    this.detailTrend = new Chart(el, this._sohTrendConfig(battery, trend));
  },

  analysisCapacity: null,
  analysisSoh: null,
  analysisTemp: null,

  _lineOpts(yTitle) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          title: { display: true, text: "Cycle" },
          ticks: { maxTicksLimit: 8 },
          grid: { color: "#e8eef4" },
        },
        y: {
          title: { display: true, text: yTitle },
          grid: { color: "#e8eef4" },
        },
      },
    };
  },

  renderAnalysisCharts(rows) {
    if (typeof Chart === "undefined" || !rows || !rows.length) return;
    const labels = rows.map((r) => String(r.cycle));
    const cap = rows.map((r) => r.capacity);
    const soh = rows.map((r) => r.soh);
    const temp = rows.map((r) => r.temperature);
    const self = this;

    function draw(key, canvasId, data, color, yTitle) {
      const el = document.getElementById(canvasId);
      if (!el) return;
      self.destroy(key);
      self[key] = new Chart(el, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              data,
              borderColor: color,
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.15,
              spanGaps: true,
            },
          ],
        },
        options: self._lineOpts(yTitle),
      });
    }

    draw("analysisCapacity", "chart-analysis-capacity", cap, "#0284c7", "Capacity (Ah)");
    draw("analysisSoh", "chart-analysis-soh", soh, "#0d9488", "SOH (%)");
    draw("analysisTemp", "chart-analysis-temp", temp, "#d97706", "Temperature (°C)");
  },

  predictionInterval: null,

  renderPredictionInterval(canvasId, result) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === "undefined" || !result) return;

    const wrap = el.parentElement;
    if (wrap) {
      // 强制容器有高度，避免 hidden→显示后仍为 0
      if (!wrap.style.minHeight) wrap.style.minHeight = "320px";
    }

    const hist = result.history;
    const forecast = result.forecast;
    if (!hist || !forecast || !hist.values || !hist.values.length) return;

    const nHist = hist.values.length;
    const labels = hist.cycles.map(String).concat(forecast.map((f) => String(f.cycle)));

    const histLine = hist.values.concat(forecast.map(() => null));
    const midLine = hist.values.map(() => null);
    const upperLine = hist.values.map(() => null);
    const lowerLine = hist.values.map(() => null);
    midLine[nHist - 1] = hist.values[nHist - 1];
    upperLine[nHist - 1] = hist.values[nHist - 1];
    lowerLine[nHist - 1] = hist.values[nHist - 1];
    forecast.forEach((f) => {
      midLine.push(f.mid);
      upperLine.push(f.upper);
      lowerLine.push(f.lower);
    });
    const eol = labels.map(() => result.eol || 80);

    this.destroy("predictionInterval");

    // 重置 canvas 尺寸，避免沿用上一次 0x0
    el.removeAttribute("width");
    el.removeAttribute("height");
    el.style.width = "100%";
    el.style.height = "100%";

    this.predictionInterval = new Chart(el, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "历史观测",
            data: histLine,
            borderColor: "#0284c7",
            borderWidth: 2.4,
            pointRadius: 0,
            tension: 0.15,
            spanGaps: false,
            order: 2,
          },
          {
            label: "中心预测",
            data: midLine,
            borderColor: "#0d9488",
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            tension: 0.15,
            spanGaps: false,
            order: 1,
          },
          {
            label: "预测上界",
            data: upperLine,
            borderColor: "#d97706",
            borderWidth: 1.4,
            borderDash: [4, 3],
            pointRadius: 0,
            tension: 0.1,
            spanGaps: false,
            fill: false,
            order: 3,
          },
          {
            label: "预测下界",
            data: lowerLine,
            borderColor: "#2563eb",
            borderWidth: 1.4,
            borderDash: [4, 3],
            pointRadius: 0,
            tension: 0.1,
            spanGaps: false,
            fill: "-1",
            backgroundColor: "rgba(13, 148, 136, 0.2)",
            order: 4,
          },
          {
            label: "失效阈值 80%",
            data: eol,
            borderColor: "#dc2626",
            borderWidth: 1.4,
            borderDash: [4, 3],
            pointRadius: 0,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterBody: (items) => {
                const idx = items[0] && items[0].dataIndex;
                const fIdx = idx - nHist;
                if (fIdx < 0 || !forecast[fIdx]) return [];
                const f = forecast[fIdx];
                return [
                  "区间: [" + f.lower.toFixed(2) + ", " + f.upper.toFixed(2) + "] %",
                  "宽度: " + f.width.toFixed(2) + " %",
                ];
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Cycle" },
            ticks: { maxTicksLimit: 10 },
            grid: { color: "#e8eef4" },
          },
          y: {
            title: { display: true, text: "SOH (%)" },
            min: 65,
            max: 105,
            grid: { color: "#e8eef4" },
          },
        },
      },
    });

    // 布局稳定后再强制 resize 一次
    requestAnimationFrame(() => {
      if (this.predictionInterval) {
        this.predictionInterval.resize();
        this.predictionInterval.update("none");
      }
    });
    setTimeout(() => {
      if (this.predictionInterval) {
        this.predictionInterval.resize();
      }
    }, 80);
  },

  historyRul: null,

  renderHistoryRul(canvasId, rowsAsc) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === "undefined") return;
    const rows = rowsAsc || [];
    const labels = rows.map((r) => r.time.slice(5, 16));
    const mid = rows.map((r) => r.rulMid);
    const lower = rows.map((r) => r.rulLower);
    const upper = rows.map((r) => r.rulUpper);

    this.destroy("historyRul");
    this.historyRul = new Chart(el, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "RUL 中心",
            data: mid,
            borderColor: "#0d9488",
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.2,
          },
          {
            label: "RUL 下界",
            data: lower,
            borderColor: "#2563eb",
            borderWidth: 1.2,
            borderDash: [4, 3],
            pointRadius: 0,
            tension: 0.2,
          },
          {
            label: "RUL 上界",
            data: upper,
            borderColor: "#d97706",
            borderWidth: 1.2,
            borderDash: [4, 3],
            pointRadius: 0,
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { boxWidth: 12 } } },
        scales: {
          x: { grid: { color: "#e8eef4" } },
          y: {
            title: { display: true, text: "RUL (cycles)" },
            grid: { color: "#e8eef4" },
          },
        },
      },
    });
  },
};
