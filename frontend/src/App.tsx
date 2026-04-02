import { useCallback, useMemo, useState } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
type TraceItem = { stage: string; durMs?: number; status?: string };

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const WARN_MS = 300;

export default function App() {
  const [prompt, setPrompt] = useState("Привет, кто ты?");
  const [model, setModel] = useState("gigachat/GigaChat-Pro");
  const [isSending, setIsSending] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [chartOptions, setChartOptions] = useState<any | null>(null);
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<any | null>(null);
  const [lastResponse, setLastResponse] = useState<any | null>(null);
  const [showRequest, setShowRequest] = useState(true);
  const [showResponse, setShowResponse] = useState(true);
  const [pendingExtra, setPendingExtra] = useState<Record<string, unknown> | null>(
    null
  );

  const defaultPipeline = useMemo(
    () => ["UI", "OpenClaw Gateway", "gpt2giga", "GigaChat"],
    []
  );

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
      const payload = {
        messages: [{ role: "user", content: currentPrompt } satisfies ChatMessage],
        model,
        ...mergedExtra
      };
      setIsSending(true);
      setTrace([]);
      setRequestId(null);
      setLastRequest(payload);
      setLog((prev) => [`→ ${currentPrompt}`, ...prev]);
      try {
        const res = await fetch(`${API_URL}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        setLastResponse(json);
        setChartOptions(json.chartOptions ?? null);
        const nextTrace = Array.isArray(json.trace) ? json.trace : [];
        const nextRequestId = json.requestId ? String(json.requestId) : null;
        setTrace(nextTrace);
        setRequestId(nextRequestId);
        const answer =
          json?.choices?.[0]?.message?.content ??
          json?.message ??
          JSON.stringify(json);
        setLog((prev) => [
          `← ${nextRequestId ? `[#${nextRequestId}] ` : ""}${answer}`,
          ...prev
        ]);
      } catch (err) {
        setLog((prev) => [`⚠️ ${String(err)}`, ...prev]);
      } finally {
        setIsSending(false);
        setPendingExtra(null);
      }
    },
    [prompt, model, pendingExtra]
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
      : defaultPipeline.map(
          (stage) => ({ stage, status: "ok" } as TraceItem)
        );

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
        <h1>OpenClaw ↔ gpt2giga ↔ GigaChat</h1>
        <p className="muted">
          Ассистент на OpenClaw, который ходит в GigaChat через gpt2giga и
          возвращает текст + Highcharts options.
        </p>
      </header>

      <section className="card">
        <div className="log-header">
          <strong>Flow</strong>
          <span className="muted">live trace с таймингами</span>
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
                {idx < displayTrace.length - 1 && (
                  <div className="arrow">➜</div>
                )}
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
              onClick={(e) =>
                handleSuggestion(s.text, s.extra, e.ctrlKey || e.metaKey)
              }
              title="Ctrl/Cmd + click — сразу отправить"
            >
              {s.label}
            </button>
          ))}
        </div>

        <label className="label">
          Модель
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="gigachat/GigaChat">GigaChat Lite</option>
            <option value="gigachat/GigaChat-Pro">GigaChat Pro</option>
            <option value="gigachat/GigaChat-Max">GigaChat MAX</option>
          </select>
        </label>

        <button onClick={() => send()} disabled={isSending}>
          {isSending ? "Отправка..." : "Отправить"}
        </button>
      </section>

      <section className="card">
        <div className="log-header">
          <strong>График (mock/реальный)</strong>
          <span className="muted">
            Отображает Highcharts options, если backend их вернул.
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
          <span className="muted">JSON в OpenAI-совместимом формате</span>
        </div>
        <div className="json-panels">
          <div className="json-panel">
            <div className="json-header">
              <span>Request</span>
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
                {lastRequest
                  ? JSON.stringify(lastRequest, null, 2)
                  : "— ещё не отправляли"}
              </pre>
            )}
          </div>
          <div className="json-panel">
            <div className="json-header">
              <span>Response</span>
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
                {lastResponse
                  ? JSON.stringify(lastResponse, null, 2)
                  : "— ответа пока нет"}
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
