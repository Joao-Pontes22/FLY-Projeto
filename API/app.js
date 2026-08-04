
// Ligar front = python -m http.server 3000 --directory API  
// Ligar API Base = uvicorn Olist.app:app --reload     

const API_BASE  = 'http://localhost:8000';
const DELIVERY_STORAGE_KEY = 'delivery_info_map';
const WARN_MIN  = 15;
const LIMIT_MIN = 20;

// ── DOM refs ──────────────────────────────────────────────────────────
const els = {
  loading:  document.getElementById('state-loading'),
  error:    document.getElementById('state-error'),
  empty:    document.getElementById('state-empty'),
  grid:     document.getElementById('cards-grid'),
  errorMsg: document.getElementById('error-msg'),
  statTotal:    document.getElementById('stat-total'),
  statPend:     document.getElementById('stat-pendente'),
  statAnd:      document.getElementById('stat-andamento'),
  statPronto:   document.getElementById('stat-pronto'),
  statEnviado:  document.getElementById('stat-enviado'),
  statEntregue: document.getElementById('stat-entregue'),
  statAtrasado: document.getElementById('stat-atrasado'),
  search:     document.getElementById('search-input'),
  btnRefresh: document.getElementById('btn-refresh'),
  drawer:         document.getElementById('detail-drawer'),
  drawerOverlay:  document.getElementById('drawer-overlay'),
  drawerTitle:    document.getElementById('drawer-title'),
  drawerAction:   document.getElementById('drawer-action-btn'),
  drawerBody:     document.getElementById('drawer-body'),
  drawerClose:    document.getElementById('drawer-close'),
  dayInput:    document.getElementById('day-input'),
  dayPrev:     document.getElementById('day-prev'),
  dayNext:     document.getElementById('day-next'),
  dayToday:    document.getElementById('day-today'),
  dayCalendar: document.getElementById('day-calendar'),
  dfcDays:     document.getElementById('dfc-days'),
  dfcLabel:    document.getElementById('dfc-label'),
  dfcPrev:     document.getElementById('dfc-prev'),
  dfcNext:     document.getElementById('dfc-next'),
};

let allRows    = [];
let timerTicks = [];
let selectedDay = new Date();   // dia filtrado (padrão: hoje)
selectedDay.setHours(0,0,0,0);
let motoboyInfoMap = {};
let currentDrawerData = null;
let hasLoadedOnce = false; // primeira carga mostra loading; demais atualizam em segundo plano

let calYear  = selectedDay.getFullYear();
let calMonth = selectedDay.getMonth();

// ── Helpers ───────────────────────────────────────────────────────────
function showState(s) {
  const map = { loading: els.loading, error: els.error, empty: els.empty, grid: els.grid };
  Object.entries(map).forEach(([k, el]) => el.classList.toggle('hidden', k !== s));
}

function showPopup(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 2600);
}

function situacaoLabel(sit) {
  if (!sit && sit !== 0) return { label: '—', cls: 'pill-default' };
  const s = String(sit).trim();
  if (s === '8') return { label: 'Dados Incompletos', cls: 'pill-cancelado' };
  if (s === '0' || s === '1') return { label: 'Pendente',         cls: 'pill-pendente' };
  if (s === '3') return { label: 'Em Separação',     cls: 'pill-andamento' };
  if (s === '4') return { label: 'Separada',         cls: 'pill-concluido' };
  if (s === '7') return { label: 'Pronto Envio',     cls: 'pill-embalada'  };
  if (s === '5') return { label: 'Enviada',          cls: 'pill-andamento' };
  if (s === '6') return { label: 'Entregue',         cls: 'pill-concluido' };
  if (s === '2') return { label: 'Cancelada',        cls: 'pill-cancelado' };
  if (s === '9') return { label: 'Não Entregue',     cls: 'pill-cancelado' };
  return { label: `Situação ${s}`, cls: 'pill-default' };
}

function formatDate(val) {
  if (!val) return '—';
  const d = parseDate(val);
  return !d ? val : d.toLocaleString('pt-BR');
}

function parseDate(val) {
  if (!val) return null;
  const str = String(val).trim();
  if (!str) return null;

  const isoDateOnly = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const [, year, month, day] = isoDateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const isoDateTime = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/);
  if (isoDateTime) {
    const [, year, month, day, hh, mm, ss = '0', ms = '0', tz] = isoDateTime;
    if (tz) {
      return new Date(str.replace(' ', 'T'));
    }
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hh), Number(mm), Number(ss), Number(ms));
  }

  const brMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (brMatch) {
    const [, day, month, year, hh = '0', mm = '0', ss = '0'] = brMatch;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hh), Number(mm), Number(ss));
  }

  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function parseNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const normalized = String(value)
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')
    .replace(/\./g, '')
    .replace(/,/g, '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

async function loadMotoboyInfoMap() {
  try {
    const res = await fetch(`${API_BASE}/motoboys`);
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json === 'object') {
        motoboyInfoMap = json;
      }
    }
  } catch (error) {
    console.warn('[motoboys] falha ao carregar', error);
  }
}

function getDeliveryInfoMap() {
  const raw = localStorage.getItem(DELIVERY_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveDeliveryInfoMap(map) {
  localStorage.setItem(DELIVERY_STORAGE_KEY, JSON.stringify(map));
}

function getDeliveryInfo(id) {
  if (!id && id !== 0) return null;
  const key = String(id);
  return motoboyInfoMap[key] ?? getDeliveryInfoMap()[key] ?? null;
}

async function setDeliveryInfo(id, info) {
  if (!id && id !== 0) return;
  const key = String(id);
  const payload = {
    pedidoId: Number(id),
    motoboy: String(info.motoboy ?? '').trim(),
    valorFrete: info.valorFrete ?? null,
    hora_saida: info.hora_saida ?? null,
  };

  try {
    const res = await fetch(`${API_BASE}/motoboys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      const saved = json?.motoboy ?? info;
      motoboyInfoMap[key] = { ...(motoboyInfoMap[key] || {}), ...saved };
    } else {
      motoboyInfoMap[key] = { ...(motoboyInfoMap[key] || {}), ...info };
    }
  } catch (error) {
    console.warn('[motoboys] falha ao salvar', error);
    motoboyInfoMap[key] = { ...(motoboyInfoMap[key] || {}), ...info };
  }

  const map = getDeliveryInfoMap();
  map[key] = { ...(map[key] || {}), ...info };
  saveDeliveryInfoMap(map);
}

function formatCurrency(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function elapsedMin(val) {
  if (!val) return null;
  const criado = parseDate(val);
  if (!criado) return null;

  const inicio = new Date(criado);
  inicio.setHours(9, 0, 0, 0);
  const referencia = criado < inicio ? inicio : criado;

  const agora = Date.now();
  if (agora < referencia.getTime()) return 0;
  return (agora - referencia.getTime()) / 60000;
}

function fmtElapsed(min) {
  if (min === null || min === undefined) return null;
  if (min < 60) return `${Math.floor(min)}min`;
  return `${Math.floor(min / 60)}h ${Math.floor(min % 60)}min`;
}

function isSameDay(dateVal, day) {
  const d = parseDate(dateVal);
  if (!d) return false;
  return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
}

// ── Day filter display ────────────────────────────────────────────────
function fmtDayDisplay(d) {
  return [
    String(d.getDate()).padStart(2,'0'),
    String(d.getMonth()+1).padStart(2,'0'),
    d.getFullYear(),
  ].join('/');
}

function setSelectedDay(d) {
  d.setHours(0,0,0,0);
  selectedDay = d;
  els.dayInput.value = fmtDayDisplay(d);
  calYear  = d.getFullYear();
  calMonth = d.getMonth();
  if (currentPage === 'dashboard') renderDashboard();
  else applyFilters();
}

// ── Calendar ──────────────────────────────────────────────────────────
const today = new Date(); today.setHours(0,0,0,0);

function renderCalendar() {
  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  els.dfcLabel.textContent = `${months[calMonth]} ${calYear}`;
  els.dfcDays.innerHTML = '';

  const first  = new Date(calYear, calMonth, 1).getDay();
  const daysIn = new Date(calYear, calMonth+1, 0).getDate();

  for (let i = 0; i < first; i++) {
    const el = document.createElement('div');
    el.className = 'dfc-day dfc-empty';
    els.dfcDays.appendChild(el);
  }

  for (let d = 1; d <= daysIn; d++) {
    const date = new Date(calYear, calMonth, d);
    const el   = document.createElement('div');
    el.className = 'dfc-day';
    el.textContent = d;

    if (date > today) {
      el.classList.add('dfc-disabled');
    } else {
      if (date.getTime() === today.getTime()) el.classList.add('dfc-today');
      if (date.getTime() === selectedDay.getTime()) el.classList.add('dfc-selected');
      el.addEventListener('click', () => {
        setSelectedDay(new Date(date));
        closeCalendar();
      });
    }
    els.dfcDays.appendChild(el);
  }
}

function openCalendar() {
  renderCalendar();
  els.dayCalendar.classList.remove('hidden');
}

function closeCalendar() { els.dayCalendar.classList.add('hidden'); }

els.dfcPrev.addEventListener('click', () => {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});
els.dfcNext.addEventListener('click', () => {
  const next = new Date(calYear, calMonth+1, 1);
  if (next <= today) { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } }
  renderCalendar();
});

els.dayInput.addEventListener('focus', openCalendar);
els.dayInput.addEventListener('input', () => {
  // máscara dd/mm/aaaa
  let v = els.dayInput.value.replace(/\D/g,'');
  if (v.length > 2) v = v.slice(0,2)+'/'+v.slice(2);
  if (v.length > 5) v = v.slice(0,5)+'/'+v.slice(5);
  els.dayInput.value = v.slice(0,10);

  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const d = new Date(+m[3], +m[2]-1, +m[1]);
    if (!isNaN(d) && d <= today) { setSelectedDay(d); renderCalendar(); }
  }
});

els.dayPrev.addEventListener('click', () => {
  const d = new Date(selectedDay);
  d.setDate(d.getDate()-1);
  setSelectedDay(d);
});
els.dayNext.addEventListener('click', () => {
  const d = new Date(selectedDay);
  d.setDate(d.getDate()+1);
  if (d <= today) setSelectedDay(d);
});
els.dayToday.addEventListener('click', () => setSelectedDay(new Date(today)));

document.addEventListener('click', e => {
  if (!e.target.closest('#day-filter-wrap')) closeCalendar();
});

// ── Render cards ──────────────────────────────────────────────────────
function renderCards(rows) {
  els.grid.innerHTML = '';
  timerTicks = [];

  rows.forEach(row => {
    const rowSituacao = row.venda?.situacao ?? row.situacao;
    const { label, cls } = situacaoLabel(rowSituacao);
    const dateVal = row.dataCriacao ?? row.data ?? row.dataPedido ?? row.dataVenda;
    const minAge  = elapsedMin(dateVal);
    const overdue = minAge !== null && minAge >= LIMIT_MIN;
    const pct     = minAge !== null ? Math.min((minAge / LIMIT_MIN)*100, 100) : 0;
    const barCls  = minAge === null ? 'ok' : minAge >= LIMIT_MIN ? 'overdue' : minAge >= WARN_MIN ? 'warn' : 'ok';
    const sit     = String(rowSituacao ?? '').trim();
    const clientName = String(row.cliente?.nome ?? '');
    const clientNumber = clientName.match(/^\s*(\d+)/)?.[1] || String(row.cliente?.cpfCnpj ?? '').replace(/\D/g, '').slice(0,4) || '—';
    const pedidoNumero = row.venda?.numero ?? row.numeroPedido ?? row.numero ?? row.id ?? '—';
    const deliveryInfo = getDeliveryInfo(row.venda?.id ?? row.id ?? row.numeroPedido ?? row.numero);
    const motoboy = deliveryInfo?.motoboy ?? null;
    const freteValue = parseNumber(row.valorFrete ?? row.venda?.valorFrete ?? deliveryInfo?.valorFrete ?? 0);

    const card = document.createElement('div');
    const isFinished = ['4', '7', '5', '6'].includes(sit);
    card.className = 'sep-card' + (overdue ? ' overdue' : '') + (isFinished ? ' separada' : '');
    card.innerHTML = `
      <div class="card-top">
        <div class="card-top-left">
          <span class="card-num">${clientNumber}</span>
          <span class="pill ${cls}">${label}</span>
        </div>
      </div>
      <div class="card-meta">
        <div class="card-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${formatDate(dateVal)}
        </div>
        <div class="card-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          ${(row.cliente?.nome ?? '—').trim()}
        </div>
        <div class="card-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
          Pedido #${pedidoNumero}
        </div>
        ${motoboy ? `<div class="card-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Motoboy: ${motoboy}</div>` : ''}
        ${freteValue ? `<div class="card-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>Frete: ${formatCurrency(freteValue)}</div>` : ''}
      </div>`;

    if (['0','1','3'].includes(sit)) {
      card.innerHTML += `
      <div class="timer-wrap">
        <div class="timer-label">
          <span>Tempo de espera</span>
          <span class="elapsed${overdue?' over':''}">${fmtElapsed(minAge) ?? '—'}</span>
        </div>
        <div class="timer-bar-bg">
          <div class="timer-bar-fill ${barCls}" style="width:${pct}%"></div>
        </div>
      </div>`;
    }

    card.addEventListener('click', () => openDrawer(row));
    els.grid.appendChild(card);

    if (['0','1','3'].includes(sit)) {
      const str = String(dateVal);
      const criado = /^\d{4}-\d{2}-\d{2}$/.test(str)
        ? new Date(str.replace(/-/g,'/'))
        : new Date(str);
      const nove = new Date(criado); nove.setHours(9,0,0,0);
      const startTime = (criado < nove ? nove : criado).getTime();
      const fill = card.querySelector('.timer-bar-fill');
      const labelEl = card.querySelector('.elapsed');
      if (fill && labelEl) {
        timerTicks.push({ card, fill, labelEl, startTime });
      }
    }
  });

  startTimerLoop();
}

// ── Timer loop ────────────────────────────────────────────────────────
function startTimerLoop() {
  clearInterval(window._timerLoop);
  window._timerLoop = setInterval(() => {
    timerTicks.forEach(({ card, fill, labelEl, startTime }) => {
      if (!fill || !labelEl) return;
      const min = (Date.now() - startTime) / 60000;
      const pct = Math.min((min / LIMIT_MIN)*100, 100);
      fill.style.width = pct + '%';
      fill.className   = 'timer-bar-fill ' + (min >= LIMIT_MIN ? 'overdue' : min >= WARN_MIN ? 'warn' : 'ok');
      labelEl.textContent = fmtElapsed(min);
      labelEl.className   = 'elapsed' + (min >= LIMIT_MIN ? ' over' : '');
      if (min >= LIMIT_MIN) card.classList.add('overdue');
    });
  }, 10000);
}

// ── Drawer ────────────────────────────────────────────────────────────
async function openDrawer(sep) {
  const separacaoId = sep.id;
  const pedidoId = sep.venda?.id ?? sep.id ?? null;
  const pedidoNumero = sep.venda?.numero ?? sep.numeroPedido ?? sep.numero ?? sep.id;
  const label = pedidoNumero ? `Pedido #${pedidoNumero}` : `Separação #${separacaoId ?? ''}`;

  els.drawerTitle.textContent = label;
  els.drawerBody.innerHTML = `<div class="state-msg" style="height:200px"><div class="spinner"></div><p>Buscando detalhes...</p></div>`;
  els.drawer.classList.add('open');
  els.drawerOverlay.classList.remove('hidden');

  const sourceSepId = sep.id ?? sep.separacaoId;
  let data = sep;
  let source = 'separacao';
  if (pedidoId !== null) {
    try {
      const res = await fetch(`${API_BASE}/pedidos/${pedidoId}`);
      console.log('[drawer] fetch pedido', pedidoId, res.status);
      if (res.ok) {
        const json = await res.json();
        if (json && typeof json === 'object' && !json.mensagem) {
          if (!json.dataCriacao && sep.dataCriacao) {
            json.dataCriacao = sep.dataCriacao;
          }
          if (sourceSepId !== undefined && sourceSepId !== null) {
            json.__separacaoId = sourceSepId;
          }
          if (sep.venda?.situacao !== undefined) {
            json.venda = { ...(json.venda || {}), situacao: sep.venda.situacao, id: sep.venda.id, numero: sep.venda.numero ?? sep.numeroPedido ?? sep.numero };
          }
          data = json;
          source = 'pedido';
        } else {
          console.warn('[drawer] pedido detalhe retornou formato inesperado', json);
        }
      } else {
        console.warn('[drawer] falha fetch pedido', pedidoId, res.status);
      }
    } catch (err) {
      console.error('[drawer] erro fetch pedido', pedidoId, err);
    }
  }

  if (source === 'separacao' && sep.venda?.id === undefined && separacaoId) {
    try {
      const fallback = await fetch(`${API_BASE}/separacoes/${separacaoId}`);
      if (fallback.ok) {
        data = await fallback.json();
      } else {
        console.warn('[drawer] falha fetch separacao', separacaoId, fallback.status);
      }
    } catch (err) {
      console.error('[drawer] erro fetch separacao', separacaoId, err);
    }
  }

  const deliveryKey = data.venda?.id ?? data.id ?? data.numeroPedido ?? data.numero;
  if (deliveryKey) {
    data.entrega = data.entrega ?? getDeliveryInfo(deliveryKey);
  }

  data.__source = source;
  currentDrawerData = data;
  try {
    renderDrawerContent(data);
  } catch (err) {
    console.error('[drawer] erro renderizando conteudo', err, data);
    els.drawerBody.innerHTML = `<div class="state-msg" style="height:200px"><p>Erro ao carregar detalhes. Tente novamente.</p></div>`;
  }
}

function renderDrawerContent(sep) {
  const rowSituacao = sep.venda?.situacao ?? sep.situacao;
  const { label, cls } = situacaoLabel(rowSituacao);
  const nomeCliente = (sep.cliente?.nome ?? '—').trim();
  const numero = sep.venda?.numero ?? sep.numeroPedido ?? sep.numero ?? sep.id ?? '—';
  const dataVal = sep.dataCriacao ?? sep.data;
  const contato = sep.cliente ?? null;
  const endereco = contato?.endereco ?? null;
  const itens = sep.itens ?? sep.items ?? sep.produtos ?? [];
  const pedidoTotal = parseNumber(sep.valorTotalPedido ?? sep.valorTotal ?? sep.valor ?? 0);
  const deliveryInfo = getDeliveryInfo(sep.venda?.id ?? sep.id ?? sep.numeroPedido ?? sep.numero);
  const motoboy = deliveryInfo?.motoboy ?? null;
  const freteValue = parseNumber(sep.valorFrete ?? sep.venda?.valorFrete ?? deliveryInfo?.valorFrete ?? 0);

  els.drawerTitle.textContent = `${numero} — ${nomeCliente}`;
  sep.situacao = sep.situacao ?? sep.venda?.situacao;
  configureDrawerAction(sep);

  let html = '';
  html += `
    <div class="dp-hero">
      <div class="dp-avatar">${nomeCliente.slice(0,2).toUpperCase()}</div>
      <div class="dp-hero-info">
        <div class="dp-hero-name">${nomeCliente}</div>
        <div class="dp-hero-sub">Pedido #${numero}</div>
      </div>
      <span class="pill ${cls}">${label}</span>
    </div>`;

  if (itens.length) {
    html += `<div class="dp-section dp-full">
      <div class="dp-section-title">Itens <span class="dp-count">${itens.length}</span></div>
      <div class="dp-items-grid">`;
    itens.forEach((item, i) => {
      const prod = item.produto ?? {};
      const quantidade = parseNumber(item.quantidade ?? item.qty ?? item.qtd ?? item.quantity ?? 1);
      const unitValue = parseNumber(item.valorUnitario ?? item.preco ?? item.valor ?? 0);
      const itemTotal = unitValue * quantidade;
      html += `<div class="dp-item">
        <div class="dp-item-index">${i+1}</div>
        <div class="dp-item-body">
          <div class="dp-item-name">${prod.descricao ?? `Item ${i+1}`}</div>
          <div class="dp-item-tags">
            ${prod.sku ? `<span class="dp-tag"><span class="dp-tag-label">SKU</span>${prod.sku}</span>` : ''}
            ${quantidade ? `<span class="dp-tag"><span class="dp-tag-label">Qtd</span>${quantidade}${item.unidade ? ' '+item.unidade : ''}</span>` : ''}
            ${unitValue ? `<span class="dp-tag"><span class="dp-tag-label">Valor</span>${formatCurrency(unitValue)}</span>` : ''}
            ${itemTotal ? `<span class="dp-tag"><span class="dp-tag-label">Total</span>${formatCurrency(itemTotal)}</span>` : ''}
            ${item.localizacao ? `<span class="dp-tag"><span class="dp-tag-label">Local</span>${item.localizacao}</span>` : ''}
          </div>
          ${item.infoAdicional ? `<div class="dp-item-info">${item.infoAdicional}</div>` : ''}
        </div>
      </div>`;
    });
    html += '</div></div>';
  }

  html += drawerSection('Pedido', [
    { icon: 'calendar', label: 'Data criação', val: formatDate(dataVal) },
    { icon: 'clock', label: 'Tempo de espera', val: fmtElapsed(elapsedMin(dataVal)) },
    { icon: 'box', label: 'Depósito', val: sep.deposito?.nome ?? null },
    { icon: 'truck', label: 'Frete', val: freteValue ? formatCurrency(freteValue) : null },
    { icon: 'money', label: 'Valor total', val: pedidoTotal > 0 ? formatCurrency(pedidoTotal) : null },
  ]);

  if (contato) {
    html += drawerSection('Cliente', [
      { icon: 'user', label: 'Nome', val: nomeCliente },
      { icon: 'phone', label: 'Celular', val: contato.celular ?? contato.telefone },
      { icon: 'mail', label: 'E-mail', val: contato.email },
      { icon: 'id', label: 'CPF/CNPJ', val: contato.cpfCnpj },
    ]);
  }

  if (motoboy || freteValue) {
    html += drawerSection('Entrega', [
      { icon: 'user', label: 'Motoboy', val: motoboy },
      { icon: 'truck', label: 'Frete', val: freteValue ? formatCurrency(freteValue) : null },
      { icon: 'clock', label: 'Saída', val: formatDate(deliveryInfo?.hora_saida) },
    ]);
  }

  if (endereco) {
    const log = [endereco.endereco, endereco.numero, endereco.complemento].filter(Boolean).join(', ');
    html += drawerSection('Endereço', [
      { icon: 'pin', label: 'Logradouro', val: log || null },
      { icon: 'pin', label: 'Bairro', val: endereco.bairro },
      { icon: 'pin', label: 'Cidade / UF', val: [endereco.municipio, endereco.uf].filter(Boolean).join(' — ') || null },
      { icon: 'pin', label: 'CEP', val: endereco.cep },
    ], true);
  }

  els.drawerBody.innerHTML = html;
}

function statusName(situacao) {
  const s = String(situacao ?? '').trim();
  if (s === '8') return 'Dados Incompletos';
  if (s === '0' || s === '1') return 'Pendente';
  if (s === '3') return 'Em Separação';
  if (s === '4') return 'Separada';
  if (s === '7') return 'Pronto Envio';
  if (s === '5') return 'Enviado';
  if (s === '6') return 'Entregue';
  if (s === '2') return 'Cancelada';
  if (s === '9') return 'Não Entregue';
  return `Situação ${s}`;
}

function getSituacaoAction(situacao) {
  const sit = String(situacao ?? '').trim();
  if (sit === '0' || sit === '1') return { label: `Atualizar Status Para ${statusName(3)}`, target: 3 };
  if (sit === '3') return { label: `Atualizar Status Para ${statusName(7)}`, target: 7 };
  if (sit === '4') return { label: `Atualizar Status Para ${statusName(7)}`, target: 7 };
  if (sit === '7') return { label: `Atualizar Status Para ${statusName(5)}`, target: 5 };
  if (sit === '5') return { label: `Atualizar Status Para ${statusName(6)}`, target: 6 };
  return null;
}

async function updateCardStatus(separacaoId, target, button) {
  if (!separacaoId || !target) return;
  button.disabled = true;
  button.textContent = 'Atualizando...';

  try {
    const res = await fetch(`${API_BASE}/separacoes/${separacaoId}/situacao`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ situacao: target }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadSeparacoes();
    button.textContent = 'Atualizado';
    setTimeout(() => { button.textContent = 'Atualizar'; button.disabled = false; }, 1000);
  } catch (error) {
    console.error('[card] falha atualizar situacao', error);
    button.textContent = 'Falha';
    button.disabled = false;
  }
}

function configureDrawerAction(sep) {
  const rowSituacao = sep.venda?.situacao ?? sep.situacao;
  const action = getSituacaoAction(rowSituacao);
  const separacaoId = sep.id ?? sep.__separacaoId;
  const endpoint = sep.__source === 'pedido' ? 'pedidos' : 'separacoes';

  if (!action || !separacaoId) {
    els.drawerAction.classList.add('hidden');
    els.drawerAction.removeEventListener('click', handleDrawerAction);
    return;
  }

  const pedidoId = sep.venda?.id ?? sep.id ?? '';

  els.drawerAction.textContent = action.label;
  els.drawerAction.classList.remove('hidden', 'success');
  els.drawerAction.disabled = false;
  els.drawerAction.dataset.formMode = '';
  els.drawerAction.dataset.targetSituacao = String(action.target);
  els.drawerAction.dataset.separacaoId = String(separacaoId);
  els.drawerAction.dataset.pedidoId = String(pedidoId);
  els.drawerAction.dataset.endpoint = endpoint;
  els.drawerAction.removeEventListener('click', handleDrawerAction);
  els.drawerAction.addEventListener('click', handleDrawerAction);
}

function renderMotoboyForm(sep, target) {
  const pedidoId = sep.venda?.id ?? sep.id ?? '';
  const freteFromPedido = parseNumber(sep.valorFrete ?? sep.venda?.valorFrete ?? sep.transportador?.valorFrete ?? getDeliveryInfo(pedidoId)?.valorFrete ?? 0);
  const hasFrete = freteFromPedido > 0;
  const dtNumero = sep.venda?.numero ?? sep.numeroPedido ?? sep.numero ?? sep.id ?? '—';

  els.drawerTitle.textContent = `Enviar Pedido #${dtNumero}`;
  els.drawerBody.innerHTML = `
    <div class="dp-section dp-full form-panel">
      <div class="dp-section-title">Confirmar envio</div>
      <div class="dp-fields">
        <div class="dp-field form">
          <label class="dp-field-label" for="motoboy-name">Motoboy</label>
          <input id="motoboy-name" class="dp-input" type="text" placeholder="Digite o nome do motoboy" autocomplete="off" />
        </div>
        ${hasFrete ? `
          <div class="dp-field form">
            <label class="dp-field-label">Frete</label>
            <div class="dp-field-val dp-value">${formatCurrency(freteFromPedido)}</div>
          </div>
        ` : `
          <div class="dp-field form">
            <label class="dp-field-label" for="motoboy-frete">Valor do frete</label>
            <input id="motoboy-frete" class="dp-input" type="text" placeholder="R$ 0,00" autocomplete="off" inputmode="decimal" />
          </div>
        `}
        <div id="motoboy-form-error" class="dp-field-error"></div>
      </div>
    </div>`;

  els.drawerAction.textContent = 'Confirmar envio';
  els.drawerAction.classList.remove('hidden', 'success');
  els.drawerAction.disabled = false;
  els.drawerAction.dataset.formMode = 'motoboy';
  els.drawerAction.dataset.targetSituacao = String(target);
  els.drawerAction.dataset.separacaoId = String(sep.id ?? sep.__separacaoId ?? '');
  els.drawerAction.dataset.pedidoId = String(pedidoId);
  els.drawerAction.dataset.endpoint = sep.__source === 'pedido' ? 'pedidos' : 'separacoes';
}

function showMotoboyFormError(message) {
  const errorEl = document.getElementById('motoboy-form-error');
  if (!errorEl) return;
  errorEl.style.display = 'block';
  errorEl.textContent = message;
}

async function submitMotoboyForm(btn) {
  const originalText = btn.textContent;
  const pedidoId = btn.dataset.pedidoId || btn.dataset.separacaoId;
  const endpoint = btn.dataset.endpoint || 'separacoes';
  const target = Number(btn.dataset.targetSituacao);
  const nameInput = document.getElementById('motoboy-name');
  const freteInput = document.getElementById('motoboy-frete');
  if (!nameInput) return;

  const motoboy = String(nameInput.value ?? '').trim();
  if (!motoboy) {
    showMotoboyFormError('Informe o nome do motoboy');
    return;
  }

  let valorFrete = null;
  if (freteInput) {
    valorFrete = parseNumber(freteInput.value);
    if (valorFrete <= 0) {
      showMotoboyFormError('Informe o valor do frete');
      return;
    }
  } else {
    valorFrete = parseNumber(currentDrawerData?.valorFrete ?? currentDrawerData?.venda?.valorFrete ?? currentDrawerData?.transportador?.valorFrete ?? getDeliveryInfo(pedidoId)?.valorFrete ?? 0);
  }

  btn.disabled = true;
  btn.textContent = 'Salvando...';

  await setDeliveryInfo(pedidoId, {
    motoboy,
    status: 'Enviado',
    hora_saida: new Date().toISOString(),
    valorFrete: valorFrete || undefined,
  });

  try {
    const payload = { situacao: target };
    const statusRes = await fetch(`${API_BASE}/${endpoint}/${btn.dataset.separacaoId}/situacao`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);

    if (endpoint === 'pedidos') {
      const pedidoRes = await fetch(`${API_BASE}/pedidos/${btn.dataset.separacaoId}`);
      if (pedidoRes.ok) pedidoData = await pedidoRes.json();
    }

    if (endpoint !== 'pedidos') {
      await loadSeparacoes();
    }

    let updated = null;
    if (endpoint === 'pedidos') {
      const pedidoMatch = pedidosRows.find(item => String(item.id) === String(btn.dataset.separacaoId));
      if (pedidoMatch) {
        pedidoMatch.situacao = target;
        if (pedidoData) Object.assign(pedidoMatch, pedidoData);
        updated = pedidoMatch;
      }

      const separacaoMatches = allRows.filter(item => {
        const vendaId = item.venda?.id;
        const numeroPedido = item.numeroPedido ?? item.numero ?? item.venda?.numero ?? item.venda?.numeroPedido;
        return [vendaId, numeroPedido, item.id, item.idOrigemVinc]
          .some(value => value !== undefined && value !== null && String(value) === String(btn.dataset.separacaoId));
      });
      separacaoMatches.forEach(match => {
        match.situacao = target;
        if (pedidoData) {
          match.venda = { ...match.venda, ...pedidoData, id: match.venda?.id ?? match.venda?.id };
        }
        if (!updated) updated = match;
      });
    } else {
      updated = allRows.find(item => String(item.id) === String(btn.dataset.separacaoId));
      if (updated) updated.situacao = target;
    }

    if (currentPage === 'separacao') {
      applyFilters();
    } else if (currentPage === 'dashboard') {
      renderDashboard();
    }

    if (updated) {
      const currentDrawerPedidoId = els.drawerAction.dataset.pedidoId || btn.dataset.separacaoId;
      const updatedId = String(updated.id ?? updated.venda?.id ?? updated.numeroPedido ?? updated.numero ?? '');
      if (currentDrawerPedidoId && currentDrawerPedidoId === updatedId) {
        renderDrawerContent(updated);
      }
    }

    btn.textContent = 'Transferido';
    btn.classList.add('success');
    btn.disabled = true;
    showPopup('Transferência de status realizada com sucesso.');

    setTimeout(() => {
      btn.classList.remove('success');
    }, 1400);
  } catch (error) {
    console.error('[drawer] falha atualizar situacao', error);
    btn.classList.remove('success');
    btn.textContent = 'Falha ao atualizar';
    btn.disabled = false;
  }
}

async function handleDrawerAction(event) {
  const btn = event.currentTarget;
  if (btn.dataset.formMode === 'motoboy') {
    await submitMotoboyForm(btn);
    return;
  }

  const id = btn.dataset.separacaoId;
  const target = Number(btn.dataset.targetSituacao);
  const endpoint = btn.dataset.endpoint || 'separacoes';
  if (!id || !target) return;

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Atualizando...';

  try {
    if (target === 5) {
      if (currentDrawerData) {
        renderMotoboyForm(currentDrawerData, target);
      }
      btn.disabled = false;
      return;
    }

    const payload = { situacao: target };
    const statusRes = await fetch(`${API_BASE}/${endpoint}/${id}/situacao`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);

    if (endpoint === 'pedidos') {
      const pedidoRes = await fetch(`${API_BASE}/pedidos/${id}`);
      if (pedidoRes.ok) pedidoData = await pedidoRes.json();
    }

    if (endpoint !== 'pedidos') {
      await loadSeparacoes();
    }

    if (endpoint === 'pedidos') {
      const pedidoMatch = pedidosRows.find(item => String(item.id) === String(id));
      if (pedidoMatch) {
        pedidoMatch.situacao = target;
        if (pedidoData) Object.assign(pedidoMatch, pedidoData);
        updated = pedidoMatch;
      }

      const separacaoMatches = allRows.filter(item => {
        const vendaId = item.venda?.id;
        const numeroPedido = item.numeroPedido ?? item.numero ?? item.venda?.numero ?? item.venda?.numeroPedido;
        return [vendaId, numeroPedido, item.id, item.idOrigemVinc]
          .some(value => value !== undefined && value !== null && String(value) === String(id));
      });
      separacaoMatches.forEach(match => {
        match.situacao = target;
        if (pedidoData) {
          match.venda = { ...match.venda, ...pedidoData, id: match.venda?.id ?? match.venda?.id };
        }
        if (!updated) updated = match;
      });
    } else {
      updated = allRows.find(item => String(item.id) === String(id));
      if (updated) updated.situacao = target;
    }

    if (currentPage === 'separacao') {
      applyFilters();
    } else if (currentPage === 'dashboard') {
      renderDashboard();
    }

    if (updated) {
      const currentDrawerPedidoId = els.drawerAction.dataset.pedidoId || btn.dataset.separacaoId;
      const updatedId = String(updated.id ?? updated.venda?.id ?? updated.numeroPedido ?? updated.numero ?? '');
      if (currentDrawerPedidoId && currentDrawerPedidoId === updatedId) {
        renderDrawerContent(updated);
      }
    }

    btn.textContent = 'Transferido';
    btn.classList.add('success');
    btn.disabled = true;
    showPopup('Transferência de status realizada com sucesso.');

    setTimeout(() => {
      btn.classList.remove('success');
    }, 1400);
  } catch (error) {
    console.error('[drawer] falha atualizar situacao', error);
    btn.classList.remove('success');
    els.drawerAction.textContent = 'Falha ao atualizar';
  }
}

// ── drawerSection helper ──────────────────────────────────────────────
function drawerSection(title, fields, fullWidth = false) {
  const visible = fields.filter(f => f.val !== null && f.val !== undefined && f.val !== '');
  if (!visible.length) return '';
  const secCls = fullWidth ? 'dp-section dp-full' : 'dp-section';
  const icons = {
    calendar:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    clock:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    box:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
    user:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    phone:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.35 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.81-.81a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
    mail:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
    id:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3h-8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>`,
    pin:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    note:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  };
  let html = `<div class="${secCls}"><div class="dp-section-title">${title}</div><div class="dp-fields">`;
  visible.forEach(f => {
    html += `<div class="dp-field">
      <div class="dp-field-icon">${icons[f.icon] ?? icons.note}</div>
      <div class="dp-field-body">
        <div class="dp-field-label">${f.label}</div>
        <div class="dp-field-val">${f.val}</div>
      </div>
    </div>`;
  });
  return html + '</div></div>';
}

function closeDrawer() {
  els.drawer.classList.remove('open');
  els.drawerOverlay.classList.add('hidden');
}

els.drawerClose.addEventListener('click', closeDrawer);
els.drawerOverlay.addEventListener('click', e => {
  if (e.target === els.drawerOverlay) closeDrawer();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

// ── Stats ─────────────────────────────────────────────────────────────
function normalizeSituacao(value) {
  const s = String(value ?? '').trim();
  return s === '0' ? '1' : s;
}

function updateStats(items) {
  const sit = i => normalizeSituacao(i?.venda?.situacao ?? i?.situacao ?? '');
  const dataVal = i => i.dataCriacao ?? i.data ?? i.dataPedido ?? i.dataVenda;
  els.statTotal.textContent    = items.length;
  els.statPend.textContent     = items.filter(i => sit(i) === '1').length;
  els.statAnd.textContent      = items.filter(i => sit(i) === '3').length;
  els.statPronto.textContent   = items.filter(i => sit(i) === '7').length;
  els.statEnviado.textContent  = items.filter(i => sit(i) === '5').length;
  els.statEntregue.textContent = items.filter(i => sit(i) === '6').length;
  els.statAtrasado.textContent = items.filter(i => {
    const m = elapsedMin(dataVal(i));
    return m !== null && m >= LIMIT_MIN && ['1', '3'].includes(sit(i));
  }).length;
}

// ── Filters ───────────────────────────────────────────────────────────
function applyFilters() {
  const q = els.search.value.toLowerCase();
  const rows = currentPage === 'separacao' ? allRows : pedidosRows.length ? pedidosRows : allRows;
  const filtered = rows.filter(row => {
    const dataVal = row.dataCriacao ?? row.data ?? row.dataPedido ?? row.dataVenda;
    const rowSituacao = normalizeSituacao(row.venda?.situacao ?? row.situacao);
    if (!isSameDay(dataVal, selectedDay)) return false;
    if (q && !JSON.stringify(row).toLowerCase().includes(q)) return false;
    if (activeStatFilter === 'atrasado') {
      const m = elapsedMin(dataVal);
      const s = normalizeSituacao(row.venda?.situacao ?? row.situacao);
      return m !== null && m >= LIMIT_MIN && ['1', '3'].includes(s);
    }
    if (activeStatFilter !== '') {
      return String(rowSituacao ?? '').trim() === activeStatFilter;
    }
    return true;
  });
  const total = rows.length;
  const comDia = rows.filter(r => isSameDay(r.dataCriacao ?? r.data ?? r.dataPedido ?? r.dataVenda, selectedDay)).length;
  console.log(`rows=${total} comDia=${comDia} filtered=${filtered.length} source=${currentPage==='separacao' && pedidosRows.length ? 'pedidosRows' : 'allRows'} day=${selectedDay.toLocaleDateString('pt-BR')} exemplo=${rows[0]?.dataCriacao ?? rows[0]?.data ?? rows[0]?.dataPedido ?? rows[0]?.dataVenda}`);
  if (!filtered.length) { showState('empty'); return; }
  renderCards(filtered);
  showState('grid');
}

els.search.addEventListener('input', applyFilters);

let activeStatFilter = ''; // '' = todos

// ── Load ──────────────────────────────────────────────────────────────
let pedidosRows = []; // dados de pedidos — usado só no dashboard

async function loadSeparacoes() {
  els.btnRefresh.classList.add('spinning');
  if (currentPage === 'separacao' && !hasLoadedOnce) showState('loading');
  try {
    // ── Separações ────────────────────────────────
    const resSep  = await fetch(`${API_BASE}/separacoes?limit=100`);
    const dataSep = await resSep.json();

    const rawSep = dataSep.resposta ?? dataSep;
    let allSep = Array.isArray(rawSep)
      ? rawSep
      : rawSep?.itens ?? rawSep?.data ?? rawSep?.items ?? [];

    if (!Array.isArray(allSep) && rawSep && typeof rawSep === 'object') {
      allSep = Object.values(rawSep).flatMap(v => Array.isArray(v) ? v : []);
    }

    if (!Array.isArray(allSep)) {
      console.warn('[separacoes] resposta inesperada:', rawSep);
      allSep = [];
    }

    allRows = allSep.filter(Boolean);
    const separacaoByVendaId = new Map();
    allRows.forEach(item => {
      const vendaId = item.venda?.id;
      if (vendaId !== undefined && vendaId !== null) {
        separacaoByVendaId.set(String(vendaId), item);
      }
    });

    console.log('[separacoes] extracted rows=', allRows.length, 'rawSepKeys=', rawSep && typeof rawSep === 'object' ? Object.keys(rawSep) : rawSep);

    // ── Pedidos (dashboard) ──────────────────────
    try {
      const resPed  = await fetch(`${API_BASE}/pedidos?limit=100`);
      const dataPed = await resPed.json();
      const rawPed  = dataPed.resposta ?? dataPed;
      const allPed  = Array.isArray(rawPed) ? rawPed : rawPed?.itens ?? rawPed?.data ?? rawPed?.items ?? [];
      const pedidosById = new Map();
      const enrichedPed = Array.isArray(allPed) ? allPed.map(p => {
        const key = String(p.id ?? p.numeroPedido ?? p.numero ?? '');
        if (key) pedidosById.set(key, p);
        const match = separacaoByVendaId.get(key);
        if (match?.dataCriacao) {
          return { ...p, dataCriacao: match.dataCriacao, separacaoId: match.id };
        }
        return p;
      }) : [];
      allRows = allRows.map(item => {
        const vendaId = String(item.venda?.id ?? item.numeroPedido ?? item.numero ?? '');
        const pedidoMatch = vendaId ? pedidosById.get(vendaId) : null;
        if (pedidoMatch) {
          return { ...item, venda: { ...item.venda, ...pedidoMatch } };
        }
        return item;
      });
      pedidosRows = enrichedPed;
    } catch (e) {
      console.warn('[pedidos] erro:', e);
    }

    await loadMotoboyInfoMap();
    updateStats(allRows);
    applyFilters(); // sempre atualiza, showState só renderiza se página estiver ativa

    if (currentPage === 'dashboard') renderDashboard();

    hasLoadedOnce = true;

  } catch (e) {
    console.error('[separacoes] erro:', e);
    if (currentPage === 'separacao') {
      if (!hasLoadedOnce) {
        els.errorMsg.innerHTML = `Sem conexão com o servidor. <a href="${API_BASE}/login">Fazer login</a>`;
        showState('error');
      } else {
        // já há dados na tela: falha silenciosa, mantém o cache exibido
        showPopup('Não foi possível atualizar agora. Exibindo dados anteriores.');
      }
    }
  } finally {
    els.btnRefresh.classList.remove('spinning');
  }
}

els.btnRefresh.addEventListener('click', loadSeparacoes);

// Auto-refresh a cada 60 segundos
setInterval(loadSeparacoes, 60000);

// ── Navigation ────────────────────────────────────────────────────────
const pages = {
  dashboard: document.getElementById('page-dashboard'),
  separacao: document.getElementById('page-separacao'),
};
const pageTitles = { dashboard: 'Dashboard', separacao: 'Pedidos' };
const pageTitle  = document.getElementById('page-title');
let currentPage  = 'dashboard';

function navigateTo(page) {
  currentPage = page;
  Object.entries(pages).forEach(([k, el]) => el.classList.toggle('active', k === page));
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  pageTitle.textContent = pageTitles[page] ?? page;
  document.getElementById('day-filter-wrap').style.display = '';
  document.getElementById('search-input').closest('.search-wrap').style.display = page === 'separacao' ? '' : 'none';
  if (page === 'dashboard') renderDashboard();
  if (page === 'separacao') applyFilters();
}

document.querySelectorAll('.nav-item').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); navigateTo(a.dataset.page); });
});

// ── Stat filter buttons ───────────────────────────────────────────────
document.querySelectorAll('.stat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.stat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeStatFilter = btn.dataset.sit;
    applyFilters();
  });
});

// ── Dashboard ─────────────────────────────────────────────────────────
let chartFreteMotoboy = null;
let dashMotoboy = ''; // '' = todos
let rankingReqId = 0;

function fmtDayISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function renderRankingProdutos(top10) {
  const rankingEl = document.getElementById('ranking-produtos');
  if (!rankingEl) return;
  if (!top10.length) {
    rankingEl.innerHTML = `<div class="ranking-empty">Nenhum produto vendido no período.</div>`;
    return;
  }
  const maxQty = top10[0][1];
  rankingEl.innerHTML = top10.map(([name, qty], i) => `
    <div class="ranking-row">
      <div class="ranking-rank rank-${i < 3 ? i+1 : 'n'}">${i+1}</div>
      <div class="ranking-info">
        <div class="ranking-name" title="${name}">${name}</div>
        <div class="ranking-bar-bg"><div class="ranking-bar-fill" style="width:${(qty/maxQty*100).toFixed(1)}%"></div></div>
      </div>
      <div class="ranking-qty">${qty}</div>
    </div>`).join('');
}

async function loadProdutosRanking(dateStr) {
  const reqId = ++rankingReqId;
  const rankingEl = document.getElementById('ranking-produtos');
  if (rankingEl) rankingEl.innerHTML = `<div class="ranking-empty">Carregando…</div>`;
  try {
    const res  = await fetch(`${API_BASE}/separacoes/produtos-do-dia?data=${dateStr}`);
    const data = await res.json();
    if (reqId !== rankingReqId) return; // dia trocado enquanto buscava, descarta resposta antiga
    const top10 = (data.produtos ?? []).map(p => [p.descricao, p.quantidade]);
    renderRankingProdutos(top10);
  } catch (e) {
    console.warn('[produtos-do-dia] erro:', e);
    if (reqId === rankingReqId && rankingEl) {
      rankingEl.innerHTML = `<div class="ranking-empty">Não foi possível carregar os produtos.</div>`;
    }
  }
}

function renderDashboard() {
  const pedidos    = pedidosRows;
  const separacoes = allRows;

  const rangedPedidos = pedidos.filter(p => isSameDay(p.dataCriacao ?? p.data ?? p.dataPedido ?? p.dataVenda, selectedDay));
  const rangedSep     = separacoes.filter(s => isSameDay(s.dataCriacao ?? s.data ?? s.dataPedido ?? s.dataVenda ?? s.data_pedido, selectedDay));

  // ── Populate motoboy filter ──────────────────
  const motoboyNames = new Set(Object.values(motoboyInfoMap).map(m => m.motoboy).filter(Boolean));
  const select = document.getElementById('dash-motoboy-filter');
  if (select) {
    const prev = select.value;
    select.innerHTML = '<option value="">Todos</option>' +
      [...motoboyNames].sort().map(n => `<option value="${n}"${n===prev?' selected':''}>${n}</option>`).join('');
    dashMotoboy = select.value;
  }

  // ── Motoboy-filtered sets ─────────────────────
  const filteredSep = dashMotoboy
    ? rangedSep.filter(s => motoboyInfoMap[String(s.venda?.id ?? s.id ?? '')]?.motoboy === dashMotoboy)
    : rangedSep;
  const filteredPed = dashMotoboy
    ? rangedPedidos.filter(p => motoboyInfoMap[String(p.id ?? p.numeroPedido ?? p.numero ?? '')]?.motoboy === dashMotoboy)
    : rangedPedidos;

  // ── KPIs ────────────────────────────────────
  const total      = filteredPed.length;
  const valorTotal = filteredPed.reduce((a, p) => a + parseNumber(p.valor ?? p.valorTotalPedido ?? p.valorTotal ?? 0), 0);
  const ticketMed  = total > 0 ? valorTotal / total : 0;
  const sit        = s => normalizeSituacao(s.venda?.situacao ?? s.situacao);
  const abertos    = filteredSep.filter(s => sit(s) === '1').length;
  const andamento  = filteredSep.filter(s => sit(s) === '3').length;
  const atendidos  = filteredSep.filter(s => ['4','5','6','7'].includes(sit(s))).length;
  const atrasados  = filteredSep.filter(s => {
    const m = elapsedMin(s.dataCriacao ?? s.data ?? s.dataPedido ?? s.dataVenda);
    return m !== null && m >= LIMIT_MIN && ['1','3'].includes(sit(s));
  }).length;

  // frete total do dia (motoboys cujo pedido está no conjunto filtrado)
  const totalFrete = Object.entries(motoboyInfoMap).reduce((acc, [pid, info]) => {
    const inPeriod = filteredSep.some(s => String(s.venda?.id ?? s.id ?? '') === pid)
                  || filteredPed.some(p => String(p.id ?? p.numeroPedido ?? p.numero ?? '') === pid);
    return inPeriod ? acc + parseNumber(info.valorFrete ?? 0) : acc;
  }, 0);

  document.getElementById('kpi-total').textContent  = total;
  document.getElementById('kpi-pend').textContent   = abertos;
  document.getElementById('kpi-sep').textContent    = andamento;
  document.getElementById('kpi-separ').textContent  = atendidos;
  document.getElementById('kpi-atraso').textContent = atrasados;
  document.getElementById('kpi-emb').textContent    = formatCurrency(valorTotal);
  document.getElementById('kpi-ticket').textContent = formatCurrency(ticketMed);
  document.getElementById('kpi-frete').textContent  = formatCurrency(totalFrete);

  // ── Top 10 produtos (soma por descrição) ─────
  // a listagem não traz itens; busca agregação real no backend (detalhe de cada separação do dia)
  loadProdutosRanking(fmtDayISO(selectedDay));

  // ── Frete por motoboy ─────────────────────────
  const fretePorMotoboy = {};
  Object.entries(motoboyInfoMap).forEach(([pid, info]) => {
    if (!info.motoboy) return;
    const inPeriod = filteredSep.some(s => String(s.venda?.id ?? s.id ?? '') === pid)
                  || filteredPed.some(p => String(p.id ?? p.numeroPedido ?? p.numero ?? '') === pid);
    if (!inPeriod) return;
    fretePorMotoboy[info.motoboy] = (fretePorMotoboy[info.motoboy] || 0) + parseNumber(info.valorFrete ?? 0);
  });

  const mbNames  = Object.keys(fretePorMotoboy);
  const mbFretes = mbNames.map(n => fretePorMotoboy[n]);
  const mbColors = ['#2e9fd8','#7c3aed','#f59e0b','#22c55e','#ef4444','#0f766e','#b45309','#1a7aaa'];

  if (chartFreteMotoboy) chartFreteMotoboy.destroy();
  const canvas = document.getElementById('chart-frete-motoboy');
  chartFreteMotoboy = mbNames.length > 0
    ? new Chart(canvas, {
        type: 'bar',
        data: { labels: mbNames, datasets: [{ label: 'Frete (R$)', data: mbFretes, backgroundColor: mbNames.map((_,i) => mbColors[i % mbColors.length]), borderRadius: 10, borderSkipped: false, maxBarThickness: 56 }] },
        options: {
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw) } } },
          scales:  { y: { beginAtZero: true, ticks: { callback: v => `R$${Number(v).toFixed(0)}` } } },
          responsive: true, maintainAspectRatio: false,
        },
      })
    : null;
  if (!mbNames.length && canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// ── Init ──────────────────────────────────────────────────────────────
setSelectedDay(new Date(today));
navigateTo('dashboard');
loadSeparacoes();

// ── Dashboard motoboy filter listener ─────────────────────────────────
document.getElementById('dash-motoboy-filter')?.addEventListener('change', e => {
  dashMotoboy = e.target.value;
  renderDashboard();
});

