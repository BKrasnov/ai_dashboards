# KitAI «Дашбордер» (mock PoC)

Минимальный стенд: React UI ходит в **мок KitAI Public Integration API** к агенту «Dashboarder» по паттерну register → poll → commit. Реальный KitAI пока не подключен — на бэке Node-мок.

## Архитектура
```
React UI ──► (mock) KitAI API ──► Agent «Dashboarder» ──► GigaChat
              POST  /api/v1/query/agent
              GET   /api/v1/query/{id}/result   (poll)
              PUT   /api/v1/query/{id}/commit
```

## Что внутри репо
- `scripts/dev/mock-gateway.js` — Node-мок подмножества KitAI.
- `frontend/src/kitai.ts` — клиент KitAI: `getAgent`, `runAgentQuery` (register + poll + commit).
- `frontend/src/App.tsx` — Vite + React UI: поля Agent ID / Auth token, trace pipeline, JSON-панели, Highcharts.
- `swagger.json` — спека KitAI.Public.IntegrationalApi.
- `infra/`, `agents/`, `config/openclaw.*` — артефакты прошлой концепции (OpenClaw + gpt2giga + GigaChat). В текущем сценарии не используются, но оставлены для истории.

## Быстрый старт (мок)

В одной сессии PowerShell:
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
Открыть http://localhost:5173/. UI на загрузке дёрнет `GET /api/v1/agent/dashboarder` (имя и описание агента покажутся в шапке карточки). По «Отправить» выполняется цикл register → poll → commit и показывается ответ + (опционально) Highcharts.

## Эндпоинты мока

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/api/v1/agent` | Список агентов (один — Dashboarder) |
| GET | `/api/v1/agent/{id}` | Детали агента (id игнорируется, всегда Dashboarder) |
| POST | `/api/v1/query/agent` | Регистрация query. Body: `{ query_id, calling_agent_name, query, …extra }`. Ответ: `{ data: { queryId, success } }` |
| GET | `/api/v1/query/{id}/result` | Поллинг. Первые 2 вызова — `is_final:false`, 3-й — `is_final:true` с `response.choices[0].message.content`. Если в payload было `wantChart:true` или в `query` есть «график/chart/диаграм» — добавляет `response.chartOptions` |
| PUT | `/api/v1/query/{id}/commit` | Подтвердить получение |
| DELETE | `/api/v1/query/{id}/cancel` | Отменить query |

Auth заголовок `Authorization: Bearer …` мок принимает, но игнорирует (только логирует факт наличия).

## Env-переменные фронта

| Переменная | Дефолт | Назначение |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3001` | База KitAI API |
| `VITE_KITAI_AGENT_ID` | `dashboarder` | ID агента (идёт в `calling_agent_name` и в путь `/api/v1/agent/{id}`) |
| `VITE_KITAI_TOKEN` | пусто | Bearer токен. Если пусто — заголовок не отправляется |

## Переход на реальный KitAI

Поменять `VITE_API_URL` на адрес стенда KitAI, положить токен в `VITE_KITAI_TOKEN`. Если в реальном API целевой агент задаётся **не** через `calling_agent_name` (swagger описывает его как «Имя вызывающего агента» — двусмысленно), править нужно только `frontend/src/kitai.ts:runAgentQuery` — там единственное место сборки `requestPayload`.

## Артефакты прошлой концепции (OpenClaw + gpt2giga + GigaChat)

Если нужны — см. `infra/docker-compose.yml`, `config/openclaw*.json`, `agents/`. В текущей ветке UI с ними не работает.
