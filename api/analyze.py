# -*- coding: utf-8 -*-
"""
Vercel 版后端：/api/analyze
接收前端发来的图片(base64)，调用智谱视觉模型，返回结构化营养分析。
只用标准库；API Key 从环境变量 API_KEY 读取。
"""
import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

PROVIDERS = {
    "zhipu": {
        "name": "智谱 GLM-4V",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "model": "glm-4v-plus",
    },
    "qwen": {
        "name": "通义千问 VL",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-vl-max",
    },
    "doubao": {
        "name": "豆包 视觉",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "model": "doubao-1.5-vision-pro-32k-250115",
    },
    "moonshot": {
        "name": "Kimi 视觉",
        "base_url": "https://api.moonshot.cn/v1",
        "model": "moonshot-v1-8k-vision-preview",
    },
    "openai": {
        "name": "OpenAI GPT-4o",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o",
    },
    "gemini": {
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": "gemini-2.0-flash",
    },
}

SYSTEM_PROMPT = (
    "你是一名专业注册营养师。用户会发来一张饭菜照片。请只输出一个 JSON 对象，"
    "不要输出任何解释文字、不要用 Markdown 代码块。\n\n"
    "JSON 结构必须是：\n"
    "{\n"
    '  "foods": [\n'
    '    {"name": "食物名称", "amount": "估测份量(克)", "calories": 120, '
    '"protein": 5.2, "fat": 3.1, "carbs": 18.0}\n'
    "  ],\n"
    '  "total": {"calories": 0, "protein": 0, "fat": 0, "carbs": 0},\n'
    '  "good": ["优点1", "优点2"],\n'
    '  "bad": ["不足或风险1", "不足或风险2"],\n'
    '  "advice": "一句话改进建议"\n'
    "}\n\n"
    "规则：\n"
    "1. 列出照片里所有能看到的食物；按可食用部分估测克数，据此估算热量(千卡)、"
    "蛋白质(克)、脂肪(克)、碳水(克)，数值保留 1 位小数。\n"
    "2. total 为所有食物营养值之和。\n"
    "3. good 写 2~3 条营养优点；bad 写 2~3 条不足或潜在风险（如油盐糖偏高、蔬菜不足等）；"
    "advice 给出 1~2 句具体可执行的建议。\n"
    "4. 照片看不清时给出最接近的合理猜测，不要拒绝回答。\n"
    "5. 所有文字用中文。"
)


def _cfg():
    provider = os.environ.get("PROVIDER", "zhipu")
    preset = PROVIDERS.get(provider, {"name": provider, "base_url": "", "model": ""})
    return {
        "name": preset.get("name", provider),
        "base_url": os.environ.get("BASE_URL") or preset.get("base_url", ""),
        "model": os.environ.get("MODEL") or preset.get("model", ""),
        "api_key": os.environ.get("API_KEY", "").strip(),
    }


def parse_data_url(value):
    mime, b64 = "image/jpeg", value
    m = re.match(r"^data:([^;]+);base64,(.*)$", value, re.DOTALL)
    if m:
        mime, b64 = m.group(1), m.group(2)
    return mime, b64


def call_vision(cfg, mime, b64):
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    payload = {
        "model": cfg["model"],
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请分析这张饭菜照片，输出营养信息。"},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            },
        ],
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + cfg["api_key"],
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore")
        raise RuntimeError(f"模型接口返回错误（HTTP {exc.code}）：{body[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"无法连接模型接口：{exc.reason}") from exc
    try:
        return data["choices"][0]["message"]["content"]
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"接口返回结构异常：{json.dumps(data, ensure_ascii=False)[:300]}") from exc


def extract_json(text):
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except Exception:  # noqa: BLE001
            pass
    return None


def _f(v):
    try:
        return round(float(v), 1)
    except Exception:  # noqa: BLE001
        return 0.0


def _list(v):
    return v if isinstance(v, list) else []


def normalize(data, raw):
    if not isinstance(data, dict):
        return {"foods": [], "total": {}, "good": [], "bad": [], "advice": "", "raw": raw}
    foods = data.get("foods") if isinstance(data.get("foods"), list) else []
    norm_foods = []
    for item in foods:
        if not isinstance(item, dict):
            continue
        norm_foods.append(
            {
                "name": str(item.get("name", "未知")),
                "amount": str(item.get("amount", "—")),
                "calories": _f(item.get("calories")),
                "protein": _f(item.get("protein")),
                "fat": _f(item.get("fat")),
                "carbs": _f(item.get("carbs")),
            }
        )
    total = data.get("total") if isinstance(data.get("total"), dict) else {}
    total_norm = {
        "calories": _f(total.get("calories", sum(x["calories"] for x in norm_foods))),
        "protein": _f(total.get("protein", sum(x["protein"] for x in norm_foods))),
        "fat": _f(total.get("fat", sum(x["fat"] for x in norm_foods))),
        "carbs": _f(total.get("carbs", sum(x["carbs"] for x in norm_foods))),
    }
    return {
        "foods": norm_foods,
        "total": total_norm,
        "good": _list(data.get("good")),
        "bad": _list(data.get("bad")),
        "advice": str(data.get("advice", "")),
        "raw": "" if norm_foods else raw,
    }


class handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            req = json.loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001
            return self._json(400, {"error": "请求格式错误"})

        image = req.get("image", "")
        if not image:
            return self._json(400, {"error": "没有收到图片"})

        cfg = _cfg()
        if not cfg["api_key"]:
            return self._json(400, {"error": "还没配置 API_KEY：请在 Vercel 项目的环境变量里设置"})

        mime, b64 = parse_data_url(image)
        try:
            content = call_vision(cfg, mime, b64)
        except Exception as exc:  # noqa: BLE001
            return self._json(502, {"error": str(exc)})

        return self._json(200, normalize(extract_json(content), content))
