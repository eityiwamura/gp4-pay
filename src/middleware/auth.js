const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    res.locals.user = payload;
    next();
  } catch (err) {
    return res.redirect('/login');
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).render('error', { message: 'Acesso restrito ao administrador.', user: req.user });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
