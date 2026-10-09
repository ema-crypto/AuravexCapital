const express = require('express');
const router = express.Router();
const pub = require('../controllers/publicController');
const auth = require('../controllers/authController');
const dash = require('../controllers/dashboardController');
const { requireAuth, requireGuest } = require('../middleware/auth');

// Public
router.get('/', pub.getHome);
router.get('/about', pub.getAbout);
router.get('/plans', pub.getPlans);
router.get('/faq', pub.getFaq);
router.get('/contact', pub.getContact);
router.post('/contact', pub.postContact);

// Auth
router.get('/login', requireGuest, auth.getLogin);
router.post('/login', requireGuest, auth.postLogin);
router.get('/register', requireGuest, auth.getRegister);
router.post('/register', requireGuest, auth.postRegister);
router.get('/forgot-password', requireGuest, auth.getForgotPassword);
router.post('/forgot-password', requireGuest, auth.postForgotPassword);
router.get('/logout', auth.logout);

// Dashboard (protected)
router.get('/dashboard', requireAuth, dash.getDashboard);
router.get('/dashboard/plans', requireAuth, dash.getPlans);
router.post('/dashboard/invest', requireAuth, dash.postInvest);
router.get('/dashboard/investments', requireAuth, dash.getInvestments);
router.get('/dashboard/history', requireAuth, dash.getHistory);
router.get('/dashboard/withdraw', requireAuth, dash.getWithdraw);
router.post('/dashboard/withdraw', requireAuth, dash.postWithdraw);
router.post('/dashboard/wallet/add', requireAuth, dash.postAddWallet);
router.get('/dashboard/deposit', requireAuth, dash.getDeposit);
router.get('/dashboard/profile', requireAuth, dash.getProfile);
router.post('/dashboard/profile', requireAuth, dash.postUpdateProfile);
router.post('/dashboard/profile/password', requireAuth, dash.postChangePassword);

module.exports = router;
