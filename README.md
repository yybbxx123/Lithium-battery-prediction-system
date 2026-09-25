# 睿芯鉴寿（BatteryAI）— 锂电池智能健康管理

大二开始做的锂电池预测 / 健康管理项目。当前交付为：浏览器端 SPA + 可选 DeepSeek 后端。

## 功能概览

- 仪表盘：SOH / RUL 区间与趋势
- 电池管理：列表、添加、详情
- 数据上传：CSV 间歇工况数据 → 质量门禁与分析
- AI 预测：流程动画 + RUL 区间结果（本地规则/模拟为主）
- 异常监测与健康分析文案（可走 DeepSeek，失败时前端本地兜底）
- 历史记录、报告导出（PDF）、知识中心、AI 助手对话

## 目录结构

```
个人/
├── frontend/          # 纯 HTML/CSS/JS 单页应用
│   ├── index.html
│   ├── css/
│   └── js/
├── backend/           # FastAPI + DeepSeek
│   ├── app.py         # HTTP 接口
│   ├── battery_llm.py # 模型调用与提示词
│   ├── requirements.txt
│   └── .env           # 密钥（勿提交）
├── README.md
└── 启动说明.md
```

## 技术说明

| 部分 | 技术 | 说明 |
|------|------|------|
| 前端 | 原生 SPA + Chart.js + html2pdf | 无 npm 构建；直接打开或本地静态服务 |
| 后端 | FastAPI + httpx + DeepSeek | 提供健康分析 / 助手接口；未启动时前端用本地文案 |

**注意：** 本项目不是 Node 前端工程，一般不用 `npm run dev`。完整启动步骤见 [启动说明.md](./启动说明.md)。

## 快速开始

1. 打开前端：用浏览器打开 `frontend/index.html`（或本地静态服务）
2. （可选）启动 LLM 后端，使「健康分析 / AI 助手」走真实 DeepSeek  
   → 详见 [启动说明.md](./启动说明.md)
