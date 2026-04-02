#!/usr/bin/env node
// Minimal mock for /chat to let the frontend work without GigaChat/gpt2giga/openclaw.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

const port = process.env.MOCK_PORT ? Number(process.env.MOCK_PORT) : 3001;
const delayMs = process.env.MOCK_DELAY_MS ? Number(process.env.MOCK_DELAY_MS) : 800;

const sendJson = (res, status, body) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Max-Age": "86400"
    });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, mock: true });
  }

  if (req.method === "POST" && url.pathname === "/chat") {
    const requestId = randomUUID();
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let prompt = "привет";
      let wantChart = false;
      let data = [
        ["2024-01", 120],
        ["2024-02", 180],
        ["2024-03", 90],
        ["2024-04", 210]
      ];
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
        const messages = parsed.messages || [];
        const last = messages[messages.length - 1];
        if (last?.content) prompt = String(last.content);
        if (/график|chart|диаграм/i.test(prompt) || parsed.wantChart === true) {
          wantChart = true;
          if (Array.isArray(parsed.data)) data = parsed.data;
        }
      } catch {
        // ignore parse errors
      }

      const jitter = (base) =>
        Math.max(50, Math.round(base + (Math.random() - 0.5) * 80)); // крупнее для наглядности
      const baseTrace = [
        { stage: "UI→Gateway", durMs: jitter(150), status: "ok" },
        { stage: "Gateway→gpt2giga", durMs: jitter(200), status: "ok" },
        { stage: "gpt2giga→GigaChat", durMs: jitter(300), status: "ok" },
        { stage: "GigaChat→UI", durMs: jitter(150), status: "ok" }
      ];

      const reply = `Моковый ответ: вы спросили «${prompt}». Реального запроса в GigaChat не было.`;
      const response = {
        id: "chatcmpl-mock",
        object: "chat.completion",
        model: "gigachat/GigaChat-Pro",
        requestId,
        trace: baseTrace,
        receivedPayload: parsed,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop"
          }
        ]
      };

      if (wantChart) {
        const chartType = parsed.chartType || "line";
        const xTitle = parsed.xTitle || (chartType === "scatter" ? "X" : "Месяц");
        const yTitle =
          parsed.yTitle || (chartType === "scatter" ? "Y" : "Оборот, млн ₽");

        if (chartType === "pie") {
          response.chartOptions = {
            chart: { type: "pie" },
            title: { text: "Pie (мок)" },
            tooltip: { pointFormat: "<b>{point.y}</b>" },
            series: [
              {
                name: "Значение",
                data
              }
            ]
          };
        } else if (chartType === "scatter") {
          response.chartOptions = {
            chart: { type: "scatter" },
            title: { text: "Scatter (мок)" },
            xAxis: { title: { text: xTitle } },
            yAxis: { title: { text: yTitle } },
            tooltip: { pointFormat: "<b>{point.x}, {point.y}</b>" },
            series: [
              {
                name: "Точки",
                data
              }
            ]
          };
        } else {
          response.chartOptions = {
            chart: { type: "line" },
            title: { text: "Моковый график (оборот по месяцам)" },
            xAxis: { type: "category", title: { text: xTitle } },
            yAxis: { title: { text: yTitle } },
            series: [
              {
                name: "Оборот",
                data
              }
            ],
            tooltip: { pointFormat: "<b>{point.y} млн ₽</b>" }
          };
        }
      }

      return setTimeout(() => sendJson(res, 200, response), delayMs);
    });
    return;
  }

  sendJson(res, 404, { error: "not found", mock: true });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Mock gateway listening on http://localhost:${port} (/chat, /health)`);
});
