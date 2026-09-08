(function () {
  const idPhotoInput = document.getElementById('idPhotoInput');
  const scanBtn = document.getElementById('scanBtn');
  const scanStatus = document.getElementById('scanStatus');

  const docNumberInput = document.getElementById('docNumber');
  const docNumberHint = document.getElementById('docNumberHint');
  const pinInput = document.getElementById('pin');
  const pinHint = document.getElementById('pinHint');
  const fullNameInput = document.getElementById('fullName');
  const photoConsentRow = document.getElementById('photoConsentRow');
  const photoConsentCheckbox = document.getElementById('photoConsent');

  const form = document.getElementById('dealForm');
  const formMessage = document.getElementById('formMessage');
  const dealsTableBody = document.getElementById('dealsTableBody');

  // Подтверждено ли поле явным действием менеджера (не просто "просмотрено").
  // Сбрасывается в true при ручном редактировании, см. requirement п.9/п.11.
  const state = { docNumberConfirmed: false, pinConfirmed: false };

  idPhotoInput.addEventListener('change', () => {
    scanBtn.disabled = !idPhotoInput.files || !idPhotoInput.files.length;
  });

  function markAutofilled(input, hintEl) {
    input.classList.add('autofilled');
    hintEl.hidden = false;
  }

  function clearAutofilled(input, hintEl) {
    input.classList.remove('autofilled');
    hintEl.hidden = true;
  }

  docNumberInput.addEventListener('input', () => {
    state.docNumberConfirmed = true;
    clearAutofilled(docNumberInput, docNumberHint);
  });
  pinInput.addEventListener('input', () => {
    state.pinConfirmed = true;
    clearAutofilled(pinInput, pinHint);
  });

  // Сжатие фото на клиенте перед отправкой (как в текущем воркфлоу с
  // Google Lens/Live Text) — снижает объём и время загрузки на 4G.
  function compressImage(file, maxDimension = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => {
        img.onload = () => {
          const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('compress failed'))), 'image/jpeg', quality);
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function setScanStatus(text, kind) {
    scanStatus.textContent = text;
    scanStatus.className = 'scan-status' + (kind ? ' ' + kind : '');
  }

  scanBtn.addEventListener('click', async () => {
    const file = idPhotoInput.files && idPhotoInput.files[0];
    if (!file) return;

    scanBtn.disabled = true;
    setScanStatus('Распознавание документа…');

    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append('photo', compressed, 'id.jpg');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch('/api/scan-id', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        // Провайдер недоступен/лимит/таймаут — форма остаётся рабочей,
        // fallback на ручной ввод (п.9 ТЗ).
        setScanStatus('Не удалось распознать — введите вручную', 'error');
        return;
      }

      const data = await response.json();
      let filledAny = false;

      if (data.fields && data.fields.docNumber) {
        docNumberInput.value = data.fields.docNumber;
        markAutofilled(docNumberInput, docNumberHint);
        state.docNumberConfirmed = false;
        filledAny = true;
      }
      if (data.fields && data.fields.pin) {
        pinInput.value = data.fields.pin;
        markAutofilled(pinInput, pinHint);
        state.pinConfirmed = false;
        filledAny = true;
      }
      if (data.fields && data.fields.fullName && !fullNameInput.value.trim()) {
        fullNameInput.value = data.fields.fullName;
      }

      if (filledAny) {
        photoConsentRow.hidden = false;
        setScanStatus('Готово — проверьте автоподставленные поля', 'ok');
      } else {
        setScanStatus('Не удалось распознать — введите вручную', 'error');
      }
    } catch (err) {
      setScanStatus('Не удалось распознать — введите вручную', 'error');
    } finally {
      scanBtn.disabled = false;
    }
  });

  async function loadDeals() {
    const response = await fetch('/api/deals');
    if (!response.ok) return;
    const deals = await response.json();
    dealsTableBody.innerHTML = '';
    for (const deal of deals.slice().reverse()) {
      const tr = document.createElement('tr');
      const needsReview = (deal.docNumber && !deal.docNumberConfirmed) || (deal.pin && !deal.pinConfirmed);
      tr.innerHTML = `
        <td>${new Date(deal.createdAt).toLocaleString('ru-RU')}</td>
        <td>${escapeHtml(deal.fullName)}</td>
        <td>${escapeHtml(deal.docNumber || '')}</td>
        <td>${escapeHtml(deal.pin || '')}</td>
        <td>${needsReview ? '<span class="badge-unconfirmed">проверить</span>' : 'да'}</td>
      `;
      dealsTableBody.appendChild(tr);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formMessage.textContent = '';
    formMessage.className = 'form-message';

    const usesIdPhoto = Boolean(docNumberInput.value.trim() || pinInput.value.trim());
    if (usesIdPhoto && !photoConsentCheckbox.checked) {
      formMessage.textContent = 'Нужно согласие клиента на обработку фото документа';
      formMessage.className = 'form-message error';
      return;
    }

    const payload = {
      fullName: fullNameInput.value.trim(),
      phone: document.getElementById('phone').value.trim(),
      docNumber: docNumberInput.value.trim(),
      docNumberConfirmed: state.docNumberConfirmed,
      pin: pinInput.value.trim(),
      pinConfirmed: state.pinConfirmed,
      photoConsent: photoConsentCheckbox.checked,
      agreementConsent: document.getElementById('agreementConsent').checked,
      notes: document.getElementById('notes').value.trim(),
    };

    try {
      const response = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'save_failed');
      }
      formMessage.textContent = 'Заявка сохранена';
      formMessage.className = 'form-message ok';
      form.reset();
      state.docNumberConfirmed = false;
      state.pinConfirmed = false;
      clearAutofilled(docNumberInput, docNumberHint);
      clearAutofilled(pinInput, pinHint);
      photoConsentRow.hidden = true;
      scanBtn.disabled = true;
      setScanStatus('');
      loadDeals();
    } catch (err) {
      formMessage.textContent = 'Ошибка сохранения: ' + err.message;
      formMessage.className = 'form-message error';
    }
  });

  loadDeals();
})();
