# KitAI «Дашбордер» — замена концепции GigaChat + OpenClaw

Дата: 2026-05-28
Статус: утверждено пользователем

## Контекст

Текущий стенд показывает цепочку `UI → OpenClaw Gateway → gpt2giga → GigaChat`. От концепции OpenClaw+gpt2giga отказываемся. Новый сценарий: фронт ходит в **KitAI Public Integration API** к зарегистрированному агенту «Дашбордер» по его `agentId`. Реальный KitAI пока не подключаем — на бэке остаётся мок, эмулирующий нужное подмножество KitAI.

Swagger в корне репо (`swagger.json`, title `KitAI.Public.IntegrationalApi`).

## Архитектура

```
React UI ──► (mock) KitAI API ──► [псевдо] Agent «Dashboarder» ──► [псевдо] GigaChat
              ▲
              │ POST  /api/v1/query/agent     (register, returns queryId)
              │ GET   /api/v1/query/{id}/result   (poll until is_final)
              │ PUT   /api/v1/query/{id}/commit   (ack)
```

Асинхронный паттерн: регистрация запроса → поллинг результата → commit.

## Frontend (`frontend/src/App.tsx`)

Изменения:

- Заголовок: «Агент «Дашбордер» (KitAI)»; подзаголовок описывает новую цепочку.
- Pipeline по умолчанию: `["UI", "KitAI Gateway", "Agent (Dashboarder)", "GigaChat"]`.
- Новые поля:
  - `agentId` (text input, default `dashboarder`, читается из `VITE_KITAI_AGENT_ID`). На mount → `GET /api/v1/agent/{agentId}`, имя/описание агента показываем в карточке.
  - `token` (password input, default из `VITE_KITAI_TOKEN`). Каждому запросу добавляем заголовок `Authorization: Bearer <token>` (если непусто).
- Убираем `<select>` модели GigaChat.
- Поток отправки промпта (`send()`):
  1. Сгенерировать `query_id = crypto.randomUUID()`.
  2. `POST {API_URL}/api/v1/query/agent` тело: `{ query_id, calling_agent_name: agentId, query: prompt }`. Trace step «UI→KitAI Gateway» (durMs = время этого запроса).
  3. Полл `GET /api/v1/query/{queryId}/result` каждые 500 мс, максимум 20 секунд. Пока `data.is_final !== true` — продолжаем. Trace step «Agent (Dashboarder)» с суммарным durMs от register до final.
  4. `PUT /api/v1/query/{queryId}/commit`. Trace step «GigaChat→UI» (тут это просто ack, но визуально замыкает цепочку).
  5. Из `data.response.choices[0].message.content` достаём текст; из `data.response.chartOptions` (extension-поле мока) — Highcharts options. Если поле отсутствует — график не рисуем.
- Кнопки-подсказки (line/pie/scatter) остаются. Текст промпта и `extra` payload передаются как раньше; `extra` уходит дополнительными полями в тело `POST /query/agent` (это allow-листим в моке).
- Request/Response панели: показывают последний request (register payload) и последний result-ответ. Не пытаемся отрисовать все три HTTP-шага в JSON — слишком шумно.
- При HTTP-ошибке или таймауте поллинга помечаем соответствующий trace-шаг `status: "fail"` и пишем сообщение в лог.

## Backend mock (`scripts/dev/mock-gateway.js`)

Переписываем под подмножество KitAI. Имя файла оставляем (`mock-gateway.js`) — скрипт в package.json не меняется.

In-memory store: `Map<queryId, { query, calling_agent_name, extra, registeredAt, pollCount }>`.

Endpoints:

- `GET /api/v1/agent` → `{ data: [{ id: 1, name: "Dashboarder", description: "Мок-агент для дашбордов" }] }`.
- `GET /api/v1/agent/{id}` → `{ data: { id: 1, name: "Dashboarder", description: "Мок-агент для дашбордов", license_id: 0, model_id: 0, prompt_templates: ["Ты строишь дашборды."] } }`. `id` в пути игнорируется (любой принимается).
- `POST /api/v1/query/agent` → принимает `{ query_id, calling_agent_name, query, …extra }`. Сохраняет, возвращает `{ data: { queryId: query_id, success: true } }`.
- `GET /api/v1/query/{id}/result` → инкрементит `pollCount`. Первые 2 вызова — `{ data: { query_id, is_final: false, query_status: "RUNNING" } }`. С 3-го вызова — `is_final: true, query_status: "DONE"`, плюс:
  - `response: { id: "kitai-mock", model: "gigachat/mock", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }` — `content` = «Моковый ответ агента «Dashboarder»: вы спросили «…»».
  - Если в исходном payload было `wantChart === true` или в query встречается «график/chart/диаграм» — добавляем в `response` extension-поле `chartOptions` (структуру строим по `chartType` так же, как сейчас).
- `PUT /api/v1/query/{id}/commit` → `{ data: true }`. Удаляет запись из store.
- `DELETE /api/v1/query/{id}/cancel` → `{ data: true }`.
- `GET /health` → `{ ok: true, mock: "kitai" }`.
- CORS как сейчас (`*`, `Authorization` добавляем в allowed headers).
- `Authorization` заголовок мок игнорирует (но логирует факт наличия).
- Задержка ответа `/result` остаётся ~`MOCK_DELAY_MS / 3` чтобы поллинг ощущался.

## Конфиг

- Порт мока: 3002 (env `MOCK_PORT`, дефолт 3001 — у пользователя 3001 занят, поднимаем явно 3002).
- Frontend env: `VITE_API_URL=http://localhost:3002`, `VITE_KITAI_AGENT_ID=dashboarder`, `VITE_KITAI_TOKEN=mock-token`.

## Что НЕ делаем

- `/api/v1/context/*` (стейт диалога).
- SSE / стриминг.
- Реальный вызов KitAI.
- Удаление `infra/`, `agents/`, `config/openclaw.*`. Файлы становятся неиспользуемыми, но оставляем — концепция может вернуться или часть пригодится для прода.

## Риски / допущения

- Допущение: `calling_agent_name` в `UniversalAgentQueryPDto` = идентификатор целевого агента. Swagger описывает его как «Имя вызывающего агента», что двусмысленно. Если в реальном KitAI это идентификация *вызывающей* стороны и целевой агент задаётся иначе (например через auth-токен агента), надо будет добавить отдельное поле — это локальное изменение в `send()` и в моке.
- Допущение по auth: Bearer token в `Authorization`. В swagger `securitySchemes` пустой — формат токена не специфицирован.
- Допущение по chart-данным: мок возвращает `chartOptions` как extension-поле внутри `response`. Реальный агент Дашбордер скорее всего будет возвращать структуру в `response_body` (string) — фронт должен будет уметь её парсить. На моке это можно сразу заложить: пробуем `JSON.parse(response_body)` и достаём `chartOptions`. Реализуем оба варианта (extension + parse `response_body`), чтобы переключение на реальный KitAI было меньшим скачком.
