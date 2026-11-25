# -*- coding: utf-8 -*-
"""Vercel 版后端：/api/health —— 返回当前模型信息，供前端显示。"""
import json
import os
from http.server import BaseHTTPRequestHandler

NAMES = {
    "zhipu": "智谱 GLM-4V",
    "qwen": "通义千问 VL",
    "doubao": "豆包 视觉",
    "moonshot": "Kimi 视觉",
    "openai": "OpenAI GPT-4o",
    "gemini": "Google Gemini",
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        provider = os.environ.get("PROVIDER", "zhipu")
        obj = {
            "ok": True,
            "provider": NAMES.get(provider, provider),
            "model": os.environ.get("MODEL") or "",
            "has_key": bool(os.environ.get("API_KEY", "").strip()),
        }
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
