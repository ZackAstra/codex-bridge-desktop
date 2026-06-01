import { EventEmitter } from "events";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import { URL } from "url";
import { clearSettingsCache, getSettings, loadSettings } from "./config";
import { handleAnthropic } from "./upstream/anthropic/handler";
import { handleOpenai } from "./upstream/openai/handler";

export interface BridgeServerOptions {
  port: number;
  env: Record<string, string>;
}

export class BridgeServer extends EventEmitter {
  private server: Server | null = null;
  private port: number;
  private env: Record<string, string>;
  private activeResponses = new Set<ServerResponse>();

  constructor(opts: BridgeServerOptions) {
    super();
    this.port = opts.port;
    this.env = opts.env;
  }

  async start(): Promise<void> {
    if (this.server) return;

    clearSettingsCache();
    loadSettings(this.env);

    const settings = getSettings();
    if (!settings.anthropicAuthToken) {
      this.emitLog("[WARN] ANTHROPIC_AUTH_TOKEN not set. Anthropic upstream unavailable.");
    }
    if (!settings.anthropicModel) {
      this.emitLog("[WARN] ANTHROPIC_MODEL not set. Configure default model.");
    } else {
      this.emitLog(`[PROXY] Loaded model: ${settings.anthropicModel}`);
    }

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, "0.0.0.0", () => resolve());
      this.server!.on("error", reject);
    });

    this.emitLog(`Bridge listening on 0.0.0.0:${this.port}`);
  }

  async stop(): Promise<void> {
    for (const res of this.activeResponses) {
      try {
        res.destroy();
      } catch {
        /* ignore */
      }
    }
    this.activeResponses.clear();

    if (!this.server) return;

    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
    });
    this.server = null;
  }

  private emitLog(text: string): void {
    this.emit("log", text);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const path = url.pathname;

    try {
      if (req.method === "GET" && (path === "/models" || path === "/v1/models")) {
        await this.handleListModels(url, res);
        return;
      }

      if (req.method === "POST" && (path === "/responses" || path === "/v1/responses")) {
        await this.handleResponses(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (e) {
      this.emitLog(`Request error: ${e}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: String(e), type: "internal_error" } }));
      }
    }
  }

  private async handleListModels(url: URL, res: ServerResponse): Promise<void> {
    const settings = getSettings();

    if (settings.upstreamFormat === "openai") {
      try {
        const query = url.searchParams.toString();
        const modelsUrl = `${settings.openaiBaseUrl.replace(/\/$/, "")}/models${query ? `?${query}` : ""}`;
        const resp = await fetch(modelsUrl, {
          headers: { Authorization: `Bearer ${settings.openaiApiKey}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
          return;
        }
      } catch (e) {
        this.emitLog(`[PROXY] /models proxy error: ${e}`);
      }
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [
          {
            id: settings.anthropicModel,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "custom",
          },
        ],
      }),
    );
  }

  private async handleResponses(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const bodyText = await readBody(req);
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    const settings = getSettings();

    this.emitLog(`[PROXY] incoming: ${JSON.stringify(body).slice(0, 500)}`);

    const upstreamFormat = String(body.upstream_format || settings.upstreamFormat);
    this.emitLog(`[PROXY] upstream_format=${upstreamFormat}, UPSTREAM_FORMAT=${settings.upstreamFormat}`);

    const onLog = (line: string) => this.emitLog(line);

    const result =
      upstreamFormat === "openai"
        ? await handleOpenai(body, onLog)
        : await handleAnthropic(body, onLog);

    if (result.stream) {
      this.activeResponses.add(res);
      res.writeHead(result.status, result.headers);
      req.on("close", () => {
        this.activeResponses.delete(res);
        try {
          res.destroy();
        } catch {
          /* ignore */
        }
      });

      try {
        for await (const chunk of result.stream) {
          if (res.destroyed) break;
          res.write(chunk);
        }
      } catch (e) {
        this.emitLog(`Stream write error: ${e}`);
      } finally {
        this.activeResponses.delete(res);
        if (!res.destroyed) res.end();
      }
      return;
    }

    res.writeHead(result.status, result.headers);
    res.end(JSON.stringify(result.body));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
