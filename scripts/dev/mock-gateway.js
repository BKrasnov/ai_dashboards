#!/usr/bin/env node
// Mock for KitAI Public Integration API subset.
// Endpoints:
//   GET    /api/v1/agent
//   GET    /api/v1/agent/:id
//   POST   /api/v1/query/agent          -> register, returns { data: { queryId, success } }
//   GET    /api/v1/query/:id/result     -> poll; not final for first 2 calls, then final
//   PUT    /api/v1/query/:id/commit     -> ack, removes query from store
//   DELETE /api/v1/query/:id/cancel     -> { data: true }
//   GET    /health
import http from "node:http";
import { URL } from "node:url";

const port = process.env.MOCK_PORT ? Number(process.env.MOCK_PORT) : 3001;
const delayMs = process.env.MOCK_DELAY_MS ? Number(process.env.MOCK_DELAY_MS) : 300;

/** @type {Map<string, { query: string, calling_agent_name: string, extra: any, pollCount: number }>} */
const store = new Map();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
};

const sendJson = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch {
        resolve({});
      }
    });
  });

const buildChartOptions = (extra, prompt) => {
  const chartType = extra.chartType || "line";
  const xTitle = extra.xTitle || (chartType === "scatter" ? "X" : "Месяц");
  const yTitle = extra.yTitle || (chartType === "scatter" ? "Y" : "Оборот, млн ₽");
  const data = Array.isArray(extra.data)
    ? extra.data
    : [
        ["2024-01", 120],
        ["2024-02", 180],
        ["2024-03", 90],
        ["2024-04", 210]
      ];
  if (chartType === "pie") {
    return {
      chart: { type: "pie" },
      title: { text: "Pie (мок Дашбордер)" },
      tooltip: { pointFormat: "<b>{point.y}</b>" },
      series: [{ name: "Значение", data }]
    };
  }
  if (chartType === "scatter") {
    return {
      chart: { type: "scatter" },
      title: { text: "Scatter (мок Дашбордер)" },
      xAxis: { title: { text: xTitle } },
      yAxis: { title: { text: yTitle } },
      tooltip: { pointFormat: "<b>{point.x}, {point.y}</b>" },
      series: [{ name: "Точки", data }]
    };
  }
  return {
    chart: { type: "line" },
    title: { text: `Дашбордер: «${prompt.slice(0, 40)}»` },
    xAxis: { type: "category", title: { text: xTitle } },
    yAxis: { title: { text: yTitle } },
    tooltip: { pointFormat: "<b>{point.y}</b>" },
    series: [{ name: "Оборот", data }]
  };
};

const wantsChart = (entry) =>
  entry.extra?.wantChart === true || /график|chart|диаграм/i.test(entry.query);

const handleGetAgentList = (res) =>
  sendJson(res, 200, {
    description: "OK",
    data: [{ id: 1, name: "Dashboarder", description: "Мок-агент для дашбордов" }]
  });

const handleGetAgent = (res) =>
  sendJson(res, 200, {
    description: "OK",
    data: {
      id: 1,
      name: "Dashboarder",
      description: "Мок-агент для дашбордов",
      license_id: 0,
      model_id: 0,
      prompt_templates: ["Ты строишь дашборды."]
    }
  });

const handleRegister = async (req, res) => {
  const body = await readBody(req);
  const { query_id, calling_agent_name, query, ...extra } = body;
  if (!query_id || !calling_agent_name || !query) {
    return sendJson(res, 400, {
      description: "query_id, calling_agent_name, query are required"
    });
  }
  store.set(query_id, { query, calling_agent_name, extra, pollCount: 0 });
  return sendJson(res, 200, {
    description: "OK",
    data: { queryId: query_id, success: true }
  });
};

const handleResult = (res, queryId) => {
  const entry = store.get(queryId);
  if (!entry) return sendJson(res, 404, { description: "query not found" });
  entry.pollCount += 1;
  if (entry.pollCount < 3) {
    return setTimeout(
      () =>
        sendJson(res, 200, {
          description: "OK",
          data: {
            query_id: queryId,
            is_final: false,
            query_status: "RUNNING"
          }
        }),
      delayMs
    );
  }
  const content = `Моковый ответ агента «${entry.calling_agent_name}»: вы спросили «${entry.query}».`;
  const response = {
    id: "kitai-mock",
    object: "chat.completion",
    model: "gigachat/mock",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop"
      }
    ]
  };
  if (wantsChart(entry)) {
    response.chartOptions = buildChartOptions(entry.extra, entry.query);
  }
  return setTimeout(
    () =>
      sendJson(res, 200, {
        description: "OK",
        data: {
          query_id: queryId,
          is_final: true,
          query_status: "DONE",
          start_time: new Date(Date.now() - 500).toISOString(),
          finish_time: new Date().toISOString(),
          response_code: 200,
          response_body: JSON.stringify(response),
          response
        }
      }),
    delayMs
  );
};

const handleCommit = (res, queryId) => {
  store.delete(queryId);
  return sendJson(res, 200, { description: "OK", data: true });
};

const handleCancel = (res, queryId) => {
  store.delete(queryId);
  return sendJson(res, 200, { description: "OK", data: true });
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...corsHeaders, "Access-Control-Max-Age": "86400" });
    return res.end();
  }
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const p = url.pathname;
  const m = req.method;
  if (req.headers.authorization) {
    console.log(`[mock] auth header present on ${m} ${p}`);
  }
  if (m === "GET" && p === "/health") return sendJson(res, 200, { ok: true, mock: "kitai" });
  if (m === "GET" && p === "/api/v1/agent") return handleGetAgentList(res);
  const agentMatch = p.match(/^\/api\/v1\/agent\/([^/]+)$/);
  if (m === "GET" && agentMatch) return handleGetAgent(res);
  if (m === "POST" && p === "/api/v1/query/agent") return handleRegister(req, res);
  const qMatch = p.match(/^\/api\/v1\/query\/([^/]+)\/(result|commit|cancel)$/);
  if (qMatch) {
    const [, qid, action] = qMatch;
    if (m === "GET" && action === "result") return handleResult(res, qid);
    if (m === "PUT" && action === "commit") return handleCommit(res, qid);
    if (m === "DELETE" && action === "cancel") return handleCancel(res, qid);
  }
  return sendJson(res, 404, { error: "not found", path: p, method: m });
});

server.listen(port, () => {
  console.log(`Mock KitAI listening on http://localhost:${port}`);
});
