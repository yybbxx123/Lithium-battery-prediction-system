/**
 * BatteryAI — 支持模块：历史 / 报告 / 知识中心 / AI 助手
 */
window.BatteryAI = window.BatteryAI || {};

BatteryAI.support = (function () {
  "use strict";

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ========== 历史 ========== */
  function renderHistory() {
    const tbody = $("#history-tbody");
    if (!tbody) return;
    const rows = BatteryAI.mock.history || [];
    tbody.innerHTML = rows
      .map(function (r) {
        return (
          "<tr>" +
          "<td>" +
          escapeHtml(r.time) +
          "</td>" +
          "<td>" +
          escapeHtml(r.battery) +
          "</td>" +
          "<td>" +
          Number(r.soh).toFixed(1) +
          "%</td>" +
          "<td>" +
          r.rulLower +
          "</td>" +
          "<td>" +
          r.rulMid +
          "</td>" +
          "<td>" +
          r.rulUpper +
          "</td>" +
          "<td>" +
          escapeHtml(r.model) +
          "</td>" +
          "<td>" +
          escapeHtml(r.status) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    requestAnimationFrame(function () {
      if (BatteryAI.charts && BatteryAI.charts.renderHistoryRul) {
        BatteryAI.charts.renderHistoryRul("chart-history-rul", rows.slice().reverse());
      }
    });
  }

  /* ========== 报告 ========== */
  function generateReport() {
    const bat = BatteryAI.getActiveBattery();
    const pred = BatteryAI.mock.lastPredictionResult;
    const anomaly =
      BatteryAI.mock.lastAnomalyReport ||
      (BatteryAI.anomaly && BatteryAI.anomaly.buildAnomalyReport
        ? BatteryAI.anomaly.buildAnomalyReport(bat)
        : null);

    const empty = $("#report-empty");
    const doc = $("#report-doc");
    if (empty) empty.hidden = true;
    if (doc) doc.hidden = false;

    const now = new Date().toLocaleString("zh-CN", { hour12: false });
    $("#report-title").textContent = bat.name + " — 电池健康预测报告";
    $("#report-time").textContent = "生成时间：" + now;

    const basic = $("#report-basic");
    basic.innerHTML =
      infoRow("电池名称", bat.name) +
      infoRow("型号", bat.model) +
      infoRow("类型", bat.type) +
      infoRow("标称容量", bat.nominalCapacity.toFixed(2) + " Ah") +
      infoRow("当前容量", bat.currentCapacity.toFixed(2) + " Ah") +
      infoRow("循环次数", String(bat.cycle)) +
      infoRow("使用时长", bat.usageDays + " 天");

    $("#report-soh").textContent = bat.soh.toFixed(1) + "%";

    const rul = pred && pred.rul ? pred.rul : bat.rul;
    const span = rul.upper - rul.lower || 1;
    const pct = Math.min(98, Math.max(2, ((rul.mid - rul.lower) / span) * 100));
    $("#report-rul-block").innerHTML =
      '<div class="range-label"><span>' +
      rul.lower +
      "</span><span>中心预测</span><span>" +
      rul.upper +
      '</span></div><div class="bar"><span class="dot" style="left:' +
      pct +
      '%"></span></div><div class="center-label">● ' +
      rul.mid +
      ' cycles</div><div class="tri"><div><div class="k">预测下限</div><div class="v">' +
      rul.lower +
      ' cycles</div></div><div><div class="k">中心预测</div><div class="v">' +
      rul.mid +
      ' cycles</div></div><div><div class="k">预测上限</div><div class="v">' +
      rul.upper +
      " cycles</div></div></div>";

    $("#report-trend-text").textContent =
      "当前容量约 " +
      bat.currentCapacity.toFixed(2) +
      " Ah / 标称 " +
      bat.nominalCapacity.toFixed(2) +
      " Ah。健康状态处于" +
      bat.status +
      "阶段；请结合 AI 预测页中的历史—区间带—失效阈值曲线综合判断寿命终点风险。";

    if (anomaly) {
      $("#report-anomaly-text").textContent =
        "最近检测：" +
        anomaly.checkedAt +
        "。异常数量 " +
        anomaly.count +
        "，最高等级「" +
        anomaly.maxLevel +
        "」，总体「" +
        anomaly.overall +
        "」。" +
        anomaly.overallHint;
    } else {
      $("#report-anomaly-text").textContent = "暂无异常检测快照，可前往「异常监测」页面刷新。";
    }

    const aiText =
      BatteryAI.anomaly && BatteryAI.anomaly.buildAiInsight
        ? BatteryAI.anomaly.buildAiInsight(bat, anomaly || { items: [] })
        : "暂无 AI 分析文案。";
    $("#report-ai-text").textContent = aiText;

    $("#report-model").innerHTML =
      infoRow("模型名称", (pred && "示意区间模型") || bat.lastPrediction.model) +
      infoRow("预测时间", (bat.lastPrediction && bat.lastPrediction.time) || now) +
      infoRow("区间覆盖率（示意）", (bat.coverage || 94.2) + "%") +
      infoRow("区间宽度", (bat.intervalWidth || rul.upper - rul.lower) + " cycles");

    doc.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function infoRow(k, v) {
    return (
      "<div><dt>" +
      escapeHtml(k) +
      "</dt><dd>" +
      escapeHtml(String(v)) +
      "</dd></div>"
    );
  }

  /* ========== 知识中心 ========== */
  const KNOWLEDGE = [
    {
      id: "soh",
      title: "什么是 SOH？",
      summary: "State of Health，电池健康状态，常用当前容量相对标称容量的百分比表示。",
      body:
        "SOH（State of Health）描述电池相对全新状态的健康程度。工程上常用「当前可放出容量 / 标称容量」来估算。平台中的 SOH 大数字帮助你快速回答：我的电池现在怎么样？",
    },
    {
      id: "rul",
      title: "什么是 RUL？",
      summary: "Remaining Useful Life，剩余使用寿命，常用剩余循环次数表示。",
      body:
        "RUL 估计电池在达到失效阈值（如 SOH=80%）前还能经历多少次有效循环。因工况与不确定性存在，本平台输出区间而非单点。",
    },
    {
      id: "fade",
      title: "什么是容量衰减？",
      summary: "随循环累积，可放出容量逐渐下降的现象。",
      body:
        "容量衰减由电极活性材料损失、SEI 生长、锂库存减少等机制驱动。衰减曲线常表现为前期缓慢、后期加速。",
    },
    {
      id: "recover",
      title: "为什么会出现容量回升？",
      summary: "短暂停息或工况变化后，测得容量偶发高于前一循环。",
      body:
        "容量回升可能来自测量噪声、温度差异、弛豫后锂再分布等，不一定代表真实“恢复”。分析时应结合滑动平均与区间带宽理解波动。",
    },
    {
      id: "c-rate",
      title: "什么是充放电倍率？",
      summary: "电流相对额定容量的倍数，记作 C-rate。",
      body:
        "例如 1C 表示一小时充满/放空的电流。高倍率会加剧极化与产热，可能加速衰减，是健康管理中需要关注的工况特征。",
    },
    {
      id: "temp",
      title: "温度为什么影响寿命？",
      summary: "高温加速副反应，低温增加极化与析锂风险。",
      body:
        "适宜温度有助于延缓衰减。异常监测中的温度项用于识别过热或骤变片段。",
    },
    {
      id: "eol",
      title: "什么是电池失效阈值？",
      summary: "判定寿命终点的健康指标门槛，EV 常用 SOH=80%。",
      body:
        "IEC 等相关规范中，牵引电池常以剩余容量降至标称的 80% 作为寿命终点参考。趋势图中的红色虚线即该阈值。",
    },
    {
      id: "interval",
      title: "如何理解 RUL 区间预测？",
      summary: "下界偏保守，上界偏乐观，中心为点估计。",
      body:
        "区间宽度反映不确定性：数据噪声大、预测步数远时带宽通常更宽。运维决策建议优先参考下界，并持续用新数据刷新预测。",
    },
  ];

  function renderKnowledge() {
    const grid = $("#knowledge-grid");
    if (!grid) return;
    grid.innerHTML = KNOWLEDGE.map(function (k) {
      return (
        '<article class="knowledge-card" data-id="' +
        k.id +
        '">' +
        "<h4>" +
        escapeHtml(k.title) +
        "</h4>" +
        "<p>" +
        escapeHtml(k.summary) +
        "</p>" +
        '<button type="button" class="btn btn-outline btn-sm btn-open-knowledge">阅读</button>' +
        "</article>"
      );
    }).join("");

    grid.querySelectorAll(".btn-open-knowledge").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const id = btn.closest(".knowledge-card").getAttribute("data-id");
        openKnowledge(id);
      });
    });
  }

  function openKnowledge(id) {
    const k = KNOWLEDGE.find(function (x) {
      return x.id === id;
    });
    if (!k) return;
    const box = $("#knowledge-article");
    box.hidden = false;
    $("#knowledge-article-title").textContent = k.title;
    $("#knowledge-article-body").textContent = k.body;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ========== AI 助手 ========== */
  function refreshAssistantCtx() {
    const bat = BatteryAI.getActiveBattery();
    const box = $("#assistant-ctx");
    if (!box || !bat) return;
    const anomaly = BatteryAI.mock.lastAnomalyReport;
    box.innerHTML =
      '<div class="ctx-line"><span class="k">电池</span><span class="v">' +
      escapeHtml(bat.name) +
      "</span></div>" +
      '<div class="ctx-line"><span class="k">SOH</span><span class="v">' +
      bat.soh.toFixed(1) +
      "%</span></div>" +
      '<div class="ctx-line"><span class="k">循环</span><span class="v">' +
      bat.cycle +
      "</span></div>" +
      '<div class="ctx-line"><span class="k">RUL</span><span class="v">' +
      bat.rul.lower +
      "–" +
      bat.rul.upper +
      "</span></div>" +
      '<div class="ctx-line"><span class="k">异常</span><span class="v">' +
      (anomaly ? anomaly.maxLevel + "（" + anomaly.count + " 项）" : "未检测") +
      "</span></div>";
  }

  function appendChat(role, text) {
    const log = $("#chat-log");
    if (!log) return;
    const div = document.createElement("div");
    div.className = "chat-bubble " + role;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function answerWithContext(question) {
    const bat = BatteryAI.getActiveBattery();
    const q = question.toLowerCase();
    const rul = bat.rul;
    const anomaly = BatteryAI.mock.lastAnomalyReport;

    if (q.indexOf("区间") >= 0 || q.indexOf("rul") >= 0) {
      return (
        "你的 RUL 以区间给出：下界 " +
        rul.lower +
        "、中心 " +
        rul.mid +
        "、上界 " +
        rul.upper +
        " cycles。区间表达不确定性——数据噪声、工况差异都会让点估计不够稳。运维上建议更关注下界 " +
        rul.lower +
        "。"
      );
    }
    if (q.indexOf("soh") >= 0 || q.indexOf("下降") >= 0 || q.indexOf("快") >= 0) {
      return (
        "当前「" +
        bat.name +
        "」SOH 约 " +
        bat.soh.toFixed(1) +
        "%，已运行 " +
        bat.cycle +
        " 次循环。若感觉下降偏快，可对照异常监测：近期衰减是否高于历史均值。结合你的 RUL 下界 " +
        rul.lower +
        " cycles 做保守安排更稳妥。"
      );
    }
    if (q.indexOf("回升") >= 0) {
      return (
        "容量回升不一定代表电池“变好”，常见于测量误差、温度差或弛豫。结合你当前 SOH " +
        bat.soh.toFixed(1) +
        "% 与趋势图的区间带一起看，避免被单点跳动误导。"
      );
    }
    if (q.indexOf("预测") >= 0 || q.indexOf("结果") >= 0 || q.indexOf("理解") >= 0) {
      return (
        "理解预测结果可以抓三条：1）SOH=" +
        bat.soh.toFixed(1) +
        "% 回答“现在怎么样”；2）RUL " +
        rul.lower +
        "–" +
        rul.upper +
        " 回答“还能多久”；3）趋势图里历史/区间带/80% 失效线回答“何时进入风险区”。" +
        (anomaly ? " 当前异常最高等级为「" + anomaly.maxLevel + "」。" : "")
      );
    }
    return (
      "我结合「" +
      bat.name +
      "」的上下文来看：SOH " +
      bat.soh.toFixed(1) +
      "%，循环 " +
      bat.cycle +
      "，RUL " +
      rul.lower +
      "–" +
      rul.upper +
      " cycles。" +
      (anomaly ? "异常等级「" + anomaly.maxLevel + "」。" : "") +
      "你可以问 SOH 下降、RUL 区间、容量回升或如何读预测图。（本地模拟回复，可替换为 LLM API）"
    );
  }

  function handleChat(text) {
    const q = (text || "").trim();
    if (!q) return;
    appendChat("user", q);

    const bat = BatteryAI.getActiveBattery();
    const log = document.getElementById("chat-log");
    const history = [];
    if (log) {
      const bubbles = Array.from(log.querySelectorAll(".chat-bubble"));
      // 去掉刚刚追加的最后一条 user，只传更早的对话
      bubbles.slice(0, -1).forEach(function (el) {
        history.push({
          role: el.classList.contains("user") ? "user" : "assistant",
          content: el.textContent || "",
        });
      });
    }

    appendChat("assistant", "正在思考…");
    const thinking = log && log.lastElementChild;

    const finish = function (reply) {
      if (thinking && thinking.parentNode) thinking.remove();
      appendChat("assistant", reply);
    };

    if (BatteryAI.api && BatteryAI.api.batteryChat) {
      BatteryAI.api.batteryChat(q, bat, history).then(function (remote) {
        finish(remote || answerWithContext(q));
      });
    } else {
      setTimeout(function () {
        finish(answerWithContext(q));
      }, 350);
    }
  }

  function ensureChatWelcome() {
    const log = $("#chat-log");
    if (!log || log.children.length) return;
    const bat = BatteryAI.getActiveBattery();
    appendChat(
      "assistant",
      "你好，我是 AI 电池助手。当前关注「" +
        bat.name +
        "」（SOH " +
        bat.soh.toFixed(1) +
        "%，RUL " +
        bat.rul.lower +
        "–" +
        bat.rul.upper +
        "）。可以直接提问，或点左侧快捷问题。"
    );
  }

  /* ========== 生命周期 ========== */
  function onEnter(viewId) {
    if (viewId === "history") renderHistory();
    if (viewId === "knowledge") renderKnowledge();
    if (viewId === "assistant") {
      refreshAssistantCtx();
      ensureChatWelcome();
    }
    if (viewId === "reports") {
      // 保留已生成报告；不自动清空
    }
  }

  function exportPdf() {
    const doc = $("#report-doc");
    const btn = $("#btn-export-pdf");
    if (!doc) return;

    // 尚未生成时先自动生成报告
    if (doc.hidden) {
      generateReport();
    }
    if (doc.hidden) {
      alert("请先生成报告后再导出 PDF。");
      return;
    }

    if (typeof html2pdf === "undefined") {
      alert("PDF 组件未加载完成，请稍后重试或检查网络（需加载 html2pdf.js）。");
      return;
    }

    const bat = BatteryAI.getActiveBattery();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename =
      "电池健康报告_" +
      (bat && bat.name ? bat.name.replace(/[\\/:*?"<>|]/g, "_") : "BatteryAI") +
      "_" +
      stamp +
      ".pdf";

    const opt = {
      margin: [12, 12, 12, 12],
      filename: filename,
      image: { type: "jpeg", quality: 0.96 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        scrollX: 0,
        scrollY: 0,
      },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] },
    };

    const prevText = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "正在导出…";
    }

    // 导出时临时去掉阴影，减少截图像素问题
    const prevShadow = doc.style.boxShadow;
    doc.style.boxShadow = "none";

    html2pdf()
      .set(opt)
      .from(doc)
      .save()
      .then(function () {
        doc.style.boxShadow = prevShadow;
        if (btn) {
          btn.disabled = false;
          btn.textContent = prevText || "导出 PDF";
        }
      })
      .catch(function (err) {
        console.error("PDF 导出失败:", err);
        doc.style.boxShadow = prevShadow;
        if (btn) {
          btn.disabled = false;
          btn.textContent = prevText || "导出 PDF";
        }
        alert("PDF 导出失败：" + (err && err.message ? err.message : "未知错误"));
      });
  }

  function bind() {
    const gen = $("#btn-generate-report");
    if (gen) gen.addEventListener("click", generateReport);

    const pdf = $("#btn-export-pdf");
    if (pdf) pdf.addEventListener("click", exportPdf);

    const closeK = $("#btn-close-knowledge");
    if (closeK) {
      closeK.addEventListener("click", function () {
        $("#knowledge-article").hidden = true;
      });
    }

    const form = $("#chat-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        const input = $("#chat-input");
        handleChat(input.value);
        input.value = "";
      });
    }

    document.querySelectorAll(".assistant-suggest").forEach(function (btn) {
      btn.addEventListener("click", function () {
        handleChat(btn.textContent);
      });
    });
  }

  return {
    bind,
    onEnter,
    renderHistory,
    generateReport,
  };
})();
