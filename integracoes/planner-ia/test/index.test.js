import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const request = (path, method = "GET", headers = {}) =>
  new Request("https://example.workers.dev" + path, { method, headers });

test("health revela apenas disponibilidade, sem conexao ao Firebase", async () => {
  const response = await worker.fetch(request("/health"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, {
    service: "ipcvt-planner-ia",
    status: "setup",
    firestoreConnected: false,
    capabilitiesEnabled: []
  });
});

test("nenhuma rota de consulta ou criacao esta habilitada", async () => {
  for (const path of ["/", "/plans", "/tasks", "/mcp", "/api/plans", "/api/tasks"]) {
    const response = await worker.fetch(request(path));
    assert.equal(response.status, 404, path);
  }
});

test("metodos de escrita continuam bloqueados", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await worker.fetch(request("/api/plans", method));
    assert.equal(response.status, 404, method);
  }
});

test("nao habilita acesso publico via CORS", async () => {
  const response = await worker.fetch(request("/health", "GET", {
    Origin: "https://outro-site.example"
  }));
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
