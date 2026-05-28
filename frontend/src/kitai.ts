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
