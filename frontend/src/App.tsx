import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import {
  getAgent,
  runAgentQuery,
  type AgentAnswer,
  type AgentInfo,
  type TraceItem
} from "./kitai";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";
const DEFAULT_AGENT_ID =
  (import.meta.env.VITE_KITAI_AGENT_ID as string | undefined) ?? "dashboarder";
const DEFAULT_TOKEN = (import.meta.env.VITE_KITAI_TOKEN as string | undefined) ?? "";
const WARN_MS = 600;

type ChatMessage =
  | { id: string; role: "user"; text: string; sentAt: Date }
  | {
      id: string;
      role: "assistant";
      sentAt: Date;
      answer: AgentAnswer;
      trace: TraceItem[];
    };

const DEMO_SCENARIO = [
  "создай столбчатую диаграмму графиков с цветами радуги, с любыми данными, категории: Банк, департамент, трайб, Ас",
  "создай столбчатую диаграмму графиков с цветами радуги, с любыми данными, категории: Банк, департамент, трайб",
  "создай столбчатую диаграмму графиков с цветами радуги",
  "создай столбчатую диаграмму графиков с цветами радуги с любыми категориями",
  "сделай диаграмму"
];

const fmtTs = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState(DEFAULT_AGENT_ID);
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [lastRequest, setLastRequest] = useState<unknown | null>(null);
  const [lastResponse, setLastResponse] = useState<unknown | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [showResponse, setShowResponse] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const scenarioRunning = useRef(false);

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

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

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
    async (customPrompt?: string) => {
      const currentPrompt = (customPrompt ?? prompt).trim();
      if (!currentPrompt) return;
      setIsSending(true);
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "user", text: currentPrompt, sentAt: new Date() }
      ]);
      if (customPrompt === undefined) setPrompt("");
      try {
        const result = await runAgentQuery({
          baseUrl: API_URL,
          agentId,
          prompt: currentPrompt,
          token: token || undefined
        });
        setLastRequest(result.requestPayload);
        setLastResponse(result.finalResult);
        setTrace(result.trace);
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            sentAt: new Date(),
            answer: result.answer,
            trace: result.trace
          }
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            sentAt: new Date(),
            answer: {
              kind: "error",
              message: String(err),
              raw: null
            },
            trace: []
          }
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [prompt, agentId, token]
  );

  const runScenario = useCallback(async () => {
    if (scenarioRunning.current || isSending) return;
    scenarioRunning.current = true;
    try {
      for (const p of DEMO_SCENARIO) {
        if (!scenarioRunning.current) break;
        await send(p);
        await new Promise((r) => setTimeout(r, 800));
      }
    } finally {
      scenarioRunning.current = false;
    }
  }, [send, isSending]);

  const handleQuestionAnswer = (q: { text: string }) => {
    setPrompt((p) => (p ? p + "\n" : "") + `${q.text} `);
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const displayTrace =
    trace.length > 0
      ? trace
      : defaultPipeline.map((stage) => ({ stage, status: "ok" } as TraceItem));
  const overall = worstStatus(displayTrace);
  const statusLabel = (s: "ok" | "warn" | "fail") =>
    s === "ok" ? "OK" : s === "warn" ? "WARN" : "FAIL";

  return (
    <div className="page">
      <header>
        <h1>Агент «Дашбордер» (KitAI)</h1>
        <p className="muted">
          Демо-чат с KitAI Public Integration API. UI шлёт register → poll → commit и
          рендерит ответ: график, уточняющие вопросы или ошибку.
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
        <div className="log-header">
          <strong>Чат</strong>
          <span className="muted">{messages.length} сообщ.</span>
        </div>
        <div className="chat-list" ref={chatRef}>
          {messages.length === 0 && (
            <div className="muted">Напишите запрос или прогоните сценарий.</div>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="chat-msg role-user">
                <div className="chat-avatar" data-role="user">U</div>
                <div className="chat-bubble">
                  <div className="chat-ts">{fmtTs(m.sentAt)} • вы</div>
                  <div className="chat-text">{m.text}</div>
                </div>
              </div>
            ) : (
              <div key={m.id} className="chat-msg role-assistant">
                <div className="chat-avatar" data-role="assistant">D</div>
                <div className="chat-bubble">
                  <div className="chat-ts">
                    {fmtTs(m.sentAt)} • Dashboarder
                    {m.trace.length > 0 && (
                      <>
                        {" • "}
                        {m.trace
                          .filter((t) => t.durMs != null)
                          .map((t) => `${t.stage} ${t.durMs}ms`)
                          .join(" / ")}
                      </>
                    )}
                  </div>
                  <AssistantContent answer={m.answer} onAnswerQuestion={handleQuestionAnswer} />
                </div>
              </div>
            )
          )}
        </div>

        <label className="label" style={{ marginTop: "0.75rem" }}>
          Текст запроса
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Введите промпт (Enter — отправить, Shift+Enter — перенос)"
            rows={3}
          />
        </label>

        <div className="suggestions">
          {DEMO_SCENARIO.map((s, idx) => (
            <button
              key={idx}
              type="button"
              className="suggestion-btn"
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) void send(s);
                else setPrompt(s);
              }}
              title={`Ctrl/Cmd+click — сразу отправить.\n${s}`}
            >
              {idx + 1}. {s.length > 50 ? s.slice(0, 47) + "…" : s}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button onClick={() => send()} disabled={isSending}>
            {isSending ? "Отправка..." : "Отправить"}
          </button>
          <button onClick={runScenario} disabled={isSending} type="button">
            ▶ Прогнать сценарий
          </button>
        </div>
      </section>

      <section className="card">
        <div className="log-header">
          <strong>Debug: последний обмен</strong>
          <span className="muted">register payload + финальный QueryResultPDto</span>
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
    </div>
  );
}

function AssistantContent({
  answer,
  onAnswerQuestion
}: {
  answer: AgentAnswer;
  onAnswerQuestion: (q: { text: string }) => void;
}) {
  if (answer.kind === "chart") {
    return (
      <>
        <div className="chat-text">График готов.</div>
        <div style={{ marginTop: "0.5rem" }}>
          <HighchartsReact highcharts={Highcharts} options={answer.chartOptions} />
        </div>
        <details style={{ marginTop: "0.5rem" }}>
          <summary className="muted" style={{ cursor: "pointer" }}>
            raw answer
          </summary>
          <pre className="json-content">{JSON.stringify(answer.raw, null, 2)}</pre>
        </details>
      </>
    );
  }
  if (answer.kind === "questions") {
    return (
      <>
        <div className="chat-text">Нужно уточнение:</div>
        <ul className="chat-questions">
          {answer.questions.map((q) => (
            <li key={q.id}>
              <div>{q.text}</div>
              {q.hint && <div className="chat-hint">подсказка: {q.hint}</div>}
              <button
                className="toggle-btn"
                type="button"
                onClick={() => onAnswerQuestion(q)}
                style={{ marginTop: "0.25rem" }}
              >
                Ответить
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  }
  return (
    <div className="chat-error">
      {answer.statusCode ? `HTTP ${answer.statusCode}: ` : ""}
      {answer.message}
    </div>
  );
}
