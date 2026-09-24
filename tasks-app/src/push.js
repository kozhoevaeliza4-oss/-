const webpush = require('web-push');

// Отправка Web Push всем устройствам роли. Подписки, которые браузер
// отозвал (404/410), удаляются, чтобы не слать в пустоту.
function createPusher({ store, vapid }) {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  return async function sendToRole(role, payload) {
    const subs = store.data.subscriptions[role] || [];
    if (!subs.length) return;
    const body = JSON.stringify(payload);
    const gone = [];
    await Promise.all(
      subs.map((sub) =>
        webpush.sendNotification(sub, body, { TTL: 60 * 60 * 12, urgency: 'high' }).catch((err) => {
          if (err.statusCode === 404 || err.statusCode === 410) gone.push(sub.endpoint);
          else console.error(`Не удалось отправить уведомление (${role}):`, err.statusCode || err.message);
        }),
      ),
    );
    if (gone.length) {
      store.data.subscriptions[role] = store.data.subscriptions[role].filter((s) => !gone.includes(s.endpoint));
      store.save();
    }
  };
}

module.exports = { createPusher };
