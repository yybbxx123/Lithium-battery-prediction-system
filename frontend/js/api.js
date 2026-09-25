/**
 * BatteryAI — 后端 API 客户端
 * 默认连接本地 FastAPI: http://127.0.0.1:8000
 * 可在控制台覆盖: window.BATTERY_API_BASE = "http://..."
 */
window.BatteryAI = window.BatteryAI || {};

BatteryAI.api = (function () {
  "use strict";

  function baseUrl() {
    if (typeof window.BATTERY_API_BASE === "string" && window.BATTERY_API_BASE) {
      return window.BATTERY_API_BASE.replace(/\/$/, "");
    }
    return "http://127.0.0.1:8000";
  }

  function toBatteryPayload(bat) {
    if (!bat) return null;
    return {
      id: bat.id || null,
      name: bat.name || "未知电池",
      model: bat.model || "",
      soh: bat.soh,
      cycle: bat.cycle,
      current_capacity_ah: bat.currentCapacity,
      nominal_capacity_ah: bat.nominalCapacity,
      rul: bat.rul || {},
      status: bat.status || "正常",
    };
  }

  async function postJson(path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () {
      ctrl.abort();
    }, 55000);
    try {
      const res = await fetch(baseUrl() + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        const detail = data.detail || res.statusText || "请求失败";
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** @returns {Promise<string|null>} 展示用文本；失败返回 null */
  async function healthInsight(battery, anomalies) {
    try {
      const data = await postJson("/api/health-insight", {
        battery: toBatteryPayload(battery),
        anomalies: anomalies || [],
      });
      return data.text || null;
    } catch (err) {
      console.warn("[BatteryAI.api] healthInsight 失败，将回退本地文案:", err);
      return null;
    }
  }

  /** @returns {Promise<string|null>} 助手回复；失败返回 null */
  async function batteryChat(userMessage, battery, chatHistory) {
    try {
      const data = await postJson("/api/battery-chat", {
        user_message: userMessage,
        battery: toBatteryPayload(battery),
        chat_history: chatHistory || [],
      });
      return data.reply || null;
    } catch (err) {
      console.warn("[BatteryAI.api] batteryChat 失败，将回退本地回复:", err);
      return null;
    }
  }

  async function ping() {
    try {
      const res = await fetch(baseUrl() + "/api/health", { method: "GET" });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  return {
    baseUrl: baseUrl,
    healthInsight: healthInsight,
    batteryChat: batteryChat,
    ping: ping,
    toBatteryPayload: toBatteryPayload,
  };
})();
