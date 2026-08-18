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
  const allocWarningEl = document.getElementById('allocWarning');

  let currentData = null;
  // Chaveados pelo `key` que o servidor manda ('pt-12', 'fm-1'). O id cru não serve:
  // tipos de pagamento e meios sem bandeira vêm de tabelas diferentes e colidiriam.
  let clientRates = {};    // { rowKey: percentString } - taxa que o cliente paga hoje
  let clientPercents = {}; // { rowKey: percentString } - % do faturamento nesse meio

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

  // As linhas são montadas com innerHTML, então tudo que vem do servidor ou do próprio
  // usuário precisa ser escapado antes de virar HTML ou valor de atributo.
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function activeValue(group) {
    return group.querySelector('button.active')?.dataset.value;
  }

  function setActive(group, btn) {
    [...group.querySelectorAll('button')].forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  // Débito/Crédito (dependem de prazo e bandeira) + PIX (taxa única da categoria),
  // na ordem em que aparecem na tabela.
  function currentRows() {
    if (!currentData) return [];
    return [
      ...(currentData.paymentTypes || []),
      ...(currentData.flatMethods || []),
    ];
  }

  // Soma o % já alocado em todas as linhas, exceto a informada (usado pra validar
  // antes de aceitar um novo valor).
  function sumAllocatedPercent(excludeKey) {
    let total = 0;
    currentRows().forEach(row => {
      if (excludeKey !== undefined && row.key === excludeKey) return;
      if (row.gp4_rate === null) return;
      total += parseBRNumber(clientPercents[row.key] ?? '') || 0;
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

  // Entregue pelo servidor num data-attribute (em vez de <script> inline, que exigiria
  // afrouxar a Content-Security-Policy).
  const RESTRICTED_PRAZOS_BY_CATEGORY = (function () {
    const el = document.getElementById('calcConfig');
    try {
      return JSON.parse(el?.dataset.restrictedPrazos || '{}');
    } catch (err) {
      return {};
    }
  })();

  function applyPrazoRestriction() {
    const catCode = activeValue(categoryGroup);
    const restricted = RESTRICTED_PRAZOS_BY_CATEGORY[catCode] || [];
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

    // O que o vendedor já digitou NÃO é apagado ao trocar prazo/bandeira/categoria: as
    // chaves são estáveis. O PIX em especial não depende de prazo nem de bandeira, então
    // limpar tudo faria a linha dele sumir sem motivo ao comparar D+1 com D+30.
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

    let totalPeriodSavings = 0;
    let totalAnnualSavings = 0;
    let anyRowComputed = false;

    ratesBody.innerHTML = '';
    currentRows().forEach(row => {
      const tr = document.createElement('tr');

      const gp4Rate = row.gp4_rate; // decimal ou null
      const clientRateStr = clientRates[row.key] ?? '';
      const clientRateDecimal = clientRateStr !== '' ? parseBRNumber(clientRateStr) / 100 : NaN;

      const percentStr = clientPercents[row.key] ?? '';
      const ownPercentValue = parseBRNumber(percentStr) || 0;
      // Em branco = cliente não usa esse meio de pagamento, então a fatia de volume é 0.
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

      // Nada de bloquear campo ao bater 100%: para redistribuir o rateio era preciso
      // zerar outra linha antes, o que travava a edição. Agora tudo continua editável e
      // quem avisa que a conta não fecha é o aviso acima dos totais.
      const percentDisabled = gp4Rate === null;

      tr.dataset.hasPercent = (percentStr !== '' && ownPercentValue > 0) ? '1' : '0';

      tr.innerHTML = `
        <td>${esc(row.name)}${row.note ? `<div class="row-note">${esc(row.note)}</div>` : ''}</td>
        <td class="mono">${gp4Rate !== null ? formatPercent(gp4Rate) : '<span style="color:var(--text-muted);">não cadastrada</span>'}</td>
        <td class="mono">
          <input type="text" inputmode="decimal" class="mono client-rate-input" style="text-align:right;max-width:110px;margin-left:auto;"
            placeholder="0,00" data-key="${esc(row.key)}" value="${esc(clientRateStr)}"
            aria-label="Taxa atual do cliente em ${esc(row.name)}" ${gp4Rate === null ? 'disabled' : ''}>
        </td>
        <td class="mono">
          <input type="text" inputmode="decimal" class="mono client-percent-input" style="text-align:right;max-width:90px;margin-left:auto;"
            placeholder="0,00" data-key="${esc(row.key)}" value="${esc(percentStr)}"
            aria-label="Percentual de vendas em ${esc(row.name)}" ${percentDisabled ? 'disabled' : ''}>
        </td>
        <td class="mono">${diffBadge}</td>
        <td class="mono">${formatCurrency(periodSavings)}</td>
        <td class="mono">${formatCurrency(annualSavings)}</td>
      `;
      ratesBody.appendChild(tr);
    });

    // A tabela é reconstruída a cada tecla, então o foco e a posição do cursor precisam
    // voltar exatamente para onde estavam — senão não dá para corrigir o meio de um número.
    function restoreCursor(selector, key, caret) {
      const el = ratesBody.querySelector(`${selector}[data-key="${key}"]`);
      if (!el) return;
      el.focus();
      const pos = Math.min(caret ?? el.value.length, el.value.length);
      el.setSelectionRange(pos, pos);
    }

    [...ratesBody.querySelectorAll('.client-rate-input')].forEach(input => {
      input.addEventListener('input', e => {
        const key = e.target.dataset.key;
        const caret = e.target.selectionStart;
        clientRates[key] = e.target.value;
        renderTable();
        restoreCursor('.client-rate-input', key, caret);
      });
    });

    [...ratesBody.querySelectorAll('.client-percent-input')].forEach(input => {
      input.addEventListener('input', e => {
        const key = e.target.dataset.key;
        const caret = e.target.selectionStart;
        // Passar de 100% é aceito e sinalizado no aviso, em vez de rejeitado com alert().
        // O alert() bloqueava a página e apagava o que a pessoa tinha acabado de digitar.
        clientPercents[key] = e.target.value;
        renderTable();
        restoreCursor('.client-percent-input', key, caret);
      });
    });

    renderAllocationWarning(totalPercentAllocated);

    // Totais no final da calculadora
    totalsCard.style.display = anyRowComputed || totalPercentAllocated > 0 ? 'grid' : 'none';
    totalPercentEl.textContent = totalPercentAllocated.toFixed(2).replace('.', ',') + '%';
    totalPercentEl.style.color = Math.abs(totalPercentAllocated - 100) < EPSILON ? 'var(--success)' : 'var(--accent)';
    totalPeriodSavingsEl.textContent = formatCurrency(totalPeriodSavings);
    totalAnnualSavingsEl.textContent = formatCurrency(totalAnnualSavings);
  }

  // Antes, alocar 60%% e imprimir gerava uma proposta 40%% menor sem nenhum sinal — o único
  // indício era a cor do total. Agora a diferença é dita com todas as letras, e o aviso sai
  // também na impressão.
  function renderAllocationWarning(total) {
    const fmt = n => n.toFixed(2).replace('.', ',') + '%';

    if (total <= EPSILON) {
      allocWarningEl.style.display = 'none';
      return;
    }
    if (Math.abs(total - ALLOCATION_LIMIT) < EPSILON) {
      allocWarningEl.style.display = 'none';
      return;
    }

    const over = total > ALLOCATION_LIMIT;
    allocWarningEl.className = 'alloc-warning ' + (over ? 'over' : 'incomplete');
    allocWarningEl.style.display = 'block';
    allocWarningEl.innerHTML = over
      ? `O rateio soma ${fmt(total)}, acima de 100%.
         <span class="alloc-detail">Os totais abaixo estão superestimados em ${fmt(total - ALLOCATION_LIMIT)}. Revise antes de apresentar ao cliente.</span>`
      : `O rateio soma ${fmt(total)} — faltam ${fmt(ALLOCATION_LIMIT - total)}.
         <span class="alloc-detail">Os totais abaixo consideram só a parte alocada, então a economia real do cliente é maior do que a mostrada.</span>`;
  }

  document.getElementById('printButton')?.addEventListener('click', () => {
    // Sinal de rastreabilidade: "fez uma simulação". Manda só os códigos de categoria/
    // prazo/bandeira — nunca as taxas do cliente nem o volume. Fire-and-forget: não
    // pode atrasar o print() nem quebrar a impressão se a rede falhar.
    if (currentData) {
      fetch('/calculator/api/log-simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryCode: currentData.category.code,
          prazoCode: currentData.prazo.code,
          brandCode: currentData.brand.code,
        }),
        keepalive: true,
      }).catch(() => {});
    }
    window.print();
  });

  // Garante que a proposta impressa sempre caiba em 1 folha A4, mesmo que o vendedor
  // preencha muitos tipos de pagamento. CSS estático (fontes pequenas, tabela compacta)
  // já cobre o caso comum, mas não é uma garantia: se o conteúdo passar do limite da
  // página, medimos a altura real e encolhemos tudo proporcionalmente para caber —
  // em vez de deixar o navegador criar uma 2ª folha.
  //
  // PRINT_MARGIN_MM precisa bater com a margem do @page em style.css.
  const PRINT_MARGIN_MM = 10;
  const PX_PER_MM = 96 / 25.4;

  function fitToOnePage() {
    const container = document.querySelector('.container');
    if (!container) return;
    container.style.transform = '';
    container.style.width = '';

    const pageHeightPx = (297 - PRINT_MARGIN_MM * 2) * PX_PER_MM;
    const contentHeightPx = container.scrollHeight;
    // Nunca amplia (scale > 1): só encolhe quando o conteúdo realmente não cabe.
    const scale = Math.min(1, pageHeightPx / contentHeightPx);
    if (scale >= 0.999) return;

    container.style.transformOrigin = 'top left';
    container.style.transform = `scale(${scale})`;
    // Compensa a largura: sem isso, o conteúdo encolhido deixaria uma faixa em branco
    // à direita da página em vez de ocupar a largura útil inteira.
    container.style.width = `${100 / scale}%`;
  }

  function resetPageFit() {
    const container = document.querySelector('.container');
    if (container) { container.style.transform = ''; container.style.width = ''; }
  }

  window.addEventListener('beforeprint', fitToOnePage);
  window.addEventListener('afterprint', resetPageFit);

  applyPrazoRestriction();
  loadRates();
})();
