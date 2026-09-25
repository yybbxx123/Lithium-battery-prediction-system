"""
锂电池智能健康管理 — FastAPI 服务
对外提供健康分析 / 电池助手接口，内部调用 battery_llm.call_deepseek。

启动:
  cd 个人/backend
  pip install -r requirements.txt
  # 配置 .env 中的 DEEPSEEK_API_KEY
  uvicorn app:app --reload --port 8000
"""

from __future__ import annotations

from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from battery_llm import analyze_battery_health, chat_about_battery

load_dotenv()

app = FastAPI(title="BatteryAI LLM API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BatteryPayload(BaseModel):
    name: str = "未知电池"
    model: str = ""
    soh: float = 0
    cycle: int = 0
    current_capacity_ah: float | None = None
    nominal_capacity_ah: float | None = None
    rul: dict[str, Any] = Field(default_factory=dict)
    status: str = "正常"
    id: str | None = None


class HealthInsightRequest(BaseModel):
    battery: BatteryPayload
    anomalies: list[dict[str, Any]] = Field(default_factory=list)


class BatteryChatRequest(BaseModel):
    user_message: str
    battery: BatteryPayload
    chat_history: list[dict[str, str]] = Field(default_factory=list)


def _battery_dict(b: BatteryPayload) -> dict[str, Any]:
    return b.model_dump()


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "BatteryAI LLM"}


@app.post("/api/health-insight")
async def health_insight(req: HealthInsightRequest) -> dict[str, Any]:
    """AI 健康分析：返回结构化 JSON + 拼接好的展示文本。"""
    try:
        data = await analyze_battery_health(_battery_dict(req.battery), req.anomalies)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"模型调用失败: {e}") from e

    # 拼成前端可直接展示的段落
    parts = [
        data.get("summary") or "",
        data.get("soh_comment") or "",
        data.get("rul_comment") or "",
        data.get("anomaly_comment") or "",
    ]
    suggestions = data.get("suggestions") or []
    if suggestions:
        parts.append("建议：" + "；".join(str(s) for s in suggestions))
    risk = data.get("risk_level")
    if risk:
        parts.append(f"风险等级：{risk}")
    if data.get("raw_text") and not data.get("summary"):
        text = str(data["raw_text"])
    else:
        text = "".join(p if p.endswith(("。", "！", "？", ";", "；")) else (p + "。") for p in parts if p)
        text = text.replace("。。", "。")

    return {"ok": True, "data": data, "text": text}


@app.post("/api/battery-chat")
async def battery_chat(req: BatteryChatRequest) -> dict[str, str]:
    """AI 电池助手多轮问答。"""
    if not (req.user_message or "").strip():
        raise HTTPException(status_code=400, detail="user_message 不能为空")
    try:
        reply = await chat_about_battery(
            req.user_message.strip(),
            _battery_dict(req.battery),
            req.chat_history,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"模型调用失败: {e}") from e
    return {"reply": reply}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
