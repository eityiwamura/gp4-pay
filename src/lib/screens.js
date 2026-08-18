// Telas do sistema que podem ser liberadas individualmente para usuários comuns.
// Administrador enxerga todas, sempre — as permissões só se aplicam a role 'vendedor'.
const SCREENS = [
  {
    key: 'calculator',
    name: 'Calculadora',
    description: 'Comparar taxas e montar a proposta de economia para o cliente.',
  },
  {
    key: 'rates',
    name: 'Cadastro de Taxas',
    description: 'Editar as taxas GP4 por categoria, bandeira e prazo.',
  },
  {
    key: 'users',
    name: 'Gestão de Usuários',
    description: 'Criar e editar usuários. Só o administrador pode criar outros administradores.',
  },
];

const SCREEN_KEYS = SCREENS.map(s => s.key);

function isValidScreen(key) {
  return SCREEN_KEYS.includes(key);
}

function can(user, screenKey) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(screenKey);
}

// Normaliza o que veio do formulário: aceita string única ou array, descarta chave inválida.
function parseScreens(raw) {
  const list = raw === undefined ? [] : (Array.isArray(raw) ? raw : [raw]);
  return [...new Set(list.filter(k => typeof k === 'string' && isValidScreen(k)))];
}

module.exports = { SCREENS, SCREEN_KEYS, isValidScreen, can, parseScreens };
