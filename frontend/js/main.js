/**
 * BatteryAI — 主壳：导航、Dashboard、阶段2 联动
 */
(function () {
  "use strict";

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    return y + "年" + m + "月" + day + "日 星期" + week;
  }

  function greetingByHour(h) {
    if (h < 5) return "夜深了";
    if (h < 11) return "上午好";
    if (h < 14) return "中午好";
    if (h < 18) return "下午好";
    return "晚上好";
  }

  function navigate(viewId) {
    const view = $("#view-" + viewId);
    if (!view) return;

    $all(".view").forEach((v) => v.classList.remove("active"));
    view.classList.add("active");

    $all(".nav-item").forEach((btn) => {
      const navView = btn.dataset.view;
      const active =
        navView === viewId ||
        (viewId === "battery-detail" && navView === "batteries");
      btn.classList.toggle("active", active);
    });

    const heading = $("#page-heading");
    const sub = $("#page-sub");
    if (heading) heading.textContent = view.dataset.title || viewId;
    if (sub) sub.textContent = view.dataset.sub || "";

    const sidebar = $("#sidebar");
    if (sidebar) sidebar.classList.remove("open");

    if (viewId === "dashboard" && BatteryAI.charts) {
      requestAnimationFrame(() => {
        BatteryAI.charts.renderDashboardTrend("chart-dashboard-trend");
      });
    }

    if (viewId === "batteries" && BatteryAI.batteryUI) {
      BatteryAI.batteryUI.onEnterBatteries();
    }

    if (viewId === "battery-detail" && BatteryAI.batteryUI) {
      BatteryAI.batteryUI.onEnterDetail();
    }

    if (viewId === "upload" && BatteryAI.upload) {
      BatteryAI.upload.fillBatterySelect();
    }

    if (viewId === "analysis" && BatteryAI.upload) {
      BatteryAI.upload.renderAnalysis();
    }

    if (viewId === "prediction" && BatteryAI.prediction) {
      BatteryAI.prediction.onEnter();
    }

    if (viewId === "anomaly" && BatteryAI.anomaly) {
      BatteryAI.anomaly.onEnter();
    }

    if (BatteryAI.support && ["history", "reports", "knowledge", "assistant"].indexOf(viewId) >= 0) {
      BatteryAI.support.onEnter(viewId);
    }

    try {
      history.replaceState(null, "", "#" + viewId);
    } catch (_) {}
  }

  function bindNav() {
    $all(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => navigate(btn.dataset.view));
    });

    document.body.addEventListener("click", (e) => {
      const goto = e.target.closest("[data-goto]");
      if (goto) navigate(goto.getAttribute("data-goto"));
    });

    const toggle = $("#menu-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        $("#sidebar").classList.toggle("open");
      });
    }

    const settings = $("#btn-settings");
    if (settings) {
      settings.addEventListener("click", () => {
        alert("设置页将在后续阶段接入（当前为演示原型）。");
      });
    }
  }

  function fillDashboard() {
    const b = BatteryAI.getActiveBattery();
    const sohEl = $("#kpi-soh");
    if (!sohEl || !b) return;

    sohEl.textContent = b.soh.toFixed(1) + "%";
    $("#kpi-rul").textContent = b.rul.lower + "–" + b.rul.upper;
    $("#kpi-rul-mid").textContent = String(b.rul.mid);
    $("#kpi-cycle").textContent = String(b.cycle);
    $("#kpi-cap").textContent = b.currentCapacity.toFixed(2) + " Ah";
    $("#kpi-cap-nom").textContent = b.nominalCapacity.toFixed(2) + " Ah";
    $("#health-score").textContent = b.soh.toFixed(1);
    $("#health-status").textContent = b.status;

    const span = b.rul.upper - b.rul.lower || 1;
    const pct = ((b.rul.mid - b.rul.lower) / span) * 100;
    const marker = $("#kpi-rul-marker");
    if (marker) marker.style.left = Math.min(98, Math.max(2, pct)) + "%";

    const greetSub = $(".welcome-text .sub");
    if (greetSub) {
      greetSub.textContent =
        "欢迎回来，查看你的电池健康状态。当前关注：" + b.name + "（" + b.model + "）";
    }

    if (BatteryAI.charts && $("#view-dashboard").classList.contains("active")) {
      BatteryAI.charts.renderDashboardTrend("chart-dashboard-trend");
    }
  }

  BatteryAI.refreshDashboard = fillDashboard;

  function initHeader() {
    const now = new Date();
    const dateEl = $("#today-date");
    if (dateEl) dateEl.textContent = formatDate(now);
    const greet = $("#welcome-greet");
    if (greet) greet.textContent = greetingByHour(now.getHours());
  }

  function start() {
    bindNav();
    initHeader();
    fillDashboard();

    if (BatteryAI.batteryUI) {
      BatteryAI.batteryUI.bind();
      const cancel2 = $("#btn-cancel-add-2");
      if (cancel2) cancel2.addEventListener("click", () => BatteryAI.batteryUI.closeModal());
    }

    if (BatteryAI.upload) {
      BatteryAI.upload.bind();
    }

    if (BatteryAI.prediction) {
      BatteryAI.prediction.bind();
    }

    if (BatteryAI.anomaly) {
      BatteryAI.anomaly.bind();
    }

    if (BatteryAI.support) {
      BatteryAI.support.bind();
    }

    const hash = (location.hash || "#dashboard").replace("#", "");
    navigate(hash || "dashboard");

    if (hash === "dashboard" || !hash) {
      BatteryAI.charts.renderDashboardTrend("chart-dashboard-trend");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.BatteryAINavigate = navigate;
})();
