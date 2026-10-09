// ── FAQ accordion ──
document.querySelectorAll('.faq-q').forEach(q => {
  q.addEventListener('click', () => {
    const item = q.closest('.faq-item');
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  });
});

// ── Mobile sidebar ──
const hamburger = document.querySelector('.hamburger');
const sidebar   = document.querySelector('.sidebar');
const overlay   = document.getElementById('sidebar-overlay');
if (hamburger && sidebar) {
  hamburger.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
  });
}
if (overlay) {
  overlay.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    overlay.classList.remove('active');
  });
}

// ── Profile tabs ──
document.querySelectorAll('.profile-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const panel = tab.dataset.panel;
    document.querySelectorAll('.profile-tab, .profile-panel').forEach(el => el.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(panel)?.classList.add('active');
  });
});

// ── Copy referral link ──
const copyBtn = document.getElementById('copy-ref-link');
if (copyBtn) {
  copyBtn.addEventListener('click', () => {
    const input = document.getElementById('ref-link-input');
    if (input) {
      navigator.clipboard.writeText(input.value).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = 'Copy Link', 2000);
      });
    }
  });
}

// ── Crypto selector on deposit page ──
document.querySelectorAll('.crypto-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.crypto-opt').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    const network = opt.dataset.network;
    const addressBox = document.getElementById('deposit-address-box');
    const addressEl  = document.getElementById('deposit-address');
    const noteEl     = document.getElementById('deposit-network');
    if (addressBox && addressEl) {
      addressBox.style.display = 'block';
      if (noteEl) noteEl.textContent = network;
    }
  });
});

// ── Auto-dismiss alerts ──
setTimeout(() => {
  document.querySelectorAll('.alert').forEach(a => {
    a.style.transition = 'opacity .5s';
    a.style.opacity = '0';
    setTimeout(() => a.remove(), 500);
  });
}, 5000);

// ── Plan invest modal (inline amount prompt) ──
document.querySelectorAll('.btn-invest-plan').forEach(btn => {
  btn.addEventListener('click', () => {
    const form = btn.closest('form');
    if (form) form.submit();
  });
});

// ── Password toggle ──
document.querySelectorAll('.password-toggle').forEach(toggle => {
  toggle.addEventListener('click', () => {
    const input = toggle.previousElementSibling;
    if (input && input.type === 'password') {
      input.type = 'text';
      toggle.innerHTML = '&#128065;';
    } else if (input) {
      input.type = 'password';
      toggle.innerHTML = '&#128274;';
    }
  });
});
