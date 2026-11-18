// Etapa 2: estrutura fechada por padrao. Nenhum dado do Planner e exposto aqui.
// Nao adicionar rotas de leitura/criacao antes de validar a identidade Google,
// consultar comissao_acessos e testar permissoes e auditoria no servidor.

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      // Apenas disponibilidade: nao retornar e-mails, tokens ou configuracoes.
      return json(200, {
        service: "ipcvt-planner-ia",
        status: "setup",
        firestoreConnected: false,
        capabilitiesEnabled: []
      });
    }

    // Todo o restante permanece inacessivel ate a proxima etapa de seguranca.
    return json(404, { error: "not_found" });
  }
};
