const express = require('express');
const router = express.Router();
const admin = require('../controllers/adminController');
const { requireAdmin, requireAdminGuest } = require('../middleware/adminAuth');

// Auth
router.get('/login',  requireAdminGuest, admin.getLogin);
router.post('/login', requireAdminGuest, admin.postLogin);
router.get('/logout', admin.logout);

// Dashboard
router.get('/', requireAdmin, admin.getDashboard);

// Users
router.get('/users',                     requireAdmin, admin.getUsers);
router.get('/users/:id',                 requireAdmin, admin.getUser);
router.post('/users/:id/suspend',        requireAdmin, admin.suspendUser);
router.post('/users/:id/delete',         requireAdmin, admin.deleteUser);
router.post('/users/:id/adjust-balance', requireAdmin, admin.adjustBalance);

// KYC
router.post('/kyc/:submissionId/approve', requireAdmin, admin.approveKyc);
router.post('/kyc/:submissionId/reject',  requireAdmin, admin.rejectKyc);

// Transactions
router.get('/transactions',                        requireAdmin, admin.getTransactions);
router.post('/transactions/:txnId/confirm-deposit',requireAdmin, admin.confirmDeposit);
router.post('/transactions/:txnId/approve',        requireAdmin, admin.approveWithdrawal);
router.post('/transactions/:txnId/reject',         requireAdmin, admin.rejectWithdrawal);

// Chats
router.get('/chats',                    requireAdmin, admin.getChats);
router.get('/chats/unread-count',       requireAdmin, admin.getChatUnreadCount);
router.get('/chats/:userId',            requireAdmin, admin.getChatThread);
router.post('/chats/:userId/reply',     requireAdmin, admin.postChatReply);

// Deposit Wallets
router.get('/wallets',      requireAdmin, admin.getWallets);
router.post('/wallets/:id', requireAdmin, admin.updateWallet);

// Settings
router.get('/settings',  requireAdmin, admin.getSettings);
router.post('/settings', requireAdmin, admin.postSettings);

module.exports = router;
