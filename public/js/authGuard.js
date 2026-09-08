// Подключается первым скриптом на защищённых страницах (index.html,
// orders.html). Реальная защита данных — на сервере (requireAuth проверяет
// сессию на каждом API-запросе, см. server/src/middleware/auth.js); этот
// скрипт только улучшает UX — уводит неавторизованного пользователя на
// страницу входа и подставляет название компании в шапку.
(function () {
  fetch('/api/me')
    .then((res) => {
      if (!res.ok) {
        window.location.replace('/login.html');
        return null;
      }
      return res.json();
    })
    .then((data) => {
      if (!data) return;
      const nameEl = document.getElementById('companyName');
      if (nameEl) nameEl.textContent = data.companyName;
    })
    .catch(() => {
      window.location.replace('/login.html');
    });

  document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logoutBtn');
    if (!logoutBtn) return;
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' }).catch(() => {});
      window.location.href = '/login.html';
    });
  });
})();
