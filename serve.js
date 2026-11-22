// Loopback-only static server for the dashboard.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function send(response, method, status, body, headers = {}) {
  const content = Buffer.isBuffer(body) ? body : Buffer.from(body || "", "utf8");
  response.writeHead(status, {
    "Content-Length": content.byteLength,
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(method === "HEAD" ? undefined : content);
}

function resolveRequestPath(root, requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const decodedPath = decodeURIComponent(url.pathname);
  if (decodedPath.includes("\0")) return null;
  const relativePath = decodedPath === "/"
    ? "index.html"
    : decodedPath.replace(/^\/+/, "");
  const candidate = path.resolve(root, relativePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
    ? candidate
    : null;
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:")
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1");
  } catch (_error) {
    return false;
  }
}

async function runRefresh(root) {
  const dbPath = process.env.OPENCODE_DB
    || path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
  await execFileAsync(
    process.execPath,
    [
      path.join(root, "scripts", "refresh.js"),
      "opencode",
      "--db",
      dbPath,
      "--skip-unchanged",
      "--quiet",
    ],
    { cwd: root, timeout: 120_000 },
  );
  try {
    return JSON.parse(await readFile(path.join(root, "data", "latest.json"), "utf8"));
  } catch (_error) {
    return {};
  }
}

export function createStaticServer({ root, refresh } = {}) {
  const resolvedRoot = path.resolve(root);
  let refreshing = false;

  return http.createServer(async (request, response) => {
    const method = request.method || "GET";
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (url.pathname === "/api/refresh") {
      if (method === "GET" || method === "HEAD") {
        send(response, method, 200, JSON.stringify({ available: Boolean(refresh) }), {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
        });
        return;
      }
      if (method !== "POST") {
        send(response, method, 405, "Method not allowed\n", {
          Allow: "GET, HEAD, POST",
          "Content-Type": "text/plain; charset=utf-8",
        });
        return;
      }
      request.resume();
      const origin = request.headers.origin;
      if (origin && !isLoopbackOrigin(origin)) {
        send(response, method, 403, JSON.stringify({ ok: false, error: "Origin not allowed" }), {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
        });
        return;
      }
      if (!refresh) {
        send(response, method, 501, JSON.stringify({ ok: false, error: "Refresh is not configured" }), {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
        });
        return;
      }
      if (refreshing) {
        send(response, method, 409, JSON.stringify({ ok: false, error: "Refresh already running" }), {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
        });
        return;
      }
      refreshing = true;
      try {
        const result = await refresh();
        send(response, method, 200, JSON.stringify({ ok: true, ...result }), {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
        });
      } catch (error) {
        send(response, method, 500, JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }), {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
        });
      } finally {
        refreshing = false;
      }
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      send(response, method, 405, "Method not allowed\n", {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }

    let filePath;
    try {
      filePath = resolveRequestPath(resolvedRoot, request.url || "/");
    } catch (_error) {
      send(response, method, 400, "Bad request\n", {
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }

    if (!filePath) {
      send(response, method, 404, "Not found\n", {
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error("not a file");
      const content = await readFile(filePath);
      send(response, method, 200, content, {
        "Content-Type": CONTENT_TYPES.get(path.extname(filePath).toLowerCase())
          || "application/octet-stream",
      });
    } catch (_error) {
      send(response, method, 404, "Not found\n", {
        "Content-Type": "text/plain; charset=utf-8",
      });
    }
  });
}

export async function startStaticServer({ root, port = 8765, refresh } = {}) {
  const serverRoot = root || path.dirname(fileURLToPath(import.meta.url));
  const supportsRefresh = existsSync(path.join(serverRoot, "scripts", "refresh.js"));
  const server = createStaticServer({
    root: serverRoot,
    refresh: refresh ?? (supportsRefresh ? () => runRefresh(serverRoot) : null),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  return { server, url };
}

function parsePort(value) {
  if (value === undefined) return 8765;
  if (!/^\d+$/.test(value)) throw new Error("Port must be an integer from 0 to 65535.");
  const port = Number(value);
  if (port < 0 || port > 65535) throw new Error("Port must be an integer from 0 to 65535.");
  return port;
}

const isCommandLine = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const USAGE = `Usage: node serve.js [port]

Serves this folder on 127.0.0.1 (default port 8765) so the browser can load the
dashboard and its ES modules over http. Open the printed URL, then press Ctrl-C
to stop.
`;

if (isCommandLine) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
  } else if (args.length > 1) {
    console.error(`Too many arguments.\n\n${USAGE}`);
    process.exitCode = 1;
  } else {
    try {
      const { server, url } = await startStaticServer({ port: parsePort(args[0]) });
      console.log(`AI Usage: ${url} (Ctrl-C to stop)`);
      const stop = () => server.close(() => process.exit(0));
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
