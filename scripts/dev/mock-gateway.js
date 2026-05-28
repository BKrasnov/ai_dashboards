#!/usr/bin/env node
// Mock for KitAI Public Integration API subset with Dashboarder agent demo replies.
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

/** @type {Map<string, { query: string, calling_agent_name: string, extra: any, pollCount: number, streak: number }>} */
const store = new Map();

/** Process-wide tracker для симуляции 500 на 3-й одинаковый prompt подряд. */
let lastPromptCounter = { query: "", count: 0 };

const RAINBOW = ["#ff0000", "#ff7f00", "#ffff00", "#00ff00", "#0000ff", "#4b0082", "#800080"];

const PROMPT_OVERRIDES = {
  "создай столбчатую диаграмму графиков с цветами радуги, с любыми данными, категории: банк, департамент, трайб, ас": (q) => ({
    status: "ready",
    question: q,
    answer: {
      chart: { type: "column" },
      title: { text: "Столбчатая диаграмма с цветами радуги" },
      colors: ["#ff0000", "#ff7f00", "#ffff00", "#00ff00", "#0000ff", "#4b0082"],
      xAxis: { categories: ["Банк", "департамент", "трайб", "Ас"] },
      series: [{ name: "данные", data: [5, 15, 7, 9] }]
    }
  }),
  "создай столбчатую диаграмму графиков с цветами радуги, с любыми данными, категории: банк, департамент, трайб": (q) => ({
    status: "ready",
    question: q,
    answer: {
      chart: { type: "column" },
      title: { text: "Доходы по категориям" },
      colors: ["#ff00ff", "#ffff00", "#008000", "#ffa500", "#0000ff", "#dc143c"],
      xAxis: { categories: ["Банк", "департамент", "трайб"] },
      series: [{ name: "Доходы", data: [50, 70, 90] }]
    }
  }),
  "создай столбчатую диаграмму графиков с цветами радуги": () => ({
    status: "need_more_info",
    questions: [
      {
        id: "unique_question_id_1",
        text: "Какие категории и значения вы хотите отобразить на диаграмме?",
        hint: "Например: [{\"name\": \"Категория1\", \"y\": 10}, ...]"
      }
    ],
    already_known: { user_input: "создай столбчатую диаграмму графиков с цветами радуги" }
  }),
  "создай столбчатую диаграмму графиков с цветами радуги с любыми категориями": (q) => ({
    status: "ready",
    question: q,
    answer: {
      chart: { type: "column" },
      title: { text: "Столбчатая диаграмма с цветами радуги" },
      colors: RAINBOW,
      xAxis: { categories: [] },
      series: []
    }
  }),
  "сделай диаграмму": (q) => ({
    status: "need_more_info",
    questions: [
      {
        id: "unique_question_id_1",
        text: "Какой тип диаграммы вам нужен? (столбчатая, линейная, круговая, точечная и т.д.)",
        hint: "Пример: column, line, pie, scatter"
      },
      {
        id: "unique_question_id_2",
        text: "Какие данные вы хотите отобразить? (массив чисел или объекты с категориями/значениями)",
        hint: "Например: [5, 12, 7] или [{\"name\": \"Январь\", \"y\": 10}, ...]"
      }
    ],
    already_known: { user_input: q, clarified: {} }
  })
};

const ERROR_BODY =
  'Ошибка при выполнении запроса: Error while processing HTTP-request. Status: InternalServerError. Content: {"stacktrace":"File \\"<string>\\", line 2, in <module>","statusCode":500,"description":"name \'context\' is not defined"}';

const parseCategoriesList = (query) => {
  const m = query.match(/категории\s*:\s*([^\n]+)/i);
  if (!m) return null;
  return m[1]
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const detectChartType = (query) => {
  if (/столбч|column/i.test(query)) return "column";
  if (/линей|line/i.test(query)) return "line";
  if (/круг|pie/i.test(query)) return "pie";
  if (/scatter|точеч/i.test(query)) return "scatter";
  return null;
};

const classifyPrompt = (query) => {
  const key = query.trim().toLowerCase();
  if (PROMPT_OVERRIDES[key]) {
    return { ok: PROMPT_OVERRIDES[key](query) };
  }
  const cats = parseCategoriesList(query);
  const chartType = detectChartType(query);
  if (cats && cats.length > 0) {
    const data = cats.map((_, i) => 10 + ((i * 17) % 90));
    return {
      ok: {
        status: "ready",
        question: query,
        answer: {
          chart: { type: chartType || "column" },
          title: { text: "Диаграмма (мок Дашбордер)" },
          colors: RAINBOW,
          xAxis: { categories: cats },
          series: [{ name: "данные", data }]
        }
      }
    };
  }
  if (/любых? категори|любых? данны/i.test(query)) {
    return {
      ok: {
        status: "ready",
        question: query,
        answer: {
          chart: { type: chartType || "column" },
          title: { text: "Столбчатая диаграмма с цветами радуги" },
          colors: RAINBOW,
          xAxis: { categories: [] },
          series: []
        }
      }
    };
  }
  if (chartType) {
    return {
      ok: {
        status: "need_more_info",
        questions: [
          {
            id: "q_categories",
            text: "Какие категории и значения вы хотите отобразить на диаграмме?",
            hint: "Например: [{\"name\": \"Категория1\", \"y\": 10}, ...]"
          }
        ],
        already_known: { user_input: query }
      }
    };
  }
  if (/диаграмм|график|chart/i.test(query)) {
    return {
      ok: {
        status: "need_more_info",
        questions: [
          {
            id: "q_type",
            text: "Какой тип диаграммы вам нужен? (столбчатая, линейная, круговая, точечная и т.д.)",
            hint: "Пример: column, line, pie, scatter"
          },
          {
            id: "q_data",
            text: "Какие данные вы хотите отобразить? (массив чисел или объекты с категориями/значениями)",
            hint: "Например: [5, 12, 7] или [{\"name\": \"Январь\", \"y\": 10}, ...]"
          }
        ],
        already_known: { user_input: query, clarified: {} }
      }
    };
  }
  return {
    ok: {
      status: "need_more_info",
      questions: [
        {
          id: "q_generic",
          text: "Опишите подробнее, что именно нужно построить.",
          hint: "Например: тип диаграммы, категории, значения, цвета"
        }
      ],
      already_known: { user_input: query }
    }
  };
};

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
  const norm = query.trim();
  if (norm === lastPromptCounter.query) {
    lastPromptCounter.count += 1;
  } else {
    lastPromptCounter = { query: norm, count: 1 };
  }
  store.set(query_id, {
    query,
    calling_agent_name,
    extra,
    pollCount: 0,
    streak: lastPromptCounter.count
  });
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
  if (entry.streak >= 3) {
    return setTimeout(
      () =>
        sendJson(res, 200, {
          description: "OK",
          data: {
            query_id: queryId,
            is_final: true,
            query_status: "ERROR",
            start_time: new Date(Date.now() - 500).toISOString(),
            finish_time: new Date().toISOString(),
            response_code: 500,
            response_body: ERROR_BODY,
            response: null
          }
        }),
      delayMs
    );
  }
  const agentAnswer = classifyPrompt(entry.query).ok;
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
          response_body: JSON.stringify(agentAnswer),
          response: null
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
