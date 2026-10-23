const nodemailer = require('nodemailer');

let _transport = null;

function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return _transport;
}

async function sendMail({ to, subject, html }) {
  const t = getTransport();
  if (!t) return;
  try {
    await t.sendMail({
      from: `"AuravexCapital" <${process.env.FROM_EMAIL || 'noreply@auravexcapital.ltd'}>`,
      to, subject, html,
    });
  } catch (err) {
    console.error('[Email error]', err.message);
  }
}

const SITE = process.env.SITE_URL || 'https://auravex-capital.vercel.app';

function wrap(body) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f2f5;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table width="560" cellpadding="0" cellspacing="0" style="background:#0a0e1a;border-radius:12px;overflow:hidden;max-width:560px;">
  <tr><td style="background:linear-gradient(135deg,#c9a227,#f0cc6a);padding:24px 32px;">
    <span style="font-size:1.4rem;font-weight:800;color:#0a0e1a;letter-spacing:-.5px;">AC AuravexCapital</span>
  </td></tr>
  <tr><td style="padding:32px;color:#e4e9f0;">${body}</td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #1e2535;font-size:.75rem;color:#5a6478;text-align:center;">
    © 2026 AuravexCapital &nbsp;·&nbsp; <a href="mailto:support@auravexcapital.ltd" style="color:#c9a227;">support@auravexcapital.ltd</a>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function btn(text, url) {
  return `<a href="${url}" style="display:inline-block;background:#c9a227;color:#0a0e1a;padding:12px 28px;border-radius:6px;font-weight:700;text-decoration:none;margin-top:16px;">${text}</a>`;
}

function detail(label, val) {
  return `<tr><td style="padding:8px 0;color:#8892a4;font-size:.85rem;">${label}</td><td style="padding:8px 0;color:#e4e9f0;font-weight:600;text-align:right;">${val}</td></tr>`;
}

exports.sendVerificationEmail = (to, name, verifyUrl) => sendMail({
  to, subject: 'Verify your AuravexCapital email address',
  html: wrap(`
    <h2 style="color:#c9a227;margin:0 0 12px;">Welcome, ${name}!</h2>
    <p style="margin:0 0 16px;line-height:1.6;">Your account is ready — just verify your email to unlock investing.</p>
    <div style="background:#161b2e;border-radius:8px;padding:20px;margin-bottom:20px;border-left:3px solid #c9a227;">
      <p style="margin:0 0 8px;font-size:.85rem;color:#8892a4;">Click the button below to verify. This link expires in <strong style="color:#c9a227;">24 hours</strong>.</p>
    </div>
    ${btn('Verify Email Address →', verifyUrl)}
    <p style="margin:20px 0 0;font-size:.8rem;color:#5a6478;">If you didn't create this account, you can safely ignore this email.</p>
  `),
});

exports.sendWelcome = (to, name) => sendMail({
  to, subject: 'Welcome to AuravexCapital 🎉',
  html: wrap(`
    <h2 style="color:#c9a227;margin:0 0 12px;">Welcome, ${name}!</h2>
    <p style="margin:0 0 16px;line-height:1.6;">Your AuravexCapital account is now active and ready to earn daily returns.</p>
    <div style="background:#161b2e;border-radius:8px;padding:20px;margin-bottom:16px;border-left:3px solid #c9a227;">
      <p style="margin:0 0 10px;font-size:.85rem;color:#8892a4;">Get started in 3 steps:</p>
      <p style="margin:4px 0;font-size:.875rem;">1️⃣ &nbsp;Make a deposit in crypto</p>
      <p style="margin:4px 0;font-size:.875rem;">2️⃣ &nbsp;Pick an investment plan</p>
      <p style="margin:4px 0;font-size:.875rem;">3️⃣ &nbsp;Watch your balance grow daily</p>
    </div>
    ${btn('Go to Dashboard →', `${SITE}/dashboard`)}
  `),
});

exports.notifyAdmin = (subject, title, rows, link) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return Promise.resolve();
  const rowHtml = rows.map(([k, v]) => detail(k, v)).join('');
  const siteUrl = process.env.SITE_URL || SITE;
  return sendMail({
    to: adminEmail, subject,
    html: wrap(`
      <h2 style="color:#c9a227;margin:0 0 12px;">${title}</h2>
      <table width="100%" style="border:1px solid #1e2535;border-radius:8px;padding:16px;background:#161b2e;border-collapse:separate;">${rowHtml}</table>
      ${link ? btn('View in Admin →', siteUrl + link) : ''}
    `),
  });
};

exports.sendDepositPending = (to, name, amount, coin, txnRef) => sendMail({
  to, subject: '📥 Deposit Received – Under Review',
  html: wrap(`
    <h2 style="color:#c9a227;margin:0 0 12px;">Deposit Under Review</h2>
    <p style="margin:0 0 16px;">Hi ${name}, we've received your deposit and it's being confirmed on the blockchain.</p>
    <table width="100%" style="border:1px solid #1e2535;border-radius:8px;padding:16px;background:#161b2e;border-collapse:separate;">
      ${detail('Amount', `$${parseFloat(amount).toFixed(2)}`)}
      ${detail('Coin / Network', coin)}
      ${detail('Reference', txnRef)}
      ${detail('Status', '<span style="color:#f59e0b;">Pending</span>')}
    </table>
    <p style="margin:16px 0 0;font-size:.85rem;color:#8892a4;">Typically confirmed within 30–60 minutes. You'll receive another email once approved.</p>
  `),
});

exports.sendDepositConfirmed = (to, name, amount, coin, txnRef) => sendMail({
  to, subject: '✅ Deposit Confirmed – Balance Updated',
  html: wrap(`
    <h2 style="color:#c9a227;margin:0 0 12px;">Deposit Confirmed!</h2>
    <p style="margin:0 0 16px;">Hi ${name}, your deposit has been verified and your balance has been updated.</p>
    <table width="100%" style="border:1px solid #1e2535;border-radius:8px;padding:16px;background:#161b2e;border-collapse:separate;">
      ${detail('Amount', `$${parseFloat(amount).toFixed(2)}`)}
      ${detail('Coin / Network', coin)}
      ${detail('Reference', txnRef)}
      ${detail('Status', '<span style="color:#10b981;font-weight:700;">Confirmed ✓</span>')}
    </table>
    <p style="margin:16px 0 0;font-size:.85rem;color:#8892a4;">Your balance is ready. Visit your dashboard to start investing.</p>
    ${btn('Go to Dashboard →', `${SITE}/dashboard`)}
  `),
});

exports.sendWithdrawalSubmitted = (to, name, amount, wallet, txnRef) => sendMail({
  to, subject: '📤 Withdrawal Request Submitted',
  html: wrap(`
    <h2 style="color:#c9a227;margin:0 0 12px;">Withdrawal Submitted</h2>
    <p style="margin:0 0 16px;">Hi ${name}, your withdrawal is queued for processing.</p>
    <table width="100%" style="border:1px solid #1e2535;border-radius:8px;padding:16px;background:#161b2e;border-collapse:separate;">
      ${detail('Amount', `$${parseFloat(amount).toFixed(2)}`)}
      ${detail('Wallet', `<span style="font-size:.8rem;word-break:break-all;">${wallet}</span>`)}
      ${detail('Reference', txnRef)}
      ${detail('ETA', '1 – 24 hours')}
    </table>
    <p style="margin:16px 0 0;font-size:.85rem;color:#8892a4;">Contact support if you haven't received funds after 24 hours.</p>
  `),
});

exports.sendWithdrawalApproved = (to, name, amount, txnRef) => sendMail({
  to, subject: '✅ Withdrawal Approved – Funds Sent',
  html: wrap(`
    <h2 style="color:#c9a227;margin:0 0 12px;">Withdrawal Approved</h2>
    <p style="margin:0 0 16px;">Hi ${name}, your withdrawal has been approved and funds are on their way.</p>
    <table width="100%" style="border:1px solid #1e2535;border-radius:8px;padding:16px;background:#161b2e;border-collapse:separate;">
      ${detail('Amount', `$${parseFloat(amount).toFixed(2)}`)}
      ${detail('Reference', txnRef)}
      ${detail('Status', '<span style="color:#10b981;font-weight:700;">Approved & Sent ✓</span>')}
    </table>
    <p style="margin:16px 0 0;font-size:.85rem;color:#8892a4;">Funds typically arrive within 1–24 hours. Contact support if you experience delays.</p>
  `),
});

exports.sendWithdrawalRejected = (to, name, amount, txnRef) => sendMail({
  to, subject: '❌ Withdrawal Request Rejected',
  html: wrap(`
    <h2 style="color:#f43f5e;margin:0 0 12px;">Withdrawal Rejected</h2>
    <p style="margin:0 0 16px;">Hi ${name}, unfortunately your withdrawal request could not be processed at this time.</p>
    <table width="100%" style="border:1px solid #1e2535;border-radius:8px;padding:16px;background:#161b2e;border-collapse:separate;">
      ${detail('Amount', `$${parseFloat(amount).toFixed(2)}`)}
      ${detail('Reference', txnRef)}
      ${detail('Status', '<span style="color:#f43f5e;font-weight:700;">Rejected</span>')}
    </table>
    <p style="margin:16px 0 0;font-size:.85rem;color:#8892a4;">Your funds have been returned to your balance. Please contact support for more information.</p>
    ${btn('Contact Support →', `${SITE}/contact`)}
  `),
});

exports.sendChatReply = (to, name, replyMessage) => sendMail({
  to, subject: '💬 New Reply from AuravexCapital Support',
  html: wrap(`
    <h2 style="color:#c9a227;margin:0 0 12px;">Support Reply</h2>
    <p style="margin:0 0 16px;">Hi ${name}, you have a new reply from our support team.</p>
    <div style="background:#161b2e;border-radius:8px;padding:20px;margin-bottom:16px;border-left:3px solid #c9a227;">
      <p style="margin:0;line-height:1.6;color:#e4e9f0;">${replyMessage.replace(/\n/g,'<br>')}</p>
    </div>
    ${btn('Open Dashboard →', `${SITE}/dashboard`)}
    <p style="margin:16px 0 0;font-size:.8rem;color:#5a6478;">You can also reply via the live chat widget on your dashboard.</p>
  `),
});
