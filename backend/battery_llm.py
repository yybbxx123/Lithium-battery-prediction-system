"""
锂电池健康管理 — DeepSeek API 调用
调用方式对齐 backend/main.py 中的 call_deepseek（httpx + Bearer + chat/completions）。

依赖:
  pip install httpx python-dotenv

环境变量:
  DEEPSEEK_API_KEY=你的密钥

用法示例:
  python battery_llm.py
  或在其他模块中:
    from battery_llm import analyze_battery_health, chat_about_battery
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
DEEPSEEK_MODEL = "deepseek-chat"


# ---------------------------------------------------------------------------
# 底层调用（与 main.py 保持一致）
# ---------------------------------------------------------------------------

async def call_deepseek(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.7,
    timeout: float = 60.0,
) -> str:
    """调用 DeepSeek Chat Completions，返回助手文本内容。"""
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY 未配置，请在 .env 中设置")

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            DEEPSEEK_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": DEEPSEEK_MODEL,
                "messages": messages,
                "temperature": temperature,
            },
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"DeepSeek 调用失败: {resp.text}")
        return resp.json()["choices"][0]["message"]["content"]


# ---------------------------------------------------------------------------
# 提示词（锂电池健康 / RUL 区间 / 异常解读）
# ---------------------------------------------------------------------------

def build_health_insight_prompt(battery: dict[str, Any], anomalies: list[dict[str, Any]] | None = None) -> str:
    """生成「AI 健康分析」用户提示词。"""
    anomalies = anomalies or []
    return f"""
你是锂电池健康管理专家，擅长 SOH、RUL 区间预测与异常解读。
请根据以下电池上下文，用中文给出专业但易懂的健康分析。

【电池上下文】
{json.dumps(battery, ensure_ascii=False, indent=2)}

【异常检测摘要】
{json.dumps(anomalies, ensure_ascii=False, indent=2)}

要求:
1) 结合 SOH、循环次数、RUL 下界/中心/上界进行说明，强调区间含义（下界偏保守）。
2) 若有异常，说明可能原因与可执行建议；若无异常，说明当前处于何种老化阶段。
3) 不要编造未给出的数据；不要给出危险或违法操作建议。
4) 严格输出 JSON，不要输出其他内容。

输出格式:
{{
  "summary": "一句话健康结论",
  "soh_comment": "对当前 SOH 的解读",
  "rul_comment": "对 RUL 区间的解读（必须提到下界/中心/上界）",
  "anomaly_comment": "对异常的解读；无异常时说明“未发现显著异常”",
  "suggestions": ["建议1", "建议2", "建议3"],
  "risk_level": "低|中|高"
}}
""".strip()


def build_assistant_system_prompt(battery: dict[str, Any]) -> str:
    """AI 电池助手的 system 提示词（结合当前电池上下文）。"""
    return f"""
你是「睿芯鉴寿」平台中的 AI 电池助手。
你必须结合用户当前关注的电池数据回答，而不是做一个脱离数据的通用聊天机器人。

当前电池上下文:
{json.dumps(battery, ensure_ascii=False, indent=2)}

回答原则:
1) 优先使用上下文中的 SOH、循环次数、RUL 区间、容量与异常信息。
2) 解释 RUL 时强调：下界偏保守、中心为点估计、上界偏乐观；运维建议优先看下界。
3) 语言简洁、专业、中文；单次回答控制在 80–200 字。
4) 不编造医学/人身伤害相关结论；不做违法或危险建议。
5) 若用户问题与电池无关，礼貌引导回电池健康、预测或异常相关话题。
""".strip()


def normalize_chat_history(history: list[dict[str, str]]) -> list[dict[str, str]]:
    """与 main.py 类似：只保留最近若干轮，统一 role/content。"""
    messages: list[dict[str, str]] = []
    for item in history[-6:]:
        role = item.get("role")
        content = item.get("text") or item.get("content") or ""
        if not content:
            continue
        if role == "user":
            messages.append({"role": "user", "content": content})
        elif role in {"assistant", "character", "ai"}:
            messages.append({"role": "assistant", "content": content})
    return messages


# ---------------------------------------------------------------------------
# 业务封装
# ---------------------------------------------------------------------------

async def analyze_battery_health(
    battery: dict[str, Any],
    anomalies: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """调用模型生成健康分析 JSON；解析失败时回退为文本字段。"""
    content = await call_deepseek(
        [
            {
                "role": "system",
                "content": "你是锂电池健康管理专家，输出必须是合法 JSON。",
            },
            {
                "role": "user",
                "content": build_health_insight_prompt(battery, anomalies),
            },
        ],
        temperature=0.5,
    )
    try:
        # 兼容模型偶发包裹 ```json
        text = content.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:].strip()
        return json.loads(text)
    except json.JSONDecodeError:
        return {
            "summary": "模型返回非 JSON，已按文本回退。",
            "soh_comment": "",
            "rul_comment": "",
            "anomaly_comment": "",
            "suggestions": [],
            "risk_level": "中",
            "raw_text": content,
        }


async def chat_about_battery(
    user_message: str,
    battery: dict[str, Any],
    chat_history: list[dict[str, str]] | None = None,
) -> str:
    """结合电池上下文的多轮问答。"""
    chat_history = chat_history or []
    content = await call_deepseek(
        [
            {"role": "system", "content": build_assistant_system_prompt(battery)},
            *normalize_chat_history(chat_history),
            {"role": "user", "content": user_message},
        ],
        temperature=0.7,
    )
    return content


# ---------------------------------------------------------------------------
# 本地试跑
# ---------------------------------------------------------------------------

DEMO_BATTERY = {
    "name": "我的18650电池",
    "model": "LG MJ1",
    "soh": 87.3,
    "cycle": 426,
    "current_capacity_ah": 2.18,
    "nominal_capacity_ah": 2.5,
    "rul": {"lower": 160, "mid": 183, "upper": 205},
    "status": "正常",
}

DEMO_ANOMALIES = [
    {
        "title": "容量衰减异常",
        "level": "轻微",
        "recent": "0.113% / cycle",
        "history": "0.021% / cycle",
        "status": "高于历史平均水平",
    }
]


async def _demo() -> None:
    print("=== 1) 健康分析 ===")
    analysis = await analyze_battery_health(DEMO_BATTERY, DEMO_ANOMALIES)
    print(json.dumps(analysis, ensure_ascii=False, indent=2))

    print("\n=== 2) 电池助手问答 ===")
    reply = await chat_about_battery(
        "为什么我的 RUL 是一个区间而不是一个确定数字？",
        DEMO_BATTERY,
        chat_history=[],
    )
    print(reply)


if __name__ == "__main__":
    asyncio.run(_demo())
