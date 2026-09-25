/**
 * BatteryAI — 我的电池 / 电池详情 / 添加弹窗（第二阶段）
 */
window.BatteryAI = window.BatteryAI || {};

BatteryAI.batteryUI = (function () {
  "use strict";

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function statusClass(status) {
    if (status === "关注" || status === "警告") return "warn";
    if (status === "严重") return "danger";
    return "ok";
  }

  function rulPct(rul) {
    const span = rul.upper - rul.lower || 1;
    return Math.min(98, Math.max(2, ((rul.mid - rul.lower) / span) * 100));
  }

  function renderList() {
    const grid = $("#battery-grid");
    if (!grid) return;

    const list = BatteryAI.mock.batteries;
    grid.innerHTML = list
      .map((b) => {
        const active = b.id === BatteryAI.mock.activeBatteryId;
        return (
          '<article class="battery-card' +
          (active ? " is-active" : "") +
          '" data-id="' +
          b.id +
          '">' +
          '<div class="battery-card-top">' +
          "<div>" +
          '<div class="battery-name">' +
          escapeHtml(b.name) +
          "</div>" +
          '<div class="battery-model">型号：' +
          escapeHtml(b.model) +
          "</div>" +
          "</div>" +
          '<span class="tag ' +
          statusClass(b.status) +
          '">' +
          escapeHtml(b.status) +
          "</span>" +
          "</div>" +
          '<div class="battery-stats">' +
          '<div><span class="k">SOH</span><span class="v teal">' +
          b.soh.toFixed(1) +
          "%</span></div>" +
          '<div><span class="k">循环</span><span class="v">' +
          b.cycle +
          "</span></div>" +
          '<div><span class="k">RUL</span><span class="v blue">' +
          b.rul.lower +
          "–" +
          b.rul.upper +
          "</span></div>" +
          '<div><span class="k">中心</span><span class="v">' +
          b.rul.mid +
          " cycles</span></div>" +
          "</div>" +
          '<div class="battery-card-actions">' +
          (active
            ? '<span class="chip-active">当前关注</span>'
            : '<button type="button" class="btn btn-ghost btn-sm" data-set-active="' +
              b.id +
              '">设为关注</button>') +
          '<button type="button" class="btn btn-primary btn-sm" data-open-detail="' +
          b.id +
          '">查看详情</button>' +
          "</div>" +
          "</article>"
        );
      })
      .join("");

    grid.querySelectorAll("[data-open-detail]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openDetail(btn.getAttribute("data-open-detail"));
      });
    });

    grid.querySelectorAll("[data-set-active]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        BatteryAI.setActiveBattery(btn.getAttribute("data-set-active"));
        renderList();
        if (typeof BatteryAI.refreshDashboard === "function") {
          BatteryAI.refreshDashboard();
        }
      });
    });

    grid.querySelectorAll(".battery-card").forEach((card) => {
      card.addEventListener("click", () => openDetail(card.getAttribute("data-id")));
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function openDetail(id) {
    const b = BatteryAI.getBattery(id);
    if (!b) return;
    BatteryAI.mock._detailId = id;
    fillDetail(b);
    if (typeof window.BatteryAINavigate === "function") {
      window.BatteryAINavigate("battery-detail");
    }
    requestAnimationFrame(() => {
      if (BatteryAI.charts) {
        BatteryAI.charts.renderDetailTrend("chart-detail-trend", b);
      }
    });
  }

  function fillDetail(b) {
    const set = (id, text) => {
      const el = $(id);
      if (el) el.textContent = text;
    };

    set("#detail-name", b.name);
    set("#detail-model-line", b.model + " · " + b.type);
    set("#detail-status", b.status);
    const statusEl = $("#detail-status");
    if (statusEl) {
      statusEl.className = "tag " + statusClass(b.status);
    }

    set("#detail-type", b.type);
    set("#detail-nominal", b.nominalCapacity.toFixed(2) + " Ah");
    set("#detail-voltage", b.voltage.toFixed(1) + " V");
    set("#detail-current-cap", b.currentCapacity.toFixed(2) + " Ah");
    set("#detail-cycle", String(b.cycle));
    set("#detail-usage", b.usageDays + " 天（自 " + b.startDate + "）");

    set("#detail-soh", b.soh.toFixed(1) + "%");
    set(
      "#detail-soh-ratio",
      b.currentCapacity.toFixed(2) + " Ah / " + b.nominalCapacity.toFixed(2) + " Ah"
    );

    set("#detail-rul-lower", String(b.rul.lower));
    set("#detail-rul-mid", String(b.rul.mid));
    set("#detail-rul-upper", String(b.rul.upper));
    set("#detail-rul-lower-v", b.rul.lower + " cycles");
    set("#detail-rul-mid-v", b.rul.mid + " cycles");
    set("#detail-rul-upper-v", b.rul.upper + " cycles");

    const dot = $("#detail-rul-dot");
    if (dot) dot.style.left = rulPct(b.rul) + "%";

    const lp = b.lastPrediction;
    set("#detail-pred-time", lp.time);
    set("#detail-pred-model", lp.model);
    set("#detail-pred-soh", lp.soh.toFixed(1) + "%");
    set(
      "#detail-pred-rul",
      lp.rul.lower + " – " + lp.rul.mid + " – " + lp.rul.upper + " cycles"
    );
  }

  function openModal() {
    const modal = $("#modal-add-battery");
    if (!modal) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    const form = $("#form-add-battery");
    if (form) form.reset();
  }

  function closeModal() {
    const modal = $("#modal-add-battery");
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  function onCreateBattery(e) {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    const model = form.model.value.trim();
    const type = form.type.value;
    const nominal = parseFloat(form.nominal.value);
    const voltage = parseFloat(form.voltage.value);
    const startDate = form.startDate.value || new Date().toISOString().slice(0, 10);

    if (!name || !model || Number.isNaN(nominal) || Number.isNaN(voltage)) {
      alert("请完整填写电池信息。");
      return;
    }

    const id = "bat-" + Date.now();
    const battery = {
      id,
      name,
      model,
      type,
      nominalCapacity: nominal,
      currentCapacity: Number((nominal * 0.98).toFixed(2)),
      voltage,
      soh: 98.0,
      cycle: 5,
      status: "正常",
      startDate,
      usageDays: 1,
      rul: { lower: 400, mid: 450, upper: 500 },
      coverage: 90.0,
      intervalWidth: 100,
      lastPrediction: {
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model: "待首次预测",
        soh: 98.0,
        rul: { lower: 400, mid: 450, upper: 500 },
      },
    };

    BatteryAI.mock.batteries.push(battery);
    BatteryAI.setActiveBattery(id);
    closeModal();
    renderList();
    if (typeof BatteryAI.refreshDashboard === "function") {
      BatteryAI.refreshDashboard();
    }
  }

  function bind() {
    const btnAdd = $("#btn-add-battery");
    if (btnAdd) btnAdd.addEventListener("click", openModal);

    const btnCancel = $("#btn-cancel-add");
    if (btnCancel) btnCancel.addEventListener("click", closeModal);

    const backdrop = $("#modal-add-battery");
    if (backdrop) {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeModal();
      });
    }

    const form = $("#form-add-battery");
    if (form) form.addEventListener("submit", onCreateBattery);

    const back = $("#btn-back-batteries");
    if (back) {
      back.addEventListener("click", () => {
        if (typeof window.BatteryAINavigate === "function") {
          window.BatteryAINavigate("batteries");
        }
      });
    }

    const setFocus = $("#btn-detail-set-active");
    if (setFocus) {
      setFocus.addEventListener("click", () => {
        const id = BatteryAI.mock._detailId;
        if (!id) return;
        BatteryAI.setActiveBattery(id);
        renderList();
        if (typeof BatteryAI.refreshDashboard === "function") {
          BatteryAI.refreshDashboard();
        }
        alert("已设为首页关注电池。");
      });
    }
  }

  function onEnterBatteries() {
    renderList();
  }

  function onEnterDetail() {
    const id = BatteryAI.mock._detailId || BatteryAI.mock.activeBatteryId;
    const b = BatteryAI.getBattery(id);
    if (b) {
      fillDetail(b);
      requestAnimationFrame(() => {
        if (BatteryAI.charts) BatteryAI.charts.renderDetailTrend("chart-detail-trend", b);
      });
    }
  }

  return {
    bind,
    renderList,
    openDetail,
    onEnterBatteries,
    onEnterDetail,
    openModal,
    closeModal,
  };
})();
