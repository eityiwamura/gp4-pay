// Meios de pagamento sem bandeira e sem prazo (hoje só o PIX).
//
// Regra de negócio: o PIX da GP4 Pay existe só na maquininha, ou seja, na categoria SUB.
// Mesmo padrão dos outros arquivos de regra: lista o que NÃO vale por categoria.
const RESTRICTED_METHODS_BY_CATEGORY = {
  SITE: ['PIX'],
};

function allowedFlatMethods(categoryCode, methods) {
  const restricted = RESTRICTED_METHODS_BY_CATEGORY[categoryCode] || [];
  if (restricted.length === 0) return methods;
  return methods.filter(m => !restricted.includes(m.code));
}

// Categorias em que um determinado meio pode ser cadastrado.
function allowedCategoriesForMethod(methodCode, categories) {
  return categories.filter(c => !(RESTRICTED_METHODS_BY_CATEGORY[c.code] || []).includes(methodCode));
}

module.exports = {
  RESTRICTED_METHODS_BY_CATEGORY,
  allowedFlatMethods,
  allowedCategoriesForMethod,
};
