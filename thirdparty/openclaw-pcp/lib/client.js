/**
 * Minimal PCP service API client (docs/service-sync.md). Holds the plugin's
 * service credential; errors never include it.
 */

export class PcpError extends Error {
  constructor(message, { status = 0, code = "" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }

  /** Network failure, timeout, 5xx or 429: worth retrying later. */
  get transient() {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
}

export function validateBaseUrl(raw) {
  const url = new URL(raw);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Plugin cannot start: openclaw-pcp/configuration — baseUrl must be https or loopback http.");
  }
  return url;
}

export function createPcpClient({ baseUrl, token, fetchImpl = globalThis.fetch }) {
  const base = validateBaseUrl(baseUrl);
  async function call(pathname, body, timeoutMs) {
    let response;
    try {
      response = await fetchImpl(new URL(pathname, base), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new PcpError(`PCP unreachable: openclaw-pcp/transport — ${timedOut ? "request timed out" : "connection failed"} (${pathname}).`);
    }
    let data = null;
    try { data = await response.json(); } catch { /* non-JSON error page */ }
    if (!response.ok) {
      throw new PcpError(`PCP request rejected: openclaw-pcp/transport — HTTP ${response.status} ${data?.code || ""} (${pathname}).`, { status: response.status, code: data?.code || "" });
    }
    return data;
  }
  return {
    grant: (body, timeoutMs) => call("/api/v1/service/grants", body, timeoutMs),
    sync: (body, timeoutMs) => call("/api/v1/service/sync", body, timeoutMs),
    recall: (body, timeoutMs) => call("/api/v1/service/recall", body, timeoutMs),
    search: (body, timeoutMs) => call("/api/v1/service/search", body, timeoutMs),
  };
}
