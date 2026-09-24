const fs = require('fs');
const path = require('path');

const EMPTY = () => ({
  tasks: [],
  subscriptions: { assistant: [], boss: [] },
  secrets: {},
});

// Хранилище в одном JSON-файле: для двух пользователей и сотен задач этого
// более чем достаточно. Запись атомарная (через временный файл + rename),
// чтобы сбой посреди записи не испортил данные.
function createStore(file) {
  let data = EMPTY();

  if (file && fs.existsSync(file)) {
    try {
      data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      data.subscriptions = { assistant: [], boss: [], ...data.subscriptions };
    } catch (err) {
      const backup = `${file}.broken-${Date.now()}`;
      fs.copyFileSync(file, backup);
      console.error(`Не удалось прочитать ${file}, копия сохранена в ${backup}:`, err.message);
    }
  }

  function save() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  return {
    get data() {
      return data;
    },
    save,
  };
}

module.exports = { createStore };
