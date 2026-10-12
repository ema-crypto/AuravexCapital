const { query } = require('../models/database');

exports.getHome = async (req, res) => {
  const plans = await query('SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order');
  res.render('public/home', { title: 'Home', plans });
};

exports.getAbout = (req, res) => {
  res.render('public/about', { title: 'About Us' });
};

exports.getPlans = async (req, res) => {
  const plans = await query('SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order');
  res.render('public/plans', { title: 'Investment Plans', plans });
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
