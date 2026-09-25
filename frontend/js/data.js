/**
 * BatteryAI — 模拟数据
 * 阶段1：Dashboard 活动电池
 * 阶段2：多电池列表 + 详情趋势
 */
window.BatteryAI = window.BatteryAI || {};

BatteryAI.mock = {
  user: { name: "研究员", role: "演示账号" },

  batteries: [
    {
      id: "bat-001",
      name: "我的18650电池",
      model: "LG MJ1",
      type: "锂离子 18650",
      nominalCapacity: 2.5,
      currentCapacity: 2.18,
      voltage: 3.6,
      soh: 87.3,
      cycle: 426,
      status: "正常",
      startDate: "2024-03-12",
      usageDays: 562,
      rul: { lower: 160, mid: 183, upper: 205 },
      coverage: 94.2,
      intervalWidth: 45,
      lastPrediction: {
        time: "2026-09-26 14:20",
        model: "示意区间模型",
        soh: 87.3,
        rul: { lower: 160, mid: 183, upper: 205 },
      },
    },
    {
      id: "bat-002",
      name: "实验组 NCR18650B",
      model: "Panasonic NCR18650B",
      type: "锂离子 18650",
      nominalCapacity: 3.4,
      currentCapacity: 2.95,
      voltage: 3.6,
      soh: 86.8,
      cycle: 310,
      status: "正常",
      startDate: "2024-08-01",
      usageDays: 421,
      rul: { lower: 210, mid: 248, upper: 290 },
      coverage: 92.5,
      intervalWidth: 80,
      lastPrediction: {
        time: "2026-09-20 09:15",
        model: "示意区间模型",
        soh: 86.8,
        rul: { lower: 210, mid: 248, upper: 290 },
      },
    },
    {
      id: "bat-003",
      name: "备用软包电芯",
      model: "CATL 50Ah",
      type: "锂离子软包",
      nominalCapacity: 50.0,
      currentCapacity: 41.2,
      voltage: 3.7,
      soh: 82.4,
      cycle: 680,
      status: "关注",
      startDate: "2023-11-05",
      usageDays: 1025,
      rul: { lower: 95, mid: 128, upper: 165 },
      coverage: 91.0,
      intervalWidth: 70,
      lastPrediction: {
        time: "2026-09-18 16:40",
        model: "示意区间模型",
        soh: 82.4,
        rul: { lower: 95, mid: 128, upper: 165 },
      },
    },
    {
      id: "bat-004",
      name: "台架测试电芯 A1",
      model: "Samsung 30Q",
      type: "锂离子 18650",
      nominalCapacity: 3.0,
      currentCapacity: 2.76,
      voltage: 3.6,
      soh: 92.0,
      cycle: 180,
      status: "正常",
      startDate: "2025-06-20",
      usageDays: 98,
      rul: { lower: 320, mid: 365, upper: 410 },
      coverage: 95.1,
      intervalWidth: 90,
      lastPrediction: {
        time: "2026-09-12 11:05",
        model: "示意区间模型",
        soh: 92.0,
        rul: { lower: 320, mid: 365, upper: 410 },
      },
    },
  ],

  activeBatteryId: "bat-001",

  /** Dashboard / 详情共用趋势缓存：按 batteryId */
  trends: {},
};

BatteryAI.getBattery = function (id) {
  return BatteryAI.mock.batteries.find((b) => b.id === id) || null;
};

BatteryAI.getActiveBattery = function () {
  return (
    BatteryAI.getBattery(BatteryAI.mock.activeBatteryId) ||
    BatteryAI.mock.batteries[0]
  );
};

BatteryAI.setActiveBattery = function (id) {
  if (BatteryAI.getBattery(id)) {
    BatteryAI.mock.activeBatteryId = id;
  }
};

/** 兼容阶段1：activeBattery 指向当前活动电池 */
Object.defineProperty(BatteryAI.mock, "activeBattery", {
  get() {
    return BatteryAI.getActiveBattery();
  },
  enumerable: true,
});

BatteryAI.buildTrendFor = function (battery) {
  if (!battery) return null;
  if (BatteryAI.mock.trends[battery.id]) {
    return BatteryAI.mock.trends[battery.id];
  }

  const histC = [];
  const histS = [];
  const cycle = battery.cycle;
  const sohNow = battery.soh;
  const fade = (100 - sohNow) / Math.max(1, cycle);

  for (let c = 1; c <= cycle; c += Math.max(1, Math.floor(cycle / 50))) {
    histC.push(c);
    const soh = 100 - c * fade + Math.sin(c / 35) * 0.5;
    histS.push(Number(Math.max(sohNow - 2, Math.min(100.5, soh)).toFixed(2)));
  }
  histC.push(cycle);
  histS.push(sohNow);

  const futC = [];
  const futS = [];
  let s = sohNow;
  const step = 5;
  for (let i = 1; i <= 36; i++) {
    s -= fade * step * 0.85;
    futC.push(cycle + i * step);
    futS.push(Number(Math.max(70, s).toFixed(2)));
  }

  const trend = {
    historyCycles: histC,
    historySoh: histS,
    forecastCycles: futC,
    forecastSoh: futS,
    eol: 80,
  };
  BatteryAI.mock.trends[battery.id] = trend;
  return trend;
};

/** 阶段1 Dashboard 用的默认趋势 */
Object.defineProperty(BatteryAI.mock, "trend", {
  get() {
    return BatteryAI.buildTrendFor(BatteryAI.getActiveBattery());
  },
  enumerable: true,
});

// 预热默认电池趋势
BatteryAI.buildTrendFor(BatteryAI.getActiveBattery());

/** 阶段6：历史预测记录（示意） */
BatteryAI.mock.history = [
  {
    time: "2026-09-26 14:20",
    battery: "我的18650电池",
    batteryId: "bat-001",
    soh: 87.3,
    rulLower: 160,
    rulMid: 183,
    rulUpper: 205,
    model: "示意区间模型",
    status: "正常",
  },
  {
    time: "2026-09-20 09:15",
    battery: "实验组 NCR18650B",
    batteryId: "bat-002",
    soh: 86.8,
    rulLower: 210,
    rulMid: 248,
    rulUpper: 290,
    model: "示意区间模型",
    status: "正常",
  },
  {
    time: "2026-09-18 16:40",
    battery: "备用软包电芯",
    batteryId: "bat-003",
    soh: 82.4,
    rulLower: 95,
    rulMid: 128,
    rulUpper: 165,
    model: "示意区间模型",
    status: "关注",
  },
  {
    time: "2026-09-12 11:05",
    battery: "我的18650电池",
    batteryId: "bat-001",
    soh: 88.1,
    rulLower: 175,
    rulMid: 198,
    rulUpper: 220,
    model: "示意区间模型",
    status: "正常",
  },
];

BatteryAI.pushHistory = function (record) {
  BatteryAI.mock.history.unshift(record);
  if (BatteryAI.mock.history.length > 50) {
    BatteryAI.mock.history.length = 50;
  }
};
