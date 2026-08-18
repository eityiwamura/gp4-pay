// O Express 4 não captura Promise rejeitada dentro de um handler: a requisição fica
// pendurada até o navegador desistir. Todo handler async precisa passar por aqui.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
