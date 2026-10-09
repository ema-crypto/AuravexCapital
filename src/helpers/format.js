function currency(amount, symbol = '$') {
  if (amount == null) return `${symbol}0.00`;
  return `${symbol}${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(val) {
  return `${parseFloat(val).toFixed(2)}%`;
}

function dateStr(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function timeAgo(d) {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function generateRef(prefix = 'TXN') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
}

function generateReferralCode(name) {
  const base = name.replace(/\s+/g, '').toUpperCase().substr(0, 4);
  return `${base}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
}

module.exports = { currency, percent, dateStr, timeAgo, generateRef, generateReferralCode };
