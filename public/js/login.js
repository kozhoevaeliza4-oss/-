(function () {
  const form = document.getElementById('loginForm');
  const loginMessage = document.getElementById('loginMessage');

  // Уже вошли — не показываем форму входа повторно.
  fetch('/api/me')
    .then((res) => {
      if (res.ok) window.location.replace('/');
    })
    .catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginMessage.textContent = '';
    loginMessage.className = 'form-message';

    const login = document.getElementById('login').value.trim();
    const password = document.getElementById('password').value;

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Неверный логин или пароль');
      }
      window.location.href = '/';
    } catch (err) {
      loginMessage.textContent = err.message;
      loginMessage.className = 'form-message error';
    }
  });
})();
