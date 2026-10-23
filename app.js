const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const methodOverride = require('method-override');
const { loadUser } = require('./src/middleware/auth');
const { currency, percent, dateStr, timeAgo } = require('./src/helpers/format');
const { applyLayout } = require('./src/helpers/render');
const { getSetting } = require('./src/models/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'auravexcapital-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(flash());
app.use(loadUser);

app.use(async (req, res, next) => {
  res.locals.currency = currency;
  res.locals.percent  = percent;
  res.locals.dateStr  = dateStr;
  res.locals.timeAgo  = timeAgo;
  res.locals.req      = req;
  try {
    res.locals.whatsappNumber = (await getSetting('whatsapp_number')) || '';
    res.locals.tawktoId       = (await getSetting('tawkto_id')) || '';
    res.locals.supportEmail   = process.env.FROM_EMAIL || 'noreply@auravexcapital.ltd';
  } catch (e) {
    res.locals.whatsappNumber = '';
    res.locals.tawktoId       = '';
    res.locals.supportEmail   = process.env.FROM_EMAIL || 'noreply@auravexcapital.ltd';
  }
  next();
});

applyLayout(app);

app.use('/admin', require('./src/routes/admin'));
app.use('/', require('./src/routes/index'));

app.use((req, res) => {
  res.status(404).render('public/404', { title: 'Page Not Found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('public/404', { title: 'Server Error' });
});

app.listen(PORT, () => {
  console.log(`\n AuravexCapital running at http://localhost:${PORT}\n`);
});

module.exports = app;
