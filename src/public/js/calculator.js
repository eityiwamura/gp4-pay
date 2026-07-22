(function () {
  const categoryGroup = document.getElementById('categoryGroup');
  const prazoGroup = document.getElementById('prazoGroup');
  const brandGroup = document.getElementById('brandGroup');
  const periodGroup = document.getElementById('periodGroup');
  const volumeInput = document.getElementById('volumeInput');
  const volumeHelper = document.getElementById('volumeHelper');
  const ratesBody = document.getElementById('ratesBody');
  const colPeriod = document.getElementById('colPeriod');

  const summaryCard = document.getElementById('summaryCard');
  const summaryCatPrazo = document.getElementById('summaryCatPrazo');
  const summaryPrazo = document.getElementById('summaryPrazo');
  const summaryVolumeLabel = document.getElementById('summaryVolumeLabel');
  const summaryVolume = document.getElementById('summaryVolume');

  const totalsCard = document.getElementById('totalsCard');
  const totalPercentEl = document.getElementById('totalPercent');
  const totalPeriodLabel = document.getElementById('totalPeriodLabel');
  const totalPeriodSavingsEl = document.getElementById('totalPeriodSavings');
  const totalAnnualSavingsEl = document.getElementById('totalAnnualSavings');

  let currentData = null;
  let clientRates = {};    // { paymentTypeId: percentString } - taxa que o cliente paga hoje
  let clientPercents = {}; // { paymentTypeId: percentString } - % do faturamento do cliente nesse tipo

  const ALLOCATION_LIMIT = 100;
  const EPSILON = 0.01; // tolerância pra arredondamento

  // Período do valor de vendas informado é independente do prazo de recebimento GP4.
  // 'day'   -> volume é por dia,  projeção anual = economia_no_periodo x 365
  // 'month' -> volume é por mês,  projeção anual = economia_no_periodo x 12
  const PERIOD_CONFIG = {
    day: { label: 'por dia', annualMultiplier: 365 },
    month: { label: 'por mês', annualMultiplier: 12 },
  };

  const currencyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function parseBRNumber(str) {
    if (!str) return NaN;
    return parseFloat(str.replace(/\./g, '').replace(',', '.'));
  }

  function formatPercent(decimal) {
    if (decimal === null || Number.isNaN(decimal)) return '—';
    return (decimal * 100).toFixed(2).replace('.', ',') + '%';
  }

  function formatCurrency(value) {
    if (Number.isNaN(value)) return '—';
    return currencyFmt.format(value);
  }

  function activeValue(group) {
    return group.querySelector('button.active')?.dataset.value;
  }

  function setActive(group, btn) {
    [...group.querySelectorAll('button')].forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  // Soma o % já alocado em todos os tipos, exceto o informado (usado pra validar antes de aceitar um novo valor)
  function sumAllocatedPercent(excludeId) {
    if (!currentData) return 0;
    let total = 0;
    currentData.paymentTypes.forEach(pt => {
      if (excludeId !== undefined && String(pt.id) === String(excludeId)) return;
      if (pt.gp4_rate === null) return;
      total += parseBRNumber(clientPercents[pt.id] ?? '') || 0;
    });
    return total;
  }

  categoryGroup.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setActive(categoryGroup, btn);
    applyPrazoRestriction();
    loadRates();
  });

  prazoGroup.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setActive(prazoGroup, btn);
    loadRates();
  });

  brandGroup.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setActive(brandGroup, btn);
    loadRates();
  });

  periodGroup.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setActive(periodGroup, btn);
    renderTable();
  });

  function applyPrazoRestriction() {
    const catCode = activeValue(categoryGroup);
    const restricted = (window.RESTRICTED_PRAZOS_BY_CATEGORY && window.RESTRICTED_PRAZOS_BY_CATEGORY[catCode]) || [];
    const buttons = [...prazoGroup.querySelectorAll('button')];
    buttons.forEach(b => {
      b.style.display = restricted.includes(b.dataset.value) ? 'none' : '';
    });
    const activeBtn = prazoGroup.querySelector('button.active');
    if (!activeBtn || restricted.includes(activeBtn.dataset.value)) {
      const fallback = buttons.find(b => !restricted.includes(b.dataset.value));
      if (fallback) setActive(prazoGroup, fallback);
    }
  }

  volumeInput.addEventListener('input', renderTable);

  async function loadRates() {
    const catCode = activeValue(categoryGroup);
    const prazoCode = activeValue(prazoGroup);
    const brandCode = activeValue(brandGroup);
    ratesBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">Carregando taxas...</td></tr>';

    const res = await fetch(`/calculator/api/rates/${catCode}/${prazoCode}/${brandCode}`);
    if (!res.ok) {
      ratesBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--danger);padding:24px;">Não foi possível carregar as taxas.</td></tr>';
      return;
    }
    currentData = await res.json();
    clientRates = {};
    clientPercents = {};

    renderTable();
  }

  function renderTable() {
    if (!currentData) return;
    const periodKey = activeValue(periodGroup) || 'month';
    const period = PERIOD_CONFIG[periodKey];
    const volume = parseBRNumber(volumeInput.value) || 0;

    document.getElementById('volumeLabel').textContent = `Valor médio de vendas (${period.label})`;
    volumeHelper.textContent = `Projeção anual calculada como economia ${period.label} x ${period.annualMultiplier}.`;
    colPeriod.textContent = `Economia (${period.label})`;
    totalPeriodLabel.textContent = `Economia total (${period.label})`;

    summaryCard.style.display = 'grid';
    summaryCatPrazo.textContent = `${currentData.category.name} · ${currentData.brand.name}`;
    summaryPrazo.textContent = currentData.prazo.name;
    summaryVolumeLabel.textContent = `Volume informado (${period.label})`;
    summaryVolume.textContent = formatCurrency(volume);

    const totalPercentAllocated = sumAllocatedPercent();
    const allocationFull = totalPercentAllocated >= (ALLOCATION_LIMIT - EPSILON);

    let totalPeriodSavings = 0;
    let totalAnnualSavings = 0;
    let anyRowComputed = false;

    ratesBody.innerHTML = '';
    currentData.paymentTypes.forEach(pt => {
      const tr = document.createElement('tr');

      const gp4Rate = pt.gp4_rate; // decimal or null
      const clientRateStr = clientRates[pt.id] ?? '';
      const clientRateDecimal = clientRateStr !== '' ? parseBRNumber(clientRateStr) / 100 : NaN;

      const percentStr = clientPercents[pt.id] ?? '';
      const ownPercentValue = parseBRNumber(percentStr) || 0;
      // Em branco = cliente não usa esse tipo de pagamento, então a fatia de volume é 0.
      const percentDecimal = percentStr !== '' ? (ownPercentValue / 100) : 0;

      const diff = (gp4Rate !== null && !Number.isNaN(clientRateDecimal)) ? (clientRateDecimal - gp4Rate) : NaN;
      const rowVolume = volume * percentDecimal;
      const periodSavings = !Number.isNaN(diff) ? diff * rowVolume : NaN;
      const annualSavings = !Number.isNaN(periodSavings) ? periodSavings * period.annualMultiplier : NaN;

      if (!Number.isNaN(periodSavings)) {
        totalPeriodSavings += periodSavings;
        totalAnnualSavings += annualSavings;
        anyRowComputed = true;
      }

      const diffBadge = !Number.isNaN(diff)
        ? `<span class="badge ${diff >= 0 ? 'positive' : 'negative'}">${formatPercent(diff)}</span>`
        : '—';

      // Uma vez que o rateio bateu 100%, os campos ainda vazios/zerados ficam bloqueados
      // (o que já tem valor continua editável, pra permitir corrigir).
      const percentLocked = gp4Rate !== null && allocationFull && ownPercentValue <= 0;
      const percentDisabled = gp4Rate === null || percentLocked;

      tr.dataset.hasPercent = (percentStr !== '' && ownPercentValue > 0) ? '1' : '0';

      tr.innerHTML = `
        <td>${pt.name}</td>
        <td class="mono">${gp4Rate !== null ? formatPercent(gp4Rate) : '<span style="color:var(--text-muted);">não cadastrada</span>'}</td>
        <td class="mono">
          <input type="text" inputmode="decimal" class="mono client-rate-input" style="text-align:right;max-width:110px;margin-left:auto;"
            placeholder="0,00" data-id="${pt.id}" value="${clientRateStr}" ${gp4Rate === null ? 'disabled' : ''}>
        </td>
        <td class="mono">
          <input type="text" inputmode="decimal" class="mono client-percent-input" style="text-align:right;max-width:90px;margin-left:auto;"
            placeholder="0,00" data-id="${pt.id}" value="${percentStr}" ${percentDisabled ? 'disabled title="Rateio já atingiu 100%"' : ''}>
        </td>
        <td class="mono">${diffBadge}</td>
        <td class="mono">${formatCurrency(periodSavings)}</td>
        <td class="mono">${formatCurrency(annualSavings)}</td>
      `;
      ratesBody.appendChild(tr);
    });

    [...ratesBody.querySelectorAll('.client-rate-input')].forEach(input => {
      input.addEventListener('input', e => {
        clientRates[e.target.dataset.id] = e.target.value;
        renderTable();
        const el = ratesBody.querySelector(`.client-rate-input[data-id="${e.target.dataset.id}"]`);
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    });

    [...ratesBody.querySelectorAll('.client-percent-input')].forEach(input => {
      input.addEventListener('input', e => {
        const id = e.target.dataset.id;
        const newValue = parseBRNumber(e.target.value) || 0;
        const otherTotal = sumAllocatedPercent(id);

        if (otherTotal + newValue > ALLOCATION_LIMIT + EPSILON) {
          alert('Você já atingiu 100% do rateio, favor revisar.');
          e.target.value = clientPercents[id] ?? '';
          return;
        }

        clientPercents[id] = e.target.value;
        renderTable();
        const el = ratesBody.querySelector(`.client-percent-input[data-id="${id}"]`);
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    });

    // Totais no final da calculadora
    totalsCard.style.display = anyRowComputed || totalPercentAllocated > 0 ? 'grid' : 'none';
    totalPercentEl.textContent = totalPercentAllocated.toFixed(2).replace('.', ',') + '%';
    totalPercentEl.style.color = Math.abs(totalPercentAllocated - 100) < EPSILON ? 'var(--success)' : 'var(--accent)';
    totalPeriodSavingsEl.textContent = formatCurrency(totalPeriodSavings);
    totalAnnualSavingsEl.textContent = formatCurrency(totalAnnualSavings);
  }

  applyPrazoRestriction();
  loadRates();
})();
