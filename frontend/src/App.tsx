import { useCallback, useMemo, useState } from "react";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export default function App() {
  const [prompt, setPrompt] = useState("Привет, кто ты?");
  const [model, setModel] = useState("gigachat/GigaChat-Pro");
  const [isSending, setIsSending] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const pipeline = useMemo(
    () => ["UI", "Gateway", "gpt2giga", "GigaChat"],
    []
  );

  const send = useCallback(async () => {
    if (!prompt.trim()) return;
    setIsSending(true);
    setLog((prev) => [`→ ${prompt}`, ...prev]);
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt } satisfies ChatMessage],
          model
        })
      });
      const json = await res.json();
      const answer =
        json?.choices?.[0]?.message?.content ??
        json?.message ??
        JSON.stringify(json);
      setLog((prev) => [`← ${answer}`, ...prev]);
    } catch (err) {
      setLog((prev) => [`⚠️ ${String(err)}`, ...prev]);
    } finally {
      setIsSending(false);
    }
  }, [prompt, model]);

  return (
    <div className="page">
      <header>
        <h1>OpenClaw ↔ gpt2giga ↔ GigaChat</h1>
        <p className="muted">
          Минимальный UI. Отправляет сообщения в Gateway, который идёт в GigaChat
          через прокси gpt2giga.
        </p>
      </header>

      <section className="card">
        <div className="pipeline">
          {pipeline.map((step, idx) => (
            <div key={step} className="step">
              <div className="pill">{step}</div>
              {idx < pipeline.length - 1 && <div className="arrow">➜</div>}
            </div>
          ))}
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

        <label className="label">
          Модель
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="gigachat/GigaChat">GigaChat Lite</option>
            <option value="gigachat/GigaChat-Pro">GigaChat Pro</option>
            <option value="gigachat/GigaChat-Max">GigaChat MAX</option>
          </select>
        </label>

        <button onClick={send} disabled={isSending}>
          {isSending ? "Отправка..." : "Отправить"}
        </button>
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
