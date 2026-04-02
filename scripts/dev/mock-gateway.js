#!/usr/bin/env node
// Minimal mock for /chat to let the frontend work without GigaChat/gpt2giga/openclaw.
import http from "node:http";
import { URL } from "node:url";

const port = process.env.MOCK_PORT ? Number(process.env.MOCK_PORT) : 3001;

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
      try {
        const parsed = JSON.parse(body || "{}");
        const messages = parsed.messages || [];
        const last = messages[messages.length - 1];
        if (last?.content) prompt = String(last.content);
        if (
          /график|chart|диаграмм/i.test(prompt) ||
          parsed.wantChart === true
        ) {
          wantChart = true;
          if (Array.isArray(parsed.data)) data = parsed.data;
        }
      } catch {
        // ignore parse errors
      }

      const reply = `Моковый ответ: вы спросили «${prompt}». Реального запроса в GigaChat не было.`;
      const response = {
        id: "chatcmpl-mock",
        object: "chat.completion",
        model: "gigachat/GigaChat-Pro",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop"
          }
        ]
      };

      if (wantChart) {
        response.chartOptions = {
          chart: { type: "line" },
          title: { text: "Моковый график (оборот по месяцам)" },
          xAxis: { type: "category", title: { text: "Месяц" } },
          yAxis: { title: { text: "Оборот, млн ₽" } },
          series: [
            {
              name: "Оборот",
              data
            }
          ],
          tooltip: { pointFormat: "<b>{point.y} млн ₽</b>" }
        };
      }

      return sendJson(res, 200, response);
    });
    return;
  }

  sendJson(res, 404, { error: "not found", mock: true });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Mock gateway listening on http://localhost:${port} (/chat, /health)`);
});
