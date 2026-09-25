/**
 * BatteryAI — 数据上传 / 质量分析（第三阶段）
 * 前端本地解析 CSV，不上传服务器
 */
window.BatteryAI = window.BatteryAI || {};

BatteryAI.upload = (function () {
  "use strict";

  const REQUIRED = ["cycle", "capacity", "voltage", "current", "temperature"];

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function setAlert(text, type) {
    const box = $("#upload-alert");
    if (!box) return;
    box.classList.remove("warn", "danger");
    if (type) box.classList.add(type);
    box.textContent = text;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function parseCsv(text) {
    const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error("CSV 至少需要表头和一行数据");
    const headers = splitCsvLine(lines[0]).map((c) => c.trim().toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cells = splitCsvLine(lines[i]);
      const obj = {};
      headers.forEach((h, idx) => {
        const raw = (cells[idx] || "").trim();
        const num = Number(raw);
        obj[h] = raw === "" || Number.isNaN(num) ? raw : num;
      });
      rows.push(obj);
    }
    if (!rows.length) throw new Error("未解析到有效数据行");
    return { headers, rows };
  }

  function normalizeRows(rows) {
    const caps = rows.map((r) => Number(r.capacity)).filter((n) => !Number.isNaN(n) && n > 0);
    const base = caps.length ? caps[0] : null;
    return rows.map((r, i) => {
      const cycle = r.cycle !== "" && r.cycle != null ? Number(r.cycle) : i + 1;
      let soh = null;
      if (r.soh !== undefined && r.soh !== "") {
        const s = Number(r.soh);
        soh = Number.isNaN(s) ? null : s > 1.5 ? s : s * 100;
      } else if (base && r.capacity !== "" && r.capacity != null) {
        const c = Number(r.capacity);
        soh = Number.isNaN(c) ? null : (c / base) * 100;
      }
      return {
        cycle: Number.isNaN(cycle) ? i + 1 : cycle,
        capacity: r.capacity === "" || r.capacity == null ? null : Number(r.capacity),
        voltage: r.voltage === "" || r.voltage == null ? null : Number(r.voltage),
        current: r.current === "" || r.current == null ? null : Number(r.current),
        temperature: r.temperature === "" || r.temperature == null ? null : Number(r.temperature),
        soh: soh == null || Number.isNaN(soh) ? null : soh,
      };
    });
  }

  function computeQuality(rows) {
    const fields = ["cycle", "capacity", "voltage", "current", "temperature"];
    let filled = 0;
    let total = rows.length * fields.length;
    rows.forEach((r) => {
      fields.forEach((f) => {
        if (r[f] != null && !Number.isNaN(r[f])) filled++;
      });
    });
    const completeness = total ? (filled / total) * 100 : 0;

    const cycles = rows.map((r) => r.cycle).filter((c) => c != null);
    let gaps = 0;
    for (let i = 1; i < cycles.length; i++) {
      const d = cycles[i] - cycles[i - 1];
      if (d > 2 || d <= 0) gaps++;
    }
    const continuity = cycles.length <= 1 ? 100 : clamp(100 - (gaps / (cycles.length - 1)) * 100, 0, 100);

    let anomalies = 0;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (prev.capacity != null && cur.capacity != null) {
        const jump = Math.abs(cur.capacity - prev.capacity);
        if (jump > 0.15) anomalies++;
      }
      if (cur.temperature != null && (cur.temperature > 55 || cur.temperature < 0)) anomalies++;
      if (cur.voltage != null && (cur.voltage > 4.5 || cur.voltage < 2.5)) anomalies++;
    }

    let status = "可预测";
    let hint = "数据基本完整，可以进行预测。";
    let gateOk = true;
    if (completeness < 70 || rows.length < 5) {
      status = "需补全";
      hint = "完整度偏低或样本过少，建议补充数据后再预测。";
      gateOk = false;
    } else if (anomalies > Math.max(3, rows.length * 0.08)) {
      status = "有异常";
      hint = "检测到较多异常点，可预测但建议先排查尖峰/跳变。";
    }

    return {
      completeness: Number(completeness.toFixed(1)),
      continuity: Number(continuity.toFixed(1)),
      anomalies,
      status,
      hint,
      gateOk,
    };
  }

  function computeFeatures(rows) {
    const nums = (key) => rows.map((r) => r[key]).filter((v) => v != null && !Number.isNaN(v));
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const caps = nums("capacity");
    const temps = nums("temperature");
    const currents = nums("current");
    const cycles = nums("cycle");

    let fade = null;
    if (caps.length >= 2 && cycles.length >= 2) {
      const c0 = caps[0];
      const c1 = caps[caps.length - 1];
      const span = cycles[cycles.length - 1] - cycles[0] || 1;
      fade = ((c0 - c1) / c0 / span) * 100;
    }

    const posI = currents.filter((v) => v > 0);
    const negI = currents.filter((v) => v < 0).map(Math.abs);

    return {
      fadeRate: fade,
      avgTemp: avg(temps),
      avgChargeI: avg(posI),
      avgDischargeI: avg(negI),
      maxTemp: temps.length ? Math.max(...temps) : null,
      cycleSpan:
        cycles.length >= 2
          ? cycles[0] + " → " + cycles[cycles.length - 1] + "（" + cycles.length + " 点）"
          : "—",
    };
  }

  function storeDataset(payload) {
    BatteryAI.mock.dataset = payload;
  }

  function getDataset() {
    return BatteryAI.mock.dataset || null;
  }

  function fillBatterySelect() {
    const sel = $("#upload-battery-select");
    if (!sel) return;
    const active = BatteryAI.mock.activeBatteryId;
    sel.innerHTML = BatteryAI.mock.batteries
      .map(
        (b) =>
          '<option value="' +
          b.id +
          '"' +
          (b.id === active ? " selected" : "") +
          ">" +
          escapeHtml(b.name + "（" + b.model + "）") +
          "</option>"
      )
      .join("");
  }

  function showMeta(fileName, rows, quality) {
    $("#upload-meta").hidden = false;
    $("#meta-name").textContent = fileName;
    $("#meta-rows").textContent = String(rows.length);
    $("#meta-completeness").textContent = quality.completeness.toFixed(1) + "%";
    $("#meta-status").textContent = quality.status;
    $("#btn-start-analysis").disabled = false;
  }

  function showPreview(headers, rows) {
    const panel = $("#upload-preview-panel");
    panel.hidden = false;
    const thead = $("#upload-preview-table thead");
    const tbody = $("#upload-preview-table tbody");
    thead.innerHTML =
      "<tr>" + headers.map((h) => "<th>" + escapeHtml(h) + "</th>").join("") + "</tr>";
    tbody.innerHTML = rows
      .slice(0, 8)
      .map((row) => {
        return (
          "<tr>" +
          headers
            .map((h) => {
              const v = row[h];
              const text = v == null || v === "" ? "" : typeof v === "number" ? String(v) : String(v);
              return "<td>" + escapeHtml(text) + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");
  }

  function acceptData(fileName, headers, rawRows) {
    const rows = normalizeRows(rawRows);
    const quality = computeQuality(rows);
    const features = computeFeatures(rows);
    const batteryId = ($("#upload-battery-select") || {}).value || BatteryAI.mock.activeBatteryId;

    storeDataset({
      fileName,
      headers,
      rawRows,
      rows,
      quality,
      features,
      batteryId,
      readyForPrediction: quality.gateOk,
    });

    showMeta(fileName, rows, quality);
    showPreview(headers.length ? headers : REQUIRED, rawRows);
    $("#upload-zone").classList.add("has-file");
    setAlert(
      "已加载「" + fileName + "」（" + rows.length + " 条）。完整度 " + quality.completeness.toFixed(1) + "%，可开始数据分析。",
      quality.gateOk ? null : "warn"
    );
  }

  function handleFile(file) {
    if (!file) return;
    const name = file.name || "未命名.csv";
    if (/\.xlsx?$/i.test(name)) {
      setAlert("当前原型暂用 CSV 解析。Excel 请先另存为 CSV，或使用手动录入。", "warn");
      return;
    }
    if (!/\.csv$/i.test(name) && file.type && !file.type.includes("csv") && !file.type.includes("text")) {
      setAlert("请上传 CSV 文件（演示阶段）。", "warn");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { headers, rows } = parseCsv(String(reader.result));
        acceptData(name, headers, rows);
      } catch (err) {
        setAlert("解析失败：" + err.message, "danger");
        $("#btn-start-analysis").disabled = true;
      }
    };
    reader.onerror = () => setAlert("读取文件失败", "danger");
    reader.readAsText(file, "UTF-8");
  }

  function downloadTemplate() {
    const lines = ["cycle,capacity,voltage,current,temperature,soh"];
    for (let c = 1; c <= 40; c++) {
      const soh = 1.0 - c * 0.003 + Math.sin(c / 8) * 0.003;
      const capacity = 2.5 * soh;
      const voltage = 3.7 - c * 0.0012;
      const current = c % 2 === 0 ? 1.2 : -1.1;
      const temperature = 25 + Math.sin(c / 5) * 2;
      lines.push(
        [c, capacity.toFixed(4), voltage.toFixed(3), current.toFixed(2), temperature.toFixed(1), soh.toFixed(4)].join(",")
      );
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "BatteryAI_示例数据模板.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- 手动录入 ---------- */
  function addManualRow(values) {
    const tbody = $("#manual-tbody");
    if (!tbody) return;
    const tr = document.createElement("tr");
    const defaults = values || ["", "", "", "", ""];
    tr.innerHTML =
      ["cycle", "capacity", "voltage", "current", "temperature"]
        .map(
          (name, i) =>
            '<td><input class="cell-input" data-field="' +
            name +
            '" value="' +
            escapeHtml(defaults[i] || "") +
            '" /></td>'
        )
        .join("") +
      '<td><button type="button" class="btn btn-ghost btn-sm btn-remove-row">删除</button></td>';
    tbody.appendChild(tr);
    tr.querySelector(".btn-remove-row").addEventListener("click", () => tr.remove());
  }

  function seedManualRows() {
    const tbody = $("#manual-tbody");
    if (!tbody || tbody.children.length) return;
    [
      ["1", "2.001", "4.18", "1.2", "25.4"],
      ["2", "1.998", "4.17", "1.2", "25.6"],
      ["3", "1.995", "4.17", "1.2", "25.8"],
    ].forEach(addManualRow);
  }

  function useManualData() {
    const inputs = Array.from(document.querySelectorAll("#manual-tbody tr"));
    if (!inputs.length) {
      setAlert("请先添加至少一行手动数据", "warn");
      return;
    }
    const rows = [];
    inputs.forEach((tr) => {
      const obj = {};
      tr.querySelectorAll(".cell-input").forEach((inp) => {
        const raw = inp.value.trim();
        const num = Number(raw);
        obj[inp.dataset.field] = raw === "" || Number.isNaN(num) ? raw : num;
      });
      if (Object.values(obj).some((v) => v !== "")) rows.push(obj);
    });
    if (rows.length < 3) {
      setAlert("手动数据至少需要 3 行", "warn");
      return;
    }
    acceptData("手动录入.csv", REQUIRED, rows);
  }

  /* ---------- 分析页 ---------- */
  function renderAnalysis() {
    const ds = getDataset();
    const empty = $("#analysis-empty");
    const content = $("#analysis-content");
    if (!ds) {
      if (empty) empty.hidden = false;
      if (content) content.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (content) content.hidden = false;

    const bat = BatteryAI.getBattery(ds.batteryId);
    const line = $("#analysis-battery-line");
    if (line) {
      line.textContent = bat
        ? "当前分析数据集：「" + ds.fileName + "」· 关联电池 " + bat.name
        : "当前分析数据集：「" + ds.fileName + "」";
    }

    const q = ds.quality;
    $("#qa-completeness").textContent = q.completeness.toFixed(1) + "%";
    $("#qa-continuity").textContent = q.continuity.toFixed(1) + "%";
    $("#qa-anomalies").textContent = String(q.anomalies) + " 条";
    $("#qa-status").textContent = q.status;
    $("#qa-status-hint").textContent = q.hint;

    const gate = $("#analysis-gate");
    gate.classList.remove("warn", "danger");
    gate.textContent = q.hint;
    if (!q.gateOk) gate.classList.add("warn");

    const f = ds.features;
    const fmt = (v, unit, digits) =>
      v == null || Number.isNaN(v) ? "—" : v.toFixed(digits == null ? 3 : digits) + (unit || "");
    $("#feat-fade").textContent = f.fadeRate == null ? "—" : f.fadeRate.toFixed(4) + " % / cycle";
    $("#feat-temp").textContent = fmt(f.avgTemp, " °C", 2);
    $("#feat-ichg").textContent = fmt(f.avgChargeI, " A", 3);
    $("#feat-idchg").textContent = fmt(f.avgDischargeI, " A", 3);
    $("#feat-tmax").textContent = fmt(f.maxTemp, " °C", 2);
    $("#feat-span").textContent = f.cycleSpan;

    const temps = ds.rows.map((r) => r.temperature).filter((v) => v != null);
    if (temps.length) {
      const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
      $("#temp-avg").textContent = avg.toFixed(2) + " °C";
      $("#temp-max").textContent = Math.max(...temps).toFixed(2) + " °C";
      $("#temp-min").textContent = Math.min(...temps).toFixed(2) + " °C";
    } else {
      $("#temp-avg").textContent = "—";
      $("#temp-max").textContent = "—";
      $("#temp-min").textContent = "—";
    }

    const predBtn = $("#btn-goto-prediction");
    if (predBtn) {
      predBtn.disabled = false;
      predBtn.title = q.gateOk ? "" : "数据质量一般，仍可进入预测页（第四阶段）";
    }

    requestAnimationFrame(() => {
      if (BatteryAI.charts && BatteryAI.charts.renderAnalysisCharts) {
        BatteryAI.charts.renderAnalysisCharts(ds.rows);
      }
    });
  }

  function startAnalysis() {
    if (!getDataset()) {
      setAlert("请先上传或录入数据", "warn");
      return;
    }
    if (typeof window.BatteryAINavigate === "function") {
      window.BatteryAINavigate("analysis");
    }
    renderAnalysis();
  }

  function bind() {
    fillBatterySelect();

    const zone = $("#upload-zone");
    const input = $("#upload-file-input");
    const pick = $("#btn-pick-file");

    if (pick) pick.addEventListener("click", (e) => {
      e.stopPropagation();
      input.click();
    });
    if (zone) {
      zone.addEventListener("click", () => input.click());
      zone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          input.click();
        }
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
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleFile(f);
      });
    }
    if (input) {
      input.addEventListener("change", () => {
        if (input.files && input.files[0]) handleFile(input.files[0]);
      });
    }

    const tpl = $("#btn-download-template");
    if (tpl) tpl.addEventListener("click", downloadTemplate);

    const toggle = $("#btn-toggle-manual");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const box = $("#manual-entry");
        box.hidden = !box.hidden;
        if (!box.hidden) seedManualRows();
      });
    }
    const addRow = $("#btn-add-manual-row");
    if (addRow) addRow.addEventListener("click", () => addManualRow());
    const useManual = $("#btn-use-manual");
    if (useManual) useManual.addEventListener("click", useManualData);

    const startBtn = $("#btn-start-analysis");
    if (startBtn) startBtn.addEventListener("click", startAnalysis);

    const predBtn = $("#btn-goto-prediction");
    if (predBtn) {
      predBtn.addEventListener("click", () => {
        if (typeof window.BatteryAINavigate === "function") {
          window.BatteryAINavigate("prediction");
        }
      });
    }
  }

  return {
    bind,
    fillBatterySelect,
    renderAnalysis,
    getDataset,
    startAnalysis,
  };
})();

BatteryAI.mock.dataset = null;
