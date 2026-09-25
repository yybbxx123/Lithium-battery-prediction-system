/**
 * 锂电池区间预测系统 — 第二版
 * 流程：上传 CSV → 单次离线区间预测 → 展示下界 / 中心 / 上界
 * 说明：当前为前端示意算法，后续可替换为真实模型 API
 */

(function () {
  "use strict";

  let parsedRows = [];
  let headers = [];
  let lastForecast = null;
  let intervalChart = null;

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function setAlert(text, type) {
    const box = $("alert-box");
    box.classList.remove("warn", "danger");
    if (type) box.classList.add(type);
    box.textContent = text;
  }

  function setSteps(stage) {
    document.querySelectorAll(".step").forEach((el) => {
      const n = Number(el.dataset.step);
      el.classList.remove("active", "done");
      if (n < stage) el.classList.add("done");
      if (n === stage) el.classList.add("active");
    });
  }

  /* ---------- CSV 解析 ---------- */
  function parseCsv(text) {
    const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error("CSV 至少需要表头和一行数据");

    const cols = splitCsvLine(lines[0]).map((c) => c.trim().toLowerCase());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cells = splitCsvLine(lines[i]);
      const obj = {};
      cols.forEach((col, idx) => {
        const raw = (cells[idx] || "").trim();
        const num = Number(raw);
        obj[col] = raw === "" || Number.isNaN(num) ? raw : num;
      });
      rows.push(obj);
    }

    if (!rows.length) throw new Error("未解析到有效数据行");
    return { headers: cols, rows };
  }

  function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function normalizeSoh(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    if (Number.isNaN(n)) return null;
    return n > 1.5 ? n : n * 100;
  }

  function extractSeries(rows, target) {
    const hasCycle = rows.some((r) => r.cycle !== undefined && r.cycle !== "");
    const cycles = [];
    const values = [];

    rows.forEach((r, i) => {
      const cycle = hasCycle ? Number(r.cycle) : i + 1;
      let value = null;

      if (target === "capacity") {
        value = r.capacity != null && r.capacity !== "" ? Number(r.capacity) : null;
      } else {
        value = normalizeSoh(r.soh);
        if (value == null && r.capacity != null && r.capacity !== "") {
          // 无 soh 时用容量相对首值近似
          value = null;
        }
      }

      if (!Number.isNaN(cycle)) {
        cycles.push(cycle);
        values.push(Number.isNaN(Number(value)) ? null : value);
      }
    });

    // 若目标为 soh 且全空，尝试用 capacity 归一化
    if (target === "soh" && values.every((v) => v == null)) {
      const caps = rows.map((r) => Number(r.capacity)).filter((n) => !Number.isNaN(n) && n > 0);
      if (caps.length) {
        const base = caps[0];
        rows.forEach((r, i) => {
          const c = Number(r.capacity);
          values[i] = Number.isNaN(c) ? null : (c / base) * 100;
        });
      }
    }

    // 若仍无目标列，用电压构造示意序列（仅演示）
    if (values.every((v) => v == null)) {
      rows.forEach((r, i) => {
        const v = Number(r.voltage);
        values[i] = Number.isNaN(v)
          ? 95 - i * 0.15
          : clamp(70 + (v - 3.2) * 40 - i * 0.1, 60, 105);
      });
    }

    // 线性插补空值
    for (let i = 0; i < values.length; i++) {
      if (values[i] != null) continue;
      let prev = i - 1;
      let next = i + 1;
      while (prev >= 0 && values[prev] == null) prev--;
      while (next < values.length && values[next] == null) next++;
      if (prev >= 0 && next < values.length) {
        const t = (i - prev) / (next - prev);
        values[i] = values[prev] * (1 - t) + values[next] * t;
      } else if (prev >= 0) {
        values[i] = values[prev];
      } else if (next < values.length) {
        values[i] = values[next];
      } else {
        values[i] = target === "capacity" ? 1.8 : 90;
      }
    }

    return { cycles, values };
  }

  /* ---------- 单次区间预测（示意） ---------- */
  function runIntervalForecast(series, horizon, confLevel) {
    const { cycles, values } = series;
    const n = values.length;
    if (n < 3) throw new Error("有效数据过少，至少需要 3 行");

    const lastCycle = cycles[n - 1];
    const step =
      n >= 2 ? Math.max(1, Math.round((cycles[n - 1] - cycles[0]) / (n - 1))) : 1;

    // 近窗线性趋势
    const window = Math.min(12, n);
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
    const slope = den === 0 ? 0 : num / den;
    const intercept = yMean - slope * xMean;

    // 残差标准差 → 区间半宽
    let sse = 0;
    for (let i = 0; i < window; i++) {
      const pred = intercept + slope * xs[i];
      sse += (ys[i] - pred) ** 2;
    }
    const sigma = Math.sqrt(sse / Math.max(1, window - 2)) || 0.5;

    const zMap = { 80: 1.28, 90: 1.64, 95: 1.96 };
    const z = zMap[String(confLevel)] || 1.64;

    const forecast = [];
    for (let h = 1; h <= horizon; h++) {
      const mid = intercept + slope * (window - 1 + h);
      // 越远不确定性越大
      const half = z * sigma * Math.sqrt(1 + h / 5) + h * 0.05;
      const lower = mid - half;
      const upper = mid + half;
      forecast.push({
        cycle: lastCycle + h * step,
        lower,
        mid,
        upper,
        width: upper - lower,
      });
    }

    return {
      history: { cycles, values },
      forecast,
      slope,
      sigma,
      lastValue: values[n - 1],
      lastCycle,
    };
  }

  /* ---------- UI：文件 ---------- */
  function handleFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type && !file.type.includes("csv")) {
      setAlert("请上传 CSV 格式文件", "warn");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { headers: cols, rows } = parseCsv(String(reader.result));
        headers = cols;
        parsedRows = rows;
        lastForecast = null;

        $("upload-zone").classList.add("has-file");
        $("file-meta").hidden = false;
        $("file-name").textContent = file.name;
        $("file-rows").textContent = String(rows.length);
        $("file-cols").textContent = cols.join(", ");
        $("file-status").textContent = "已加载，待预测";
        $("btn-predict").disabled = false;
        $("btn-export").disabled = true;
        $("result-section").hidden = true;

        renderPreview(cols, rows);
        setSteps(2);
        setAlert(
          "已加载「" + file.name + "」（" + rows.length + " 行）。确认预览无误后，点击「开始区间预测」。",
          null
        );
      } catch (err) {
        setAlert("解析失败：" + err.message, "danger");
        $("btn-predict").disabled = true;
      }
    };
    reader.onerror = () => setAlert("读取文件失败，请重试", "danger");
    reader.readAsText(file, "UTF-8");
  }

  function renderPreview(cols, rows) {
    const section = $("preview-section");
    section.hidden = false;
    const thead = $("preview-table").querySelector("thead");
    const tbody = $("preview-table").querySelector("tbody");
    thead.innerHTML = "<tr>" + cols.map((c) => "<th>" + escapeHtml(c) + "</th>").join("") + "</tr>";
    tbody.innerHTML = rows
      .slice(0, 8)
      .map((row) => {
        return (
          "<tr>" +
          cols
            .map((c) => {
              const v = row[c];
              const text = typeof v === "number" ? formatNum(v) : String(v ?? "");
              return "<td>" + escapeHtml(text) + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatNum(n) {
    if (Number.isInteger(n)) return String(n);
    return Math.abs(n) >= 100 ? n.toFixed(2) : n.toFixed(4).replace(/\.?0+$/, "");
  }

  function unitLabel(target) {
    return target === "capacity" ? "Ah" : "%";
  }

  /* ---------- 预测与展示 ---------- */
  function onPredict() {
    if (!parsedRows.length) {
      setAlert("请先上传 CSV 文件", "warn");
      return;
    }

    const target = $("target-select").value;
    const horizon = Number($("horizon-select").value);
    const level = Number($("level-select").value);

    try {
      const series = extractSeries(parsedRows, target);
      const result = runIntervalForecast(series, horizon, level);
      lastForecast = { ...result, target, horizon, level };
      renderResults(lastForecast);
      $("file-status").textContent = "已完成单次预测";
      $("btn-export").disabled = false;
      setSteps(3);
      setAlert(
        "单次区间预测完成：已生成未来 " +
          horizon +
          " 步的下界 / 中心估计 / 上界（示意算法，后续可替换为真实模型）。",
        null
      );
    } catch (err) {
      setAlert("预测失败：" + err.message, "danger");
    }
  }

  function renderResults(result) {
    const { forecast, target, level, horizon, history, slope, lastValue, lastCycle } = result;
    const unit = unitLabel(target);
    const last = forecast[forecast.length - 1];
    const first = forecast[0];

    $("result-section").hidden = false;

    $("bound-lower").textContent = last.lower.toFixed(2) + " " + unit;
    $("bound-mid").textContent = last.mid.toFixed(2) + " " + unit;
    $("bound-upper").textContent = last.upper.toFixed(2) + " " + unit;
    $("bound-lower-hint").textContent = "第 " + last.cycle + " 循环 · 区间下限";
    $("bound-mid-hint").textContent = "第 " + last.cycle + " 循环 · 中心估计";
    $("bound-upper-hint").textContent = "第 " + last.cycle + " 循环 · 区间上限";

    $("summary-list").innerHTML = [
      "<li><strong>预测目标：</strong>" + (target === "capacity" ? "放电容量" : "健康状态 SoH") + "</li>",
      "<li><strong>历史终点：</strong>循环 " + lastCycle + "，观测值 " + lastValue.toFixed(2) + " " + unit + "</li>",
      "<li><strong>向前步数：</strong>" + horizon + "（至循环 " + last.cycle + "）</li>",
      "<li><strong>示意置信水平：</strong>约 " + level + "% 区间</li>",
      "<li><strong>首步区间：</strong>[" +
        first.lower.toFixed(2) +
        ", " +
        first.upper.toFixed(2) +
        "] " +
        unit +
        "</li>",
      "<li><strong>末步区间宽度：</strong>" + last.width.toFixed(2) + " " + unit + "</li>",
      "<li><strong>近窗趋势斜率：</strong>" + slope.toFixed(4) + " / 步</li>",
    ].join("");

    const note =
      last.mid >= 80 || target === "capacity"
        ? "中心估计落在相对健康/可用区间；请同时关注下界是否已接近寿命终点或安全阈值。"
        : "中心估计偏低，且下界更保守。实际决策建议结合下界进行风险评估。";
    $("result-note").textContent =
      "本结果为单次离线区间预测，不依赖实时硬件。区间宽度随预测步数增加而扩大。" + note;

    const tbody = $("result-table").querySelector("tbody");
    tbody.innerHTML = forecast
      .map(
        (row) =>
          "<tr>" +
          "<td>" +
          row.cycle +
          "</td>" +
          "<td>" +
          row.lower.toFixed(3) +
          "</td>" +
          "<td>" +
          row.mid.toFixed(3) +
          "</td>" +
          "<td>" +
          row.upper.toFixed(3) +
          "</td>" +
          "<td>" +
          row.width.toFixed(3) +
          "</td>" +
          "</tr>"
      )
      .join("");

    renderIntervalChart(result);
    $("result-section").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderIntervalChart(result) {
    const { history, forecast, target } = result;
    const unit = unitLabel(target);
    const nHist = history.values.length;

    const labels = history.cycles.map(String).concat(forecast.map((f) => String(f.cycle)));

    // 历史实线；未来段用 null 断开
    const histLine = history.values.concat(forecast.map(() => null));

    // 中心 / 上界 / 下界：从历史最后一点接到未来，保证视觉连续
    const midLine = history.values.map(() => null);
    const upperLine = history.values.map(() => null);
    const lowerLine = history.values.map(() => null);
    midLine[nHist - 1] = history.values[nHist - 1];
    upperLine[nHist - 1] = history.values[nHist - 1];
    lowerLine[nHist - 1] = history.values[nHist - 1];
    forecast.forEach((f) => {
      midLine.push(f.mid);
      upperLine.push(f.upper);
      lowerLine.push(f.lower);
    });

    if (intervalChart) intervalChart.destroy();

    intervalChart = new Chart($("chart-interval"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "历史观测",
            data: histLine,
            borderColor: "#2563eb",
            pointRadius: 0,
            borderWidth: 2.5,
            tension: 0.15,
            spanGaps: false,
          },
          {
            label: "中心估计",
            data: midLine,
            borderColor: "#0d9488",
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            tension: 0.15,
            spanGaps: false,
          },
          {
            label: "预测上界",
            data: upperLine,
            borderColor: "#d97706",
            borderWidth: 1.5,
            borderDash: [4, 3],
            pointRadius: 0,
            tension: 0.1,
            spanGaps: false,
            fill: "+1",
            backgroundColor: "rgba(13, 148, 136, 0.16)",
          },
          {
            label: "预测下界",
            data: lowerLine,
            borderColor: "#2563eb",
            borderWidth: 1.5,
            borderDash: [4, 3],
            pointRadius: 0,
            tension: 0.1,
            spanGaps: false,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: {
              afterBody: (items) => {
                const idx = items[0] && items[0].dataIndex;
                const fIdx = idx - nHist;
                if (fIdx < 0 || !forecast[fIdx]) return [];
                const f = forecast[fIdx];
                return [
                  "区间: [" + f.lower.toFixed(2) + ", " + f.upper.toFixed(2) + "] " + unit,
                  "宽度: " + f.width.toFixed(2) + " " + unit,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "循环次数" },
            ticks: { maxTicksLimit: 10 },
            grid: { color: "#e8eef4" },
          },
          y: {
            title: { display: true, text: target === "capacity" ? "容量 (Ah)" : "SoH (%)" },
            grid: { color: "#e8eef4" },
          },
        },
      },
    });
  }

  /* ---------- 导出 / 示例 ---------- */
  function exportResultCsv() {
    if (!lastForecast) {
      setAlert("请先完成一次预测再导出", "warn");
      return;
    }
    const unit = unitLabel(lastForecast.target);
    const header = "预测循环,下界(" + unit + "),中心估计(" + unit + "),上界(" + unit + "),区间宽度(" + unit + ")\n";
    const body = lastForecast.forecast
      .map(
        (r) =>
          [r.cycle, r.lower.toFixed(4), r.mid.toFixed(4), r.upper.toFixed(4), r.width.toFixed(4)].join(",")
      )
      .join("\n");
    const blob = new Blob(["\ufeff" + header + body], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.href = URL.createObjectURL(blob);
    link.download = "区间预测结果_" + stamp + ".csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function downloadSampleCsv() {
    const lines = ["cycle,voltage,temperature,capacity,soh"];
    for (let c = 1; c <= 40; c++) {
      const soh = 1.0 - c * 0.0032 + Math.sin(c / 7) * 0.004;
      const capacity = 2.0 * soh;
      const voltage = 3.7 - c * 0.0015 + (Math.random() - 0.5) * 0.01;
      const temperature = 32 + Math.sin(c / 5) * 1.5;
      lines.push(
        [
          c,
          voltage.toFixed(4),
          temperature.toFixed(2),
          capacity.toFixed(4),
          soh.toFixed(4),
        ].join(",")
      );
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "示例_电池循环数据.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /* ---------- 事件绑定 ---------- */
  function initUpload() {
    const zone = $("upload-zone");
    const input = $("csv-input");

    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", () => {
      if (input.files && input.files[0]) handleFile(input.files[0]);
    });

    ["dragenter", "dragover"].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.remove("dragover");
      });
    });
    zone.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  }

  function start() {
    Chart.defaults.font.family = "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    Chart.defaults.color = "#5a6a7a";

    initUpload();
    $("btn-predict").addEventListener("click", onPredict);
    $("btn-export").addEventListener("click", exportResultCsv);
    $("btn-sample").addEventListener("click", downloadSampleCsv);
    setSteps(1);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
