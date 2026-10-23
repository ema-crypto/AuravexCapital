const { query, getSetting, run } = require('../models/database');

async function promoStatus() {
  const active = await getSetting('promo_active');
  if (active !== '1') return { live: false, endTime: null };
  const endTime = await getSetting('promo_end_time');
  if (endTime && new Date(endTime) < new Date()) {
    await run("INSERT OR REPLACE INTO site_settings (key,value,updated_at) VALUES ('promo_active','0',CURRENT_TIMESTAMP)");
    return { live: false, endTime: null };
  }
  return { live: true, endTime: endTime || null };
}

async function getPlansFiltered() {
  const { live, endTime } = await promoStatus();
  const sql = live
    ? 'SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order'
    : 'SELECT * FROM plans WHERE is_active = 1 AND is_promo = 0 ORDER BY sort_order';
  return { plans: await query(sql), promoEndTime: live ? endTime : null };
}

exports.getHome = async (req, res) => {
  const { plans, promoEndTime } = await getPlansFiltered();
  res.render('public/home', { title: 'Home', plans, promoEndTime });
};

exports.getAbout = (req, res) => {
  res.render('public/about', { title: 'About Us' });
};

exports.getPlans = async (req, res) => {
  const { plans, promoEndTime } = await getPlansFiltered();
  res.render('public/plans', { title: 'Investment Plans', plans, promoEndTime });
};

exports.getFaq = (req, res) => {
  res.render('public/faq', { title: 'FAQ' });
};

exports.getContact = (req, res) => {
  res.render('public/contact', { title: 'Contact Us', success: req.flash('success'), errors: req.flash('error') });
};

exports.postContact = (req, res) => {
  req.flash('success', "Your message has been sent. We'll get back to you within 24 hours.");
  res.redirect('/contact');
};
