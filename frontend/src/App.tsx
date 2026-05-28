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
