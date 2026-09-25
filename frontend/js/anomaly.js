/**
 * BatteryAI — 异常监测 + AI 健康分析（第五阶段）
 * 异常为前端示意；AI 文案写死但预留 LLM 插槽（#ai-health-text / data-llm-slot）
 */
window.BatteryAI = window.BatteryAI || {};

BatteryAI.anomaly = (function () {
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

  /** 按电池状态生成示意异常 */
  function buildAnomalyReport(battery) {
    const bat = battery || BatteryAI.getActiveBattery();
    const ds = BatteryAI.upload && BatteryAI.upload.getDataset ? BatteryAI.upload.getDataset() : null;

    const recentFade = bat.soh < 85 ? 0.113 : bat.status === "关注" ? 0.095 : 0.038;
    const histFade = 0.021;
    const capacityLevel = recentFade > histFade * 3 ? "轻微" : "无";
    const tempLevel = "无";
    const decayLevel = recentFade > 0.08 ? "轻微" : "无";

    const items = [];
    if (capacityLevel !== "无") {
      items.push({
        id: "cap",
        title: "容量衰减异常",
        level: capacityLevel,
        icon: "⚠",
        recent: recentFade.toFixed(3) + "% / cycle",
        history: histFade.toFixed(3) + "% / cycle",
        status: "高于历史平均水平",
        detail:
          "最近 10 个循环的平均容量衰减约为 " +
          recentFade.toFixed(3) +
          "%/cycle，显著高于历史平均 " +
          histFade.toFixed(3) +
          "%/cycle。可能与大电流工况或温度波动有关，建议继续采集后续循环。",
      });
    }
    if (decayLevel !== "无" && capacityLevel === "无") {
      items.push({
        id: "decay",
        title: "衰减速率异常",
        level: decayLevel,
        icon: "⚠",
        recent: recentFade.toFixed(3) + "% / cycle",
        history: histFade.toFixed(3) + "% / cycle",
        status: "略高于历史平均",
        detail: "衰减斜率略陡，尚未构成严重告警，可结合 RUL 下界做保守评估。",
      });
    }

    // 温度：多数正常；关注电池可示意无异常
    items.push({
      id: "temp",
      title: "温度异常",
      level: tempLevel,
      icon: tempLevel === "无" ? "✓" : "⚠",
      recent: "31.2 °C（近窗均值）",
      history: "30.5 °C",
      status: tempLevel === "无" ? "处于标称范围" : "偏高",
      detail:
        tempLevel === "无"
          ? "近窗温度稳定，未发现持续过热或骤变。"
          : "检测到温度偏高片段，请检查散热与负载。",
    });

    if (ds && ds.quality && ds.quality.anomalies > 0) {
      items.push({
        id: "data",
        title: "数据质量异常点",
        level: ds.quality.anomalies > 5 ? "中等" : "轻微",
        icon: "⚠",
        recent: ds.quality.anomalies + " 条可疑点",
        history: "上传数据集质检",
        status: "来自最近一次数据分析",
        detail:
          "上传数据中检测到 " +
          ds.quality.anomalies +
          " 条异常/跳变，完整度 " +
          ds.quality.completeness +
          "%。不影响示意预测，但建议清洗后再训练真实模型。",
      });
    }

    const activeItems = items.filter((x) => x.level !== "无");
    const levelRank = { 无: 0, 轻微: 1, 中等: 2, 严重: 3 };
    let maxLevel = "无";
    activeItems.forEach((it) => {
      if (levelRank[it.level] > levelRank[maxLevel]) maxLevel = it.level;
    });

    const levels = {
      capacity: capacityLevel,
      temperature: tempLevel,
      decay: decayLevel,
    };

    return {
      batteryId: bat.id,
      batteryName: bat.name,
      checkedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      count: activeItems.length,
      maxLevel,
      levels,
      items,
      overall: maxLevel === "无" ? "正常" : maxLevel === "轻微" ? "需关注" : "告警",
      overallHint:
        maxLevel === "无"
          ? "未发现显著异常"
          : "存在 " + maxLevel + " 级异常，建议查看详情与 AI 分析",
    };
  }

  /**
   * 生成 AI 健康分析文案（写死逻辑，绑定电池上下文）
   * 未来可替换为：fetchLLMHealthInsight(ctx) → 写入 #ai-health-text
   */
  function buildAiInsight(battery, report) {
    const bat = battery;
    const r = bat.rul || { lower: "—", mid: "—", upper: "—" };
    const hasCap = report.items.some((i) => i.id === "cap" || i.id === "decay");

    let text =
      "针对「" +
      bat.name +
      "」（" +
      bat.model +
      "）：当前 SOH 约为 " +
      bat.soh.toFixed(1) +
      "%，累计循环 " +
      bat.cycle +
      " 次，RUL 区间约 " +
      r.lower +
      "–" +
      r.upper +
      " cycles（中心 " +
      r.mid +
      "）。";

    if (hasCap) {
      text +=
        "近期容量下降速度高于历史平均水平，同时可能存在一定容量波动。当前数据暂未显示明显严重异常，但建议继续采集后续循环数据，以提高剩余寿命区间预测的稳定性。决策时请优先参考 RUL 下界。";
    } else {
      text +=
        "各项监测指标整体平稳，衰减处于正常老化通道。建议保持当前充放电策略，并定期上传循环数据以刷新区间预测。";
    }

    text += "（本段为前端示意分析，结构已预留云端大模型 API 接入位。）";
    return text;
  }

  /** 预留：未来 LLM 调用入口 */
  async function fetchLLMHealthInsight(ctx) {
    if (!BatteryAI.api || !BatteryAI.api.healthInsight) return null;
    const bat = BatteryAI.getActiveBattery();
    const anomalies = (ctx && ctx.anomalies) || [];
    return BatteryAI.api.healthInsight(bat, anomalies);
  }

  function levelClass(level) {
    if (level === "严重") return "danger";
    if (level === "中等") return "warn";
    if (level === "轻微") return "warn";
    return "ok";
  }

  function render(report) {
    const bat = BatteryAI.getActiveBattery();
    if (!report) report = buildAnomalyReport(bat);

    BatteryAI.mock.lastAnomalyReport = report;

    const line = $("#anomaly-battery-line");
    if (line) {
      line.textContent =
        "当前关注：" + bat.name + "（" + bat.model + "）· SOH " + bat.soh.toFixed(1) + "% · 循环 " + bat.cycle;
    }

    const set = (id, text) => {
      const el = $(id);
      if (el) el.textContent = text;
    };

    set("#anomaly-last-time", report.checkedAt);
    set("#anomaly-count", String(report.count));
    set("#anomaly-max-level", report.maxLevel);
    set("#anomaly-overall", report.overall);
    set("#anomaly-overall-hint", report.overallHint);

    const maxEl = $("#anomaly-max-level");
    if (maxEl) {
      maxEl.className = "kpi-value " + (report.maxLevel === "无" ? "teal" : "amber");
      maxEl.style.fontSize = "1.35rem";
    }

    const levelCards = $("#anomaly-level-cards");
    if (levelCards) {
      const rows = [
        { key: "capacity", title: "容量异常", level: report.levels.capacity },
        { key: "temperature", title: "温度异常", level: report.levels.temperature },
        { key: "decay", title: "衰减异常", level: report.levels.decay },
      ];
      levelCards.innerHTML = rows
        .map(
          (r) =>
            '<article class="anomaly-level-card level-' +
            levelClass(r.level) +
            '">' +
            '<div class="t">' +
            escapeHtml(r.title) +
            "</div>" +
            '<div class="lv">' +
            escapeHtml(r.level) +
            "</div>" +
            "</article>"
        )
        .join("");
    }

    const list = $("#anomaly-detail-list");
    if (list) {
      list.innerHTML = report.items
        .map((it) => {
          return (
            '<article class="anomaly-card" data-id="' +
            escapeHtml(it.id) +
            '">' +
            '<div class="anomaly-card-head">' +
            '<div class="left"><span class="ico">' +
            it.icon +
            '</span><div><div class="title">' +
            escapeHtml(it.title) +
            '</div><div class="status">' +
            escapeHtml(it.status) +
            "</div></div></div>" +
            '<span class="tag ' +
            levelClass(it.level) +
            '">' +
            escapeHtml(it.level) +
            "</span>" +
            "</div>" +
            '<div class="anomaly-card-stats">' +
            '<div><span class="k">最近指标</span><span class="v">' +
            escapeHtml(it.recent) +
            "</span></div>" +
            '<div><span class="k">历史参考</span><span class="v">' +
            escapeHtml(it.history) +
            "</span></div>" +
            "</div>" +
            '<div class="anomaly-card-detail" hidden>' +
            "<p>" +
            escapeHtml(it.detail) +
            "</p>" +
            '<button type="button" class="btn btn-outline btn-sm btn-close-detail">收起</button>' +
            "</div>" +
            '<button type="button" class="btn btn-primary btn-sm btn-view-anomaly">查看异常分析</button>' +
            "</article>"
          );
        })
        .join("");

      list.querySelectorAll(".btn-view-anomaly").forEach((btn) => {
        btn.addEventListener("click", () => {
          const card = btn.closest(".anomaly-card");
          const detail = card.querySelector(".anomaly-card-detail");
          detail.hidden = false;
          btn.hidden = true;
        });
      });
      list.querySelectorAll(".btn-close-detail").forEach((btn) => {
        btn.addEventListener("click", () => {
          const card = btn.closest(".anomaly-card");
          card.querySelector(".anomaly-card-detail").hidden = true;
          card.querySelector(".btn-view-anomaly").hidden = false;
        });
      });
    }

    renderAiInsight(bat, report);
  }

  async function renderAiInsight(bat, report) {
    const textEl = $("#ai-health-text");
    const sourceEl = $("#ai-health-source");
    if (!textEl) return;

    textEl.textContent = "正在结合电池上下文生成分析……";

    // 先尝试预留的 LLM 接口；失败则回退本地文案
    let remote = null;
    try {
      remote = await fetchLLMHealthInsight({
        batteryId: bat.id,
        soh: bat.soh,
        cycle: bat.cycle,
        rul: bat.rul,
        anomalies: report.items,
      });
    } catch (_) {
      remote = null;
    }

    const text = remote || buildAiInsight(bat, report);
    textEl.textContent = text;
    if (sourceEl) {
      sourceEl.textContent = remote
        ? "数据来源：云端 LLM API"
        : "数据来源：本地示意分析（已绑定 SOH / 循环 / RUL / 异常）";
    }
  }

  function refresh() {
    const bat = BatteryAI.getActiveBattery();
    const report = buildAnomalyReport(bat);
    render(report);
  }

  function onEnter() {
    refresh();
  }

  function bind() {
    const btn = $("#btn-refresh-anomaly");
    if (btn) btn.addEventListener("click", refresh);

    const regen = $("#btn-regen-ai-health");
    if (regen) {
      regen.addEventListener("click", () => {
        const bat = BatteryAI.getActiveBattery();
        const report = BatteryAI.mock.lastAnomalyReport || buildAnomalyReport(bat);
        renderAiInsight(bat, report);
      });
    }
  }

  return {
    bind,
    onEnter,
    refresh,
    buildAnomalyReport,
    buildAiInsight,
    fetchLLMHealthInsight,
  };
})();
