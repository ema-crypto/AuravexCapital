const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const methodOverride = require('method-override');
const { loadUser } = require('./src/middleware/auth');
const { currency, percent, dateStr, timeAgo } = require('./src/helpers/format');
const { applyLayout } = require('./src/helpers/render');
const { getDb, getSetting } = require('./src/models/database');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

// Session
app.use(session({
  secret: 'auravexcapital-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Flash
app.use(flash());

// Load user into res.locals
app.use(loadUser);

// Global template helpers
app.use((req, res, next) => {
  res.locals.currency = currency;
  res.locals.percent  = percent;
  res.locals.dateStr  = dateStr;
  res.locals.timeAgo  = timeAgo;
  res.locals.req      = req;
  // Inject WhatsApp number from site_settings for layout templates
  try { res.locals.whatsappNumber = getSetting('whatsapp_number') || ''; } catch(e) { res.locals.whatsappNumber = ''; }
  next();
});

// Apply layout system
applyLayout(app);

// Routes
app.use('/admin', require('./src/routes/admin'));
app.use('/', require('./src/routes/index'));

// 404
app.use((req, res) => {
  res.status(404).render('public/404', { title: 'Page Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('public/404', { title: 'Server Error' });
});

app.listen(PORT, () => {
  console.log(`\n🌟 AuravexCapital running at http://localhost:${PORT}\n`);
});

module.exports = app;
