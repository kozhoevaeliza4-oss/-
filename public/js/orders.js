(function () {
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

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const STATUS_LABELS = {
    registered: 'Зарегистрирован',
    needs_review: 'Требует проверки',
    cancelled: 'Отменен',
    invalid: 'Недействителен',
  };

  // ---- Одиночная регистрация (Сценарий А) ----
  const orderPhotoInput = document.getElementById('orderPhotoInput');
  const scanOrderBtn = document.getElementById('scanOrderBtn');
  const orderScanStatus = document.getElementById('orderScanStatus');
  const orderPreview = document.getElementById('orderPreview');
  const orderNeedsReview = document.getElementById('orderNeedsReview');
  const duplicateWarning = document.getElementById('duplicateWarning');
  const fDate = document.getElementById('fDate');
  const fType = document.getElementById('fType');
  const fEmployee = document.getElementById('fEmployee');
  const fOrg = document.getElementById('fOrg');
  const fSummary = document.getElementById('fSummary');
  const fNote = document.getElementById('fNote');
  const fSuggestedNumber = document.getElementById('fSuggestedNumber');
  const confirmOrderBtn = document.getElementById('confirmOrderBtn');
  const cancelOrderBtn = document.getElementById('cancelOrderBtn');
  const orderConfirmMessage = document.getElementById('orderConfirmMessage');

  let currentScan = null; // { scanToken, ocrRawText, ocrConfidence, needsReview }

  orderPhotoInput.addEventListener('change', () => {
    scanOrderBtn.disabled = !orderPhotoInput.files || !orderPhotoInput.files.length;
  });

  function setOrderScanStatus(text, kind) {
    orderScanStatus.textContent = text;
    orderScanStatus.className = 'scan-status' + (kind ? ' ' + kind : '');
  }

  scanOrderBtn.addEventListener('click', async () => {
    const file = orderPhotoInput.files && orderPhotoInput.files[0];
    if (!file) return;

    scanOrderBtn.disabled = true;
    setOrderScanStatus('Распознавание приказа…');
    orderConfirmMessage.textContent = '';

    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append('photo', compressed, 'order.jpg');

      const response = await fetch('/api/orders/scan', { method: 'POST', body: formData });
      if (!response.ok) {
        setOrderScanStatus('Не удалось распознать — введите данные вручную', 'error');
        return;
      }
      const data = await response.json();

      currentScan = {
        scanToken: data.scanToken,
        ocrRawText: data.ocrRawText,
        ocrConfidence: data.ocrConfidence,
        needsReview: data.needsReview,
      };

      fDate.value = data.fields.date || '';
      fType.value = data.fields.type || '';
      fEmployee.value = data.fields.employeeName || '';
      fOrg.value = data.fields.orgName || '';
      fSummary.value = data.fields.summary || '';
      fNote.value = '';
      fSuggestedNumber.textContent = '№' + data.suggestedNumber;

      orderNeedsReview.hidden = !data.needsReview;

      if (data.duplicates && data.duplicates.length) {
        const top = data.duplicates[0];
        duplicateWarning.hidden = false;
        duplicateWarning.innerHTML =
          `⚠️ Возможно, данный приказ уже зарегистрирован под №${top.number}. ` +
          `Совпадение: ${top.matched.join(', ')}. ` +
          `<button type="button" class="link-btn" id="openExistingBtn">Открыть существующую запись</button>`;
        document.getElementById('openExistingBtn').addEventListener('click', () => openExisting(top.id));
      } else {
        duplicateWarning.hidden = true;
        duplicateWarning.innerHTML = '';
      }

      orderPreview.hidden = false;
      setOrderScanStatus('Готово — проверьте данные', 'ok');
    } catch (err) {
      setOrderScanStatus('Не удалось распознать — введите данные вручную', 'error');
    } finally {
      scanOrderBtn.disabled = false;
    }
  });

  async function openExisting(existingId) {
    if (!currentScan) return;
    await fetch('/api/orders/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanToken: currentScan.scanToken, action: 'open_existing', existingId }),
    });
    resetOrderForm();
    orderConfirmMessage.textContent = 'Открыта существующая запись №' + existingId;
    orderConfirmMessage.className = 'form-message ok';
    loadRegistry();
  }

  function resetOrderForm() {
    orderPreview.hidden = true;
    orderPhotoInput.value = '';
    scanOrderBtn.disabled = true;
    currentScan = null;
    setOrderScanStatus('');
  }

  confirmOrderBtn.addEventListener('click', async () => {
    if (!currentScan) return;
    confirmOrderBtn.disabled = true;

    const payload = {
      scanToken: currentScan.scanToken,
      action: 'register_new',
      ocrRawText: currentScan.ocrRawText,
      ocrConfidence: currentScan.ocrConfidence,
      needsReview: currentScan.needsReview,
      fields: {
        date: fDate.value || null,
        type: fType.value.trim() || null,
        employeeName: fEmployee.value.trim() || null,
        orgName: fOrg.value.trim() || null,
        summary: fSummary.value.trim(),
        note: fNote.value.trim(),
      },
    };

    try {
      const response = await fetch('/api/orders/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('confirm_failed');
      const data = await response.json();
      orderConfirmMessage.textContent = `✅ Приказ зарегистрирован. Номер приказа: №${data.entry.number}`;
      orderConfirmMessage.className = 'form-message ok';
      resetOrderForm();
      loadRegistry();
    } catch (err) {
      orderConfirmMessage.textContent = 'Ошибка регистрации: ' + err.message;
      orderConfirmMessage.className = 'form-message error';
      confirmOrderBtn.disabled = false;
    }
  });

  cancelOrderBtn.addEventListener('click', async () => {
    if (currentScan) {
      await fetch('/api/orders/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanToken: currentScan.scanToken, action: 'cancel' }),
      });
    }
    resetOrderForm();
  });

  // ---- Первичная массовая загрузка (Сценарий Б) ----
  const bulkPhotoInput = document.getElementById('bulkPhotoInput');
  const bulkScanBtn = document.getElementById('bulkScanBtn');
  const bulkScanStatus = document.getElementById('bulkScanStatus');
  const bulkPreviewWrap = document.getElementById('bulkPreviewWrap');
  const bulkTableBody = document.getElementById('bulkTableBody');
  const bulkConfirmBtn = document.getElementById('bulkConfirmBtn');
  const bulkConfirmMessage = document.getElementById('bulkConfirmMessage');

  let bulkItems = [];

  bulkPhotoInput.addEventListener('change', () => {
    bulkScanBtn.disabled = !bulkPhotoInput.files || !bulkPhotoInput.files.length;
  });

  bulkScanBtn.addEventListener('click', async () => {
    const files = Array.from(bulkPhotoInput.files || []);
    if (!files.length) return;

    bulkScanBtn.disabled = true;
    bulkScanStatus.textContent = `Распознавание ${files.length} документов…`;

    try {
      const formData = new FormData();
      for (const file of files) {
        const compressed = await compressImage(file);
        formData.append('photos', compressed, file.name || 'order.jpg');
      }

      const response = await fetch('/api/orders/bulk-scan', { method: 'POST', body: formData });
      if (!response.ok) throw new Error('bulk_scan_failed');
      const data = await response.json();
      bulkItems = data.items;
      renderBulkTable();
      bulkPreviewWrap.hidden = false;
      bulkScanStatus.textContent = `Распознано ${bulkItems.length}. Проверьте таблицу перед подтверждением.`;
    } catch (err) {
      bulkScanStatus.textContent = 'Ошибка распознавания: ' + err.message;
    } finally {
      bulkScanBtn.disabled = false;
    }
  });

  function renderBulkTable() {
    bulkTableBody.innerHTML = '';
    bulkItems.forEach((item, index) => {
      const tr = document.createElement('tr');
      const reviewFlag = item.needsReview ? ' ⚠️' : '';
      tr.innerHTML = `
        <td><input type="date" data-idx="${index}" data-field="date" value="${item.fields.date || ''}" /></td>
        <td><input type="text" data-idx="${index}" data-field="type" value="${escapeHtml(item.fields.type || '')}" /></td>
        <td><input type="text" data-idx="${index}" data-field="employeeName" value="${escapeHtml(item.fields.employeeName || '')}" /></td>
        <td>№${item.suggestedNumber}${reviewFlag}</td>
      `;
      bulkTableBody.appendChild(tr);
    });

    bulkTableBody.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => {
        const idx = Number(input.dataset.idx);
        const field = input.dataset.field;
        bulkItems[idx].fields[field] = input.value;
      });
    });
  }

  bulkConfirmBtn.addEventListener('click', async () => {
    if (!bulkItems.length) return;
    bulkConfirmBtn.disabled = true;

    const payload = {
      items: bulkItems.map((item) => ({
        scanToken: item.scanToken,
        ocrRawText: item.ocrRawText,
        ocrConfidence: item.ocrConfidence,
        needsReview: item.needsReview,
        fields: {
          date: item.fields.date || null,
          type: item.fields.type || null,
          employeeName: item.fields.employeeName || null,
          orgName: item.fields.orgName || null,
          summary: item.fields.summary || '',
          note: '',
        },
      })),
    };

    try {
      const response = await fetch('/api/orders/bulk-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('bulk_confirm_failed');
      const data = await response.json();
      bulkConfirmMessage.textContent = `✅ Зарегистрировано приказов: ${data.entries.length}`;
      bulkConfirmMessage.className = 'form-message ok';
      bulkItems = [];
      bulkPreviewWrap.hidden = true;
      bulkPhotoInput.value = '';
      bulkScanBtn.disabled = true;
      bulkScanStatus.textContent = '';
      loadRegistry();
    } catch (err) {
      bulkConfirmMessage.textContent = 'Ошибка подтверждения: ' + err.message;
      bulkConfirmMessage.className = 'form-message error';
    } finally {
      bulkConfirmBtn.disabled = false;
    }
  });

  // ---- Поиск и реестр ----
  const searchQ = document.getElementById('searchQ');
  const searchBtn = document.getElementById('searchBtn');
  const registryTableBody = document.getElementById('registryTableBody');

  async function loadRegistry(query) {
    const url = query ? `/api/orders/search?q=${encodeURIComponent(query)}` : '/api/orders/search?q=';
    const response = await fetch(url);
    if (!response.ok) return;
    const entries = await response.json();
    renderRegistry(entries.slice().sort((a, b) => (b.number || 0) - (a.number || 0)));
  }

  function renderRegistry(entries) {
    registryTableBody.innerHTML = '';
    for (const entry of entries) {
      const tr = document.createElement('tr');
      const canCancel = entry.status === 'registered' || entry.status === 'needs_review';
      tr.innerHTML = `
        <td>№${entry.number}</td>
        <td>${escapeHtml(entry.date || '')}</td>
        <td>${escapeHtml(entry.type || '')}</td>
        <td>${escapeHtml(entry.employeeName || '')}</td>
        <td class="status-${entry.status}">${STATUS_LABELS[entry.status] || entry.status}</td>
        <td>${canCancel ? `<button type="button" class="link-btn" data-id="${entry.id}">Отменить</button>` : ''}</td>
      `;
      registryTableBody.appendChild(tr);
    }

    registryTableBody.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const reason = prompt('Причина отмены (необязательно):') || '';
        await fetch(`/api/orders/${btn.dataset.id}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, status: 'cancelled' }),
        });
        loadRegistry(searchQ.value.trim());
      });
    });
  }

  searchBtn.addEventListener('click', () => loadRegistry(searchQ.value.trim()));
  searchQ.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadRegistry(searchQ.value.trim());
  });

  loadRegistry('');
})();
