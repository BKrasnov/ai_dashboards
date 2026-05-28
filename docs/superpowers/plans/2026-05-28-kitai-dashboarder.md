# KitAI «Дашбордер» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переписать фронт и mock-gateway так, чтобы UI ходил в (мок) KitAI Public Integration API к агенту «Dashboarder» по паттерну register → poll → commit.

**Architecture:** Frontend (React + Vite) шлёт три HTTP-запроса в локальный мок (Node http) на порту 3002, эмулирующий подмножество KitAI (`/api/v1/agent`, `/api/v1/query/agent`, `/api/v1/query/{id}/result`, `/api/v1/query/{id}/commit`). Клиент KitAI вынесен в отдельный модуль `frontend/src/kitai.ts`. UI отображает trace из 4 шагов, текстовый ответ агента и опциональный Highcharts.

**Tech Stack:** Node 22 (http core), React 18, TypeScript, Vite, Highcharts. Без тест-фреймворка — верификация через ручные `curl` и проверку в браузере, т.к. в проекте нет существующего test harness и это PoC.

**Спека:** [docs/superpowers/specs/2026-05-28-kitai-dashboarder-design.md](../specs/2026-05-28-kitai-dashboarder-design.md)

---

## File Structure

- **Modify:** `scripts/dev/mock-gateway.js` — полная замена. Эмулирует подмножество KitAI Public Integration API, держит in-memory store query'ев, добавляет `chartOptions` в ответ если запрошено.
- **Create:** `frontend/src/kitai.ts` — клиент KitAI: `getAgent()`, `runAgentQuery()` (объединяет register + poll + commit, возвращает текст + chartOptions + trace).
- **Modify:** `frontend/src/App.tsx` — заголовки/pipeline под KitAI, поля `agentId` и `token`, переход на `runAgentQuery`, парсинг `chartOptions` из `response_body` или extension-поля.
- **Modify:** `README.md` — обновить раздел про мок (новый порт 3002, новые endpoints, новый смысл).

---

## Task 1: Mock-gateway → KitAI endpoints

**Files:**
- Modify (полная замена): `scripts/dev/mock-gateway.js`

- [ ] **Step 1: Заменить содержимое `scripts/dev/mock-gateway.js`**

```javascript
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
    // log presence only, not value
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
```

- [ ] **Step 2: Остановить старый мок (если запущен) и поднять новый на 3002**

В PowerShell (порт 3001 у пользователя занят сторонним приложением, поэтому 3002):
```powershell
$env:MOCK_PORT="3002"; node scripts/dev/mock-gateway.js
```
Ожидаем в логе: `Mock KitAI listening on http://localhost:3002`.

- [ ] **Step 3: Smoke-test health**

```bash
curl -s http://localhost:3002/health
```
Ожидаем: `{"ok":true,"mock":"kitai"}`.

- [ ] **Step 4: Smoke-test catalog**

```bash
curl -s http://localhost:3002/api/v1/agent
curl -s http://localhost:3002/api/v1/agent/dashboarder
```
Ожидаем: оба ответа `200`, в `data` — объект/массив с `name: "Dashboarder"`.

- [ ] **Step 5: Smoke-test полного цикла register → poll → commit**

```bash
QID=$(node -e "console.log(crypto.randomUUID())")
curl -s -X POST http://localhost:3002/api/v1/query/agent \
  -H "Content-Type: application/json" \
  -d "{\"query_id\":\"$QID\",\"calling_agent_name\":\"dashboarder\",\"query\":\"Привет\"}"
# Polls: первые 2 — is_final:false, третий — is_final:true с response.choices[0].message.content
curl -s http://localhost:3002/api/v1/query/$QID/result
curl -s http://localhost:3002/api/v1/query/$QID/result
curl -s http://localhost:3002/api/v1/query/$QID/result
curl -s -X PUT http://localhost:3002/api/v1/query/$QID/commit
```
Ожидаем: 1-2 ответа RUNNING, 3-й DONE с текстом «Моковый ответ агента…», commit возвращает `{data:true}`.

- [ ] **Step 6: Smoke-test wantChart**

```bash
QID=$(node -e "console.log(crypto.randomUUID())")
curl -s -X POST http://localhost:3002/api/v1/query/agent \
  -H "Content-Type: application/json" \
  -d "{\"query_id\":\"$QID\",\"calling_agent_name\":\"dashboarder\",\"query\":\"график продаж\",\"wantChart\":true,\"chartType\":\"line\",\"data\":[[\"Янв\",1],[\"Фев\",2]]}"
curl -s http://localhost:3002/api/v1/query/$QID/result  # x3
curl -s http://localhost:3002/api/v1/query/$QID/result
curl -s http://localhost:3002/api/v1/query/$QID/result
```
Ожидаем: в финальном ответе `data.response.chartOptions` с `series[0].data` = переданным массивом.

- [ ] **Step 7: Commit**

```bash
git add scripts/dev/mock-gateway.js
git commit -m "feat(mock): replace OpenClaw mock with KitAI Public Integration subset"
```

---

## Task 2: KitAI client в `frontend/src/kitai.ts`

**Files:**
- Create: `frontend/src/kitai.ts`

- [ ] **Step 1: Создать `frontend/src/kitai.ts`**

```typescript
export type TraceItem = { stage: string; durMs?: number; status?: "ok" | "warn" | "fail" };

export type AgentInfo = {
  id: number;
  name: string;
  description?: string;
};

export type KitaiRunResult = {
  text: string;
  chartOptions: unknown | null;
  trace: TraceItem[];
  requestPayload: unknown;
  finalResult: unknown;
};

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 20_000;

const authHeaders = (token: string | undefined): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

export async function getAgent(
  baseUrl: string,
  agentId: string,
  token?: string
): Promise<AgentInfo | null> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/agent/${encodeURIComponent(agentId)}`, {
      headers: { ...authHeaders(token) }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.data;
    if (!data || typeof data !== "object") return null;
    return { id: data.id, name: data.name, description: data.description };
  } catch {
    return null;
  }
}

function extractChartOptions(finalData: any): unknown | null {
  const direct = finalData?.response?.chartOptions;
  if (direct) return direct;
  const body = finalData?.response_body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.chartOptions) return parsed.chartOptions;
    } catch {
      // ignore
    }
  }
  return null;
}

function extractText(finalData: any): string {
  const msg = finalData?.response?.choices?.[0]?.message?.content;
  if (typeof msg === "string") return msg;
  if (typeof finalData?.response_body === "string") return finalData.response_body;
  return "";
}

export async function runAgentQuery(opts: {
  baseUrl: string;
  agentId: string;
  prompt: string;
  token?: string;
  extra?: Record<string, unknown>;
}): Promise<KitaiRunResult> {
  const { baseUrl, agentId, prompt, token, extra = {} } = opts;
  const trace: TraceItem[] = [];
  const queryId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const requestPayload = {
    query_id: queryId,
    calling_agent_name: agentId,
    query: prompt,
    ...extra
  };

  // 1. register
  const t0 = performance.now();
  let registerRes: Response;
  try {
    registerRes = await fetch(`${baseUrl}/api/v1/query/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(requestPayload)
    });
  } catch (err) {
    trace.push({ stage: "UI→KitAI Gateway", status: "fail" });
    throw new Error(`register failed: ${String(err)}`);
  }
  const t1 = performance.now();
  trace.push({
    stage: "UI→KitAI Gateway",
    durMs: Math.round(t1 - t0),
    status: registerRes.ok ? "ok" : "fail"
  });
  if (!registerRes.ok) {
    throw new Error(`register ${registerRes.status}`);
  }

  // 2. poll
  const pollStart = performance.now();
  let finalData: any = null;
  while (performance.now() - pollStart < POLL_TIMEOUT_MS) {
    const r = await fetch(
      `${baseUrl}/api/v1/query/${encodeURIComponent(queryId)}/result`,
      { headers: { ...authHeaders(token) } }
    );
    if (!r.ok) {
      trace.push({ stage: "Agent (Dashboarder)", status: "fail" });
      throw new Error(`poll ${r.status}`);
    }
    const json = await r.json();
    if (json?.data?.is_final) {
      finalData = json.data;
      break;
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
  const pollEnd = performance.now();
  if (!finalData) {
    trace.push({
      stage: "Agent (Dashboarder)",
      durMs: Math.round(pollEnd - pollStart),
      status: "fail"
    });
    throw new Error("poll timeout");
  }
  trace.push({
    stage: "Agent (Dashboarder)",
    durMs: Math.round(pollEnd - pollStart),
    status: "ok"
  });

  // 3. commit
  const c0 = performance.now();
  let commitOk = false;
  try {
    const cr = await fetch(
      `${baseUrl}/api/v1/query/${encodeURIComponent(queryId)}/commit`,
      { method: "PUT", headers: { ...authHeaders(token) } }
    );
    commitOk = cr.ok;
  } catch {
    commitOk = false;
  }
  const c1 = performance.now();
  trace.push({
    stage: "GigaChat→UI",
    durMs: Math.round(c1 - c0),
    status: commitOk ? "ok" : "warn"
  });

  return {
    text: extractText(finalData),
    chartOptions: extractChartOptions(finalData),
    trace,
    requestPayload,
    finalResult: finalData
  };
}
```

- [ ] **Step 2: Проверить, что TS-компиляция проходит**

В PowerShell:
```powershell
cd frontend; npx tsc --noEmit
```
Ожидаем: 0 ошибок.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kitai.ts
git commit -m "feat(frontend): add KitAI client (register/poll/commit)"
```

---

## Task 3: Переписать `App.tsx` под KitAI и нового агента

**Files:**
- Modify (полная замена): `frontend/src/App.tsx`

- [ ] **Step 1: Заменить содержимое `frontend/src/App.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { getAgent, runAgentQuery, type AgentInfo, type TraceItem } from "./kitai";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";
const DEFAULT_AGENT_ID =
  (import.meta.env.VITE_KITAI_AGENT_ID as string | undefined) ?? "dashboarder";
const DEFAULT_TOKEN = (import.meta.env.VITE_KITAI_TOKEN as string | undefined) ?? "";
const WARN_MS = 600;

export default function App() {
  const [prompt, setPrompt] = useState("Покажи график продаж по месяцам.");
  const [agentId, setAgentId] = useState(DEFAULT_AGENT_ID);
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [chartOptions, setChartOptions] = useState<any | null>(null);
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [lastRequest, setLastRequest] = useState<unknown | null>(null);
  const [lastResponse, setLastResponse] = useState<unknown | null>(null);
  const [showRequest, setShowRequest] = useState(true);
  const [showResponse, setShowResponse] = useState(true);
  const [pendingExtra, setPendingExtra] = useState<Record<string, unknown> | null>(null);

  const defaultPipeline = useMemo(
    () => ["UI", "KitAI Gateway", "Agent (Dashboarder)", "GigaChat"],
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = await getAgent(API_URL, agentId, token || undefined);
      if (!cancelled) setAgentInfo(info);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, token]);

  const calcStatus = (item: TraceItem): "ok" | "warn" | "fail" => {
    if (item.status === "fail") return "fail";
    if (item.status === "warn") return "warn";
    if (item.status === "ok") return "ok";
    if (item.durMs == null) return "fail";
    if (item.durMs > WARN_MS) return "warn";
    return "ok";
  };

  const worstStatus = (items: TraceItem[]): "ok" | "warn" | "fail" => {
    if (items.some((i) => calcStatus(i) === "fail")) return "fail";
    if (items.some((i) => calcStatus(i) === "warn")) return "warn";
    return "ok";
  };

  const send = useCallback(
    async (customPrompt?: string, extraPayload?: Record<string, unknown>) => {
      const currentPrompt = (customPrompt ?? prompt).trim();
      if (!currentPrompt) return;
      const mergedExtra = extraPayload ?? pendingExtra ?? {};
      setIsSending(true);
      setTrace([]);
      setLog((prev) => [`→ ${currentPrompt}`, ...prev]);
      try {
        const result = await runAgentQuery({
          baseUrl: API_URL,
          agentId,
          prompt: currentPrompt,
          token: token || undefined,
          extra: mergedExtra
        });
        setLastRequest(result.requestPayload);
        setLastResponse(result.finalResult);
        setTrace(result.trace);
        setChartOptions(result.chartOptions ?? null);
        setLog((prev) => [`← ${result.text || "(пустой ответ)"}`, ...prev]);
      } catch (err) {
        setLog((prev) => [`⚠️ ${String(err)}`, ...prev]);
      } finally {
        setIsSending(false);
        setPendingExtra(null);
      }
    },
    [prompt, agentId, token, pendingExtra]
  );

  const suggestions = [
    {
      label: "Линейный график продаж",
      text: "Построй линейный график продаж по месяцам: Янв 120, Фев 150, Мар 90, Апр 210.",
      extra: {
        wantChart: true,
        chartType: "line",
        data: [
          ["Янв", 120],
          ["Фев", 150],
          ["Мар", 90],
          ["Апр", 210]
        ]
      }
    },
    {
      label: "По категориям",
      text: "Сделай pie chart долей: Электроника 40, Одежда 35, Детское 25.",
      extra: {
        wantChart: true,
        chartType: "pie",
        data: [
          ["Электроника", 40],
          ["Одежда", 35],
          ["Детское", 25]
        ]
      }
    },
    {
      label: "Scatter точки",
      text: "Покажи scatter связь возраст/чек: (22,700); (30,900); (45,1200).",
      extra: {
        wantChart: true,
        chartType: "scatter",
        data: [
          [22, 700],
          [30, 900],
          [45, 1200]
        ],
        xTitle: "Возраст",
        yTitle: "Средний чек"
      }
    }
  ];

  const displayTrace =
    trace.length > 0
      ? trace
      : defaultPipeline.map((stage) => ({ stage, status: "ok" } as TraceItem));
  const overall = worstStatus(displayTrace);
  const statusLabel = (s: "ok" | "warn" | "fail") =>
    s === "ok" ? "OK" : s === "warn" ? "WARN" : "FAIL";

  const handleSuggestion = (
    text: string,
    extra: Record<string, unknown> | undefined,
    autoSend: boolean
  ) => {
    setPrompt(text);
    setPendingExtra(extra ?? null);
    if (autoSend) {
      void send(text, extra);
    }
  };

  return (
    <div className="page">
      <header>
        <h1>Агент «Дашбордер» (KitAI)</h1>
        <p className="muted">
          UI вызывает KitAI Public Integration API по паттерну register → poll → commit
          и рендерит ответ агента + Highcharts.
        </p>
      </header>

      <section className="card">
        <div className="log-header">
          <strong>Агент</strong>
          <span className="muted">
            {agentInfo
              ? `id=${agentInfo.id} • ${agentInfo.name} — ${agentInfo.description ?? ""}`
              : "не загружено / нет связи"}
          </span>
        </div>
        <label className="label">
          Agent ID
          <input
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="dashboarder"
          />
        </label>
        <label className="label">
          Auth token (Bearer)
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="mock-token"
          />
        </label>
      </section>

      <section className="card">
        <div className="log-header">
          <strong>Flow</strong>
          <span className="muted">register → poll → commit</span>
        </div>
        <div className="status-badge" data-status={overall}>
          {statusLabel(overall)}
        </div>
        <div className="pipeline">
          {displayTrace.map((item, idx) => {
            const st = calcStatus(item);
            return (
              <div key={`${item.stage}-${idx}`} className="step">
                <div className={`pill status-${st}`}>
                  <span className="status-dot" data-status={st} />
                  {item.stage}
                  {item.durMs != null && (
                    <span className="pill-time">{item.durMs} ms</span>
                  )}
                </div>
                {idx < displayTrace.length - 1 && <div className="arrow">➜</div>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <label className="label">
          Текст запроса
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Введите промпт"
            rows={4}
          />
        </label>

        <div className="suggestions">
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              className="suggestion-btn"
              onClick={(e) => handleSuggestion(s.text, s.extra, e.ctrlKey || e.metaKey)}
              title="Ctrl/Cmd + click — сразу отправить"
            >
              {s.label}
            </button>
          ))}
        </div>

        <button onClick={() => send()} disabled={isSending}>
          {isSending ? "Отправка..." : "Отправить"}
        </button>
      </section>

      <section className="card">
        <div className="log-header">
          <strong>График</strong>
          <span className="muted">
            chartOptions из response.chartOptions или JSON.parse(response_body)
          </span>
        </div>
        {chartOptions ? (
          <HighchartsReact highcharts={Highcharts} options={chartOptions} />
        ) : (
          <div className="muted">Пока нет данных для графика.</div>
        )}
      </section>

      <section className="card">
        <div className="log-header">
          <strong>Request / Response</strong>
          <span className="muted">payload register и финальный QueryResultPDto</span>
        </div>
        <div className="json-panels">
          <div className="json-panel">
            <div className="json-header">
              <span>Register payload</span>
              <button
                className="toggle-btn"
                type="button"
                onClick={() => setShowRequest((v) => !v)}
              >
                {showRequest ? "Скрыть" : "Показать"}
              </button>
            </div>
            {showRequest && (
              <pre className="json-content">
                {lastRequest ? JSON.stringify(lastRequest, null, 2) : "— ещё не отправляли"}
              </pre>
            )}
          </div>
          <div className="json-panel">
            <div className="json-header">
              <span>Final result</span>
              <button
                className="toggle-btn"
                type="button"
                onClick={() => setShowResponse((v) => !v)}
              >
                {showResponse ? "Скрыть" : "Показать"}
              </button>
            </div>
            {showResponse && (
              <pre className="json-content">
                {lastResponse ? JSON.stringify(lastResponse, null, 2) : "— ответа пока нет"}
              </pre>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="log-header">
          <strong>Лог</strong>
          <span className="muted">новые сверху</span>
        </div>
        <div className="log">
          {log.length === 0 && (
            <div className="muted">Пока пусто — отправьте первый запрос.</div>
          )}
          {log.map((line, i) => (
            <div key={i} className="log-line">
              {line}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Проверить TS-компиляцию**

```powershell
cd frontend; npx tsc --noEmit
```
Ожидаем: 0 ошибок.

- [ ] **Step 3: Поднять Vite (если не поднят) и открыть в браузере**

В отдельной сессии:
```powershell
cd frontend; $env:VITE_API_URL="http://localhost:3002"; $env:VITE_KITAI_AGENT_ID="dashboarder"; npm run dev
```
Открыть http://localhost:5173/.

- [ ] **Step 4: Ручная проверка UI**

В браузере:
1. Шапка карточки «Агент» должна показать `id=1 • Dashboarder — Мок-агент для дашбордов` (мок отдал из `GET /api/v1/agent/dashboarder`).
2. Pipeline — 4 шага со статусом OK по умолчанию.
3. Нажать «Отправить» с дефолтным промптом — в логе должна появиться строка `← Моковый ответ агента «dashboarder»: вы спросили «…».`, в trace — три pill с временами (UI→KitAI Gateway, Agent (Dashboarder), GigaChat→UI).
4. Нажать с Ctrl кнопку «Линейный график продаж» — должен отрисоваться график Highcharts с данными Янв/Фев/Мар/Апр.
5. В Network DevTools убедиться, что прошли 3 запроса: `POST /api/v1/query/agent`, несколько `GET /api/v1/query/<uuid>/result`, `PUT /api/v1/query/<uuid>/commit`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): switch UI to KitAI Dashboarder agent flow"
```

---

## Task 4: Обновить README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Заменить разделы про OpenClaw/GigaChat на KitAI Dashboarder**

Открыть `README.md`. Заменить заголовок и блок «Архитектура (идея)» на:

```markdown
# KitAI «Дашбордер» (mock PoC)

Минимальный стенд: React UI ходит в **мок KitAI Public Integration API** к агенту «Dashboarder» по паттерну register → poll → commit. Реальный KitAI пока не подключен — на бэке Node-мок.

## Архитектура
```
React UI ──► (mock) KitAI API ──► Agent «Dashboarder» ──► GigaChat
              POST  /api/v1/query/agent
              GET   /api/v1/query/{id}/result   (poll)
              PUT   /api/v1/query/{id}/commit
```
```

Заменить раздел «Быстрый старт» (целиком) на:

```markdown
## Быстрый старт (мок)

В одной сессии:
```powershell
$env:MOCK_PORT="3002"; node scripts/dev/mock-gateway.js
```

В другой:
```powershell
cd frontend
$env:VITE_API_URL="http://localhost:3002"
$env:VITE_KITAI_AGENT_ID="dashboarder"
npm install
npm run dev
```
Открыть http://localhost:5173/. UI на загрузке дёрнет `GET /api/v1/agent/dashboarder`, на «Отправить» — выполнит цикл register → poll → commit и покажет ответ + (опционально) Highcharts.

### Swagger
Сваггер KitAI лежит в `swagger.json` (title `KitAI.Public.IntegrationalApi`). Мок эмулирует подмножество: `/api/v1/agent`, `/api/v1/agent/{id}`, `/api/v1/query/agent`, `/api/v1/query/{id}/result`, `/api/v1/query/{id}/commit`, `/api/v1/query/{id}/cancel`.

### Переход на реальный KitAI
Поменять `VITE_API_URL` на адрес стенда KitAI и положить токен в `VITE_KITAI_TOKEN` — больше менять в UI ничего не нужно. Если в реальном API целевой агент задаётся не через `calling_agent_name`, поправить `frontend/src/kitai.ts:runAgentQuery` — место одно.
```

Остальные разделы (OpenClaw, gpt2giga, Docker) можно оставить как «архивные» или удалить. **YAGNI: оставляем как есть, не трогаем.**

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for KitAI Dashboarder mock"
```

---

## Self-Review

**Spec coverage:**
- Frontend изменения (заголовок, pipeline, agentId/token, убран выбор модели, цикл register/poll/commit, парсинг chartOptions, suggestions) — Task 2 + Task 3.
- Backend mock endpoints (agent list/detail, query register/result/commit/cancel, chartOptions extension, CORS с Authorization, ignore auth) — Task 1.
- Конфиг (порт 3002, VITE_* envs) — описан в Task 1 step 2, Task 3 step 3, README Task 4.
- Не делаем context/SSE/удаление infra — план их не упоминает (как и должно быть).
- Допущения (calling_agent_name=agent, Bearer auth, chartOptions через extension + parse response_body) — реализованы и в моке, и в `extractChartOptions`.

**Placeholder scan:** проверено — нет TBD/TODO, все шаги содержат точный код или точные команды.

**Type consistency:** `TraceItem`, `AgentInfo`, `KitaiRunResult` экспортируются из `kitai.ts` и используются в `App.tsx` под теми же именами. Поля `trace`, `chartOptions`, `requestPayload`, `finalResult`, `text` совпадают между декларацией в `kitai.ts` и потреблением в `App.tsx`.
