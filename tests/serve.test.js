import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverUrl = pathToFileURL(path.resolve(__dirname, "../serve.js")).href;


function request(port, requestPath, method = "GET") {
  return new Promise((resolve, reject) => {
    const requestHandle = http.request({
      host: "127.0.0.1",
      method,
      path: requestPath,
      port,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        headers: response.headers,
        status: response.statusCode,
      }));
    });
    requestHandle.on("error", reject);
    requestHandle.end();
  });
}

test("serves the package on loopback with safe HTTP semantics", async (t) => {
  const { startStaticServer } = await import(serverUrl);
  const directory = await mkdtemp(path.join(tmpdir(), "codex-usage-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "package");
  await mkdir(root);
  await writeFile(path.join(root, "index.html"), "<h1>Dashboard</h1>", "utf8");
  await writeFile(path.join(root, "dashboard.js"), "window.ready = true;", "utf8");
  await writeFile(path.join(directory, "secret.txt"), "outside", "utf8");

  const { server, url } = await startStaticServer({ root, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const port = server.address().port;

  const home = await request(port, "/");
  assert.equal(home.status, 200);
  assert.equal(home.body, "<h1>Dashboard</h1>");
  assert.match(home.headers["content-type"], /^text\/html/);

  const script = await request(port, "/dashboard.js");
  assert.equal(script.status, 200);
  assert.equal(script.body, "window.ready = true;");
  assert.match(script.headers["content-type"], /^text\/javascript/);

  const head = await request(port, "/dashboard.js", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal(Number(head.headers["content-length"]), Buffer.byteLength(script.body));

  assert.equal((await request(port, "/missing.js")).status, 404);
  assert.equal((await request(port, "/%2e%2e/secret.txt")).status, 404);
  const post = await request(port, "/", "POST");
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET, HEAD");
});
