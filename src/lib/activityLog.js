const pool = require('../db');

// Rótulo em português de cada ação, usado tanto para validar o código quanto para
// renderizar a tela de Rastreabilidade. Adicionar uma ação nova é só acrescentar aqui.
const ACTIONS = {
  login: 'Entrou',
  login_failed: 'Falha ao entrar',
  logout: 'Saiu',
  view_screen: 'Acessou',
  simulation: 'Fez uma simulação',
  rate_saved: 'Alterou taxas',
  user_created: 'Criou usuário',
  user_updated: 'Editou usuário',
  user_deleted: 'Excluiu usuário',
  access_denied: 'Tentou acessar sem permissão',
};

// Grava a linha. Lança em erro — use dentro de uma transação quando o registro faz
// parte de uma mudança real (salvar taxa, criar usuário): sem log, sem mudança.
async function logActivity({ userId, userName, action, detail, ip }, client = pool) {
  if (!ACTIONS[action]) throw new Error(`Ação de rastreabilidade desconhecida: ${action}`);
  await client.query(
    `INSERT INTO activity_log (user_id, user_name, action, detail, ip_address) VALUES ($1, $2, $3, $4, $5)`,
    [userId ?? null, userName || 'desconhecido', action, detail || null, ip || null]
  );
}

// Para eventos que não devem nunca atrapalhar a ação principal (login, navegação, logout):
// se a gravação falhar, só registra no console e segue — auditoria não pode derrubar login.
async function logActivityBestEffort(entry, client = pool) {
  try {
    await logActivity(entry, client);
  } catch (err) {
    console.error('Falha ao registrar rastreabilidade (ignorado):', err.message);
  }
}

// Middleware: registra que req.user acessou uma tela. Fire-and-forget de propósito —
// não faz sentido atrasar a resposta esperando a gravação de um log.
function logView(label) {
  return function (req, res, next) {
    logActivityBestEffort({
      userId: req.user?.id,
      userName: req.user?.name,
      action: 'view_screen',
      detail: label,
      ip: req.ip,
    });
    next();
  };
}

module.exports = { ACTIONS, logActivity, logActivityBestEffort, logView };
