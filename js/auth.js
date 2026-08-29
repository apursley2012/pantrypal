(function () {
  const ACCOUNT_KEY = 'pantrypal.accounts.v1';
  const SESSION_KEY = 'pantrypal.activeUser.v1';

  function readAccounts() {
    try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || '{}'); }
    catch { return {}; }
  }
  function writeAccounts(accounts) { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts)); }
  function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
  function getActiveUser() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }
  function setActiveUser(user) {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_KEY);
    renderAuthNav();
  }
  async function hashPassword(password) {
    const bytes = new TextEncoder().encode(password);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function register({name, email, password}) {
    const cleanEmail = normalizeEmail(email);
    const accounts = readAccounts();
    if (!cleanEmail || !password || !String(name || '').trim()) throw new Error('Please complete every field.');
    if (accounts[cleanEmail]) throw new Error('An account with that email already exists.');
    const user = { id: 'u-' + Date.now().toString(36), name: String(name).trim(), email: cleanEmail, createdAt: new Date().toISOString() };
    accounts[cleanEmail] = { ...user, passwordHash: await hashPassword(password) };
    writeAccounts(accounts);
    migrateGuestDataToUser(user.id);
    setActiveUser(user);
    return user;
  }
  async function login(email, password) {
    const cleanEmail = normalizeEmail(email);
    const account = readAccounts()[cleanEmail];
    if (!account || account.passwordHash !== await hashPassword(password)) throw new Error('Email or password is incorrect.');
    const user = { id: account.id, name: account.name, email: account.email, createdAt: account.createdAt };
    setActiveUser(user);
    return user;
  }
  function logout() { setActiveUser(null); location.href = 'index.html'; }
  function storagePrefix() {
    const user = getActiveUser();
    return user ? `pantrypal.user.${user.id}.` : 'pantrypal.guest.';
  }
  function scopedKey(key) { return storagePrefix() + key; }
  function migrateGuestDataToUser(userId) {
    const guestPrefix = 'pantrypal.guest.';
    const userPrefix = `pantrypal.user.${userId}.`;
    const copies = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(guestPrefix)) copies.push([key, localStorage.getItem(key)]);
    }
    for (const [key, value] of copies) localStorage.setItem(userPrefix + key.slice(guestPrefix.length), value);
  }
  function renderAuthNav() {
    const user = getActiveUser();
    document.querySelectorAll('[data-auth-nav]').forEach(el => {
      if (user) {
        const first = (user.name || 'Account').split(/\s+/)[0];
        el.innerHTML = `<span class="account-chip" title="${escapeAttr(user.email)}">${escapeHtml(first)}</span><button class="account-link account-logout" type="button">Log out</button>`;
        el.querySelector('.account-logout')?.addEventListener('click', logout);
      } else {
        el.innerHTML = '<a class="account-link" href="login.html">Log in</a><a class="account-link account-create" href="register.html">Create account</a>';
      }
    });
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(value) { return escapeHtml(value); }

  window.PantryPalAuth = { getActiveUser, register, login, logout, scopedKey, renderAuthNav };
  document.addEventListener('DOMContentLoaded', renderAuthNav);
})();
