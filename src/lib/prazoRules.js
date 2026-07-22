// Regra de negócio: o prazo D+0 só existe para a categoria SITE.
// A categoria SUB não trabalha com D+0.
const RESTRICTED_PRAZOS_BY_CATEGORY = {
  SUB: ['D0'],
};

function allowedPrazos(categoryCode, prazos) {
  const restricted = RESTRICTED_PRAZOS_BY_CATEGORY[categoryCode] || [];
  if (restricted.length === 0) return prazos;
  return prazos.filter(p => !restricted.includes(p.code));
}

module.exports = { allowedPrazos, RESTRICTED_PRAZOS_BY_CATEGORY };
