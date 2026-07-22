// Regra de negócio: a categoria SITE não opera parcelamento acima de 18x,
// então taxas de Créd.19x a Créd.24x não podem ser cadastradas para ela.
const RESTRICTED_CODES_BY_CATEGORY = {
  SITE: ['C19', 'C20', 'C21', 'C22', 'C23', 'C24'],
};

function allowedPaymentTypes(categoryCode, paymentTypes) {
  const restricted = RESTRICTED_CODES_BY_CATEGORY[categoryCode] || [];
  if (restricted.length === 0) return paymentTypes;
  return paymentTypes.filter(pt => !restricted.includes(pt.code));
}

module.exports = { allowedPaymentTypes, RESTRICTED_CODES_BY_CATEGORY };
