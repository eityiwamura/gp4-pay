require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const ratesRoutes = require('./routes/rates');
const calculatorRoutes = require('./routes/calculator');
const { requireAuth } = require('./middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.locals.user = null;
  next();
});

app.use(authRoutes);
app.use(ratesRoutes);
app.use('/calculator', calculatorRoutes);

app.get('/', requireAuth, (req, res) => {
  res.render('dashboard');
});

app.use((req, res) => {
  res.status(404).render('error', { message: 'Página não encontrada.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GP4 Taxas rodando na porta ${PORT}`);
});
