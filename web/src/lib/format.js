export function formatKSh(cents, { decimals = 2 } = {}) {
  const value = Number(cents || 0) / 100;
  return `KSh ${value.toLocaleString('en-KE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function formatKShShort(cents) {
  const value = Number(cents || 0) / 100;
  return `KSh ${value.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

export function parseAmount(input) {
  const cleaned = String(input ?? '').replace(/[^0-9.]/g, '');
  if (!cleaned) return NaN;
  return Math.round(Number.parseFloat(cleaned) * 100);
}

export function timeAgo(dateString) {
  if (!dateString) return '';
  const diff = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateString).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

export function formatDate(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function initials(name = '') {
  return name.slice(0, 2).toUpperCase();
}
