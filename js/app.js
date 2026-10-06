/**
 * app.js — Interfaz de la calculadora.
 *
 * Lee los formularios, llama a la lógica de js/ipv4.js (objeto global IPv4)
 * y pinta los resultados. Aquí no se hace ningún cálculo de red: solo DOM,
 * formato de los datos, portapapeles, exportación y estado en la URL.
 */
(() => {
  'use strict';

  const { toDotted } = IPv4;

  const TABS = ['subred', 'vlsm', 'dividir'];
  const MAX_RENDER_ROWS = 1024; // filas que se pintan en la tabla de Dividir
  const MAX_CSV_ROWS = 65536; // filas que se exportan a CSV en Dividir
  const MAX_VLSM_ROWS = 100; // subredes que se aceptan al restaurar un enlace
  const PALETTE_SIZE = 8; // colores definidos en CSS: [data-color="0"] … [data-color="7"]

  const PRESETS = {
    oficina: {
      label: 'Oficina pequeña',
      base: '192.168.10.0/24',
      subnets: [['Ventas', 50], ['Administración', 25], ['IT', 10], ['Enlace WAN', 2]],
    },
    examen: {
      label: 'Ejercicio de examen',
      base: '192.168.1.0/24',
      subnets: [['LAN A', 100], ['LAN B', 50], ['LAN C', 20], ['LAN D', 10], ['WAN 1', 2], ['WAN 2', 2]],
    },
    campus: {
      label: 'Campus /22',
      base: '172.16.0.0/22',
      subnets: [
        ['Aulas', 300], ['Wi-Fi invitados', 200], ['Profesorado', 120], ['Servidores', 20],
        ['Gestión', 10], ['Enlace router 1', 2], ['Enlace router 2', 2],
      ],
    },
  };

  const ICONS = {
    remove: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    download: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>',
    copy: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  };

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  const formatNumber = (n) => n.toLocaleString('es-ES');
  const cidr = (network, prefix) => `${toDotted(network)}/${prefix}`;
  const percent = (part, total) =>
    `${(part / total * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;

  /** Escapa texto del usuario antes de meterlo en innerHTML (evita inyectar HTML). */
  function escapeHtml(text) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replace(/[&<>"']/g, (char) => entities[char]);
  }

  /** Botón que muestra `text` y copia `copyValue` al pulsarlo. */
  function copyable(text, copyValue = text) {
    return `<button type="button" class="copy" data-copy="${escapeHtml(copyValue)}"
      aria-describedby="copy-hint">${escapeHtml(text)}</button>`;
  }

  function setFieldError(input, output, message) {
    output.textContent = message;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }

  /** Atenúa los resultados anteriores mientras la entrada no es válida. */
  function markStale(container, emptyMessage) {
    if (container.children.length === 0) {
      container.innerHTML = `<p class="empty">${emptyMessage}</p>`;
    }
    container.classList.add('is-stale');
  }

  // Lee en voz alta (lectores de pantalla) avisos breves como "Copiado"
  const announcer = $('#announcer');
  function announce(message) {
    announcer.textContent = '';
    setTimeout(() => {
      announcer.textContent = message;
    }, 50);
  }

  // ---------------------------------------------------------------------------
  // Portapapeles, descargas y tablas exportables
  // ---------------------------------------------------------------------------

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Sin Clipboard API (navegador antiguo, permiso denegado…): método clásico
      return legacyCopy(text);
    }
  }

  function legacyCopy(text) {
    const previousFocus = document.activeElement;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    previousFocus?.focus();
    return ok;
  }

  /** Muestra un globo breve ("Copiado") sobre el botón y lo anuncia. */
  function showFeedback(button, message) {
    button.dataset.feedback = message;
    announce(message);
    setTimeout(() => delete button.dataset.feedback, 1400);
  }

  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Filas → CSV. Se usa ";" porque es el separador que espera Excel con
   * configuración regional española, y el BOM inicial (﻿) para que
   * Excel reconozca UTF-8 y muestre bien las tildes.
   */
  function toCsv(rows) {
    const cell = (value) => {
      let text = String(value);
      // Un nombre que empiece por = + - @ se interpretaría como fórmula en Excel
      if (/^[=+\-@]/.test(text)) text = `'${text}`;
      return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return '﻿' + rows.map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n';
  }

  function toMarkdown(rows) {
    const line = (cells) => `| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`;
    const [header, ...body] = rows;
    return [line(header), line(header.map(() => '---')), ...body.map(line)].join('\n');
  }

  // Cualquier elemento con data-copy copia su valor al pulsarlo (delegación de eventos)
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const ok = await copyText(button.dataset.copy);
    showFeedback(button, ok ? 'Copiado' : 'No se pudo copiar');
  });

  // ---------------------------------------------------------------------------
  // Pestañas (patrón WAI-ARIA: tablist / tab / tabpanel)
  // ---------------------------------------------------------------------------

  const tablist = $('[role="tablist"]');
  let currentTab = 'subred';

  function selectTab(name, { focus = false } = {}) {
    currentTab = name;
    for (const tab of $$('[role="tab"]', tablist)) {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1; // solo la pestaña activa entra en el orden de tabulación
      if (selected && focus) tab.focus();
    }
    for (const panel of $$('[role="tabpanel"]')) {
      panel.hidden = panel.id !== `panel-${name}`;
    }
  }

  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab) return;
    selectTab(tab.dataset.tab);
    scheduleHashUpdate();
  });

  // Flechas, Inicio y Fin mueven entre pestañas
  tablist.addEventListener('keydown', (event) => {
    const index = TABS.indexOf(currentTab);
    const targets = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 };
    if (!(event.key in targets)) return;
    event.preventDefault();
    const next = (targets[event.key] + TABS.length) % TABS.length;
    selectTab(TABS[next], { focus: true });
    scheduleHashUpdate();
  });

  // ---------------------------------------------------------------------------
  // Pestaña 1: Subred
  // ---------------------------------------------------------------------------

  const subnetIp = $('#subnet-ip');
  const subnetMask = $('#subnet-mask');
  const subnetError = $('#subnet-error');
  const subnetResults = $('#subnet-results');

  // Desplegable con las 33 máscaras posibles: /0 … /32
  subnetMask.innerHTML = Array.from({ length: 33 }, (_, prefix) =>
    `<option value="${prefix}">/${prefix} — ${toDotted(IPv4.prefixToMask(prefix))}</option>`
  ).join('');

  const CLASS_HINTS = {
    A: 'Primer octeto <span class="nowrap">0–127</span>',
    B: 'Primer octeto <span class="nowrap">128–191</span>',
    C: 'Primer octeto <span class="nowrap">192–223</span>',
    D: 'Primer octeto <span class="nowrap">224–239</span>',
    E: 'Primer octeto <span class="nowrap">240–255</span>',
  };

  // Color de la etiqueta de tipo; el resto de tipos usa el tono dorado
  const TYPE_TONES = {
    public: 'ok',
    private: 'accent',
    multicast: 'alert',
    reserved: 'alert',
    broadcast: 'alert',
    'this-network': 'alert',
  };

  function updateSubnet() {
    let parsed;
    try {
      parsed = IPv4.parseAddress(subnetIp.value);
    } catch (error) {
      setFieldError(subnetIp, subnetError, error.message);
      markStale(subnetResults, 'Escribe una dirección IPv4 para ver los resultados.');
      return;
    }
    setFieldError(subnetIp, subnetError, '');

    // Si la IP trae su propia máscara (/24 o 255.255.255.0), manda sobre el desplegable
    if (parsed.prefix !== null) {
      subnetMask.value = String(parsed.prefix);
    }
    const prefix = parsed.prefix ?? Number(subnetMask.value);
    subnetResults.classList.remove('is-stale');
    subnetResults.innerHTML = subnetHtml(IPv4.subnetInfo(parsed.ip, prefix));
  }

  function subnetHtml(info) {
    const { prefix, type } = info;
    const hostBits = 32 - prefix;
    const noBroadcast = info.broadcast === null;

    let hostsHint = `2<sup>${hostBits}</sup> − 2 (red y broadcast)`;
    if (prefix === 31) hostsHint = 'RFC 3021: sin red ni broadcast';
    if (prefix === 32) hostsHint = 'Un único host';

    const stats = [
      { label: 'Dirección de red', value: toDotted(info.network) },
      {
        label: 'Broadcast',
        value: noBroadcast ? null : toDotted(info.broadcast),
        hint: noBroadcast ? `No existe en una /${prefix}` : '',
      },
      { label: 'Primer host', value: toDotted(info.firstHost) },
      { label: 'Último host', value: toDotted(info.lastHost) },
      { label: 'Hosts utilizables', value: formatNumber(info.usableHosts), copy: String(info.usableHosts), hint: hostsHint },
      { label: 'Direcciones totales', value: formatNumber(info.totalAddresses), copy: String(info.totalAddresses), hint: `2<sup>${hostBits}</sup>` },
      { label: 'Máscara', value: toDotted(info.mask) },
      { label: 'Prefijo CIDR', value: `/${prefix}`, hint: `${prefix} bits de red · ${hostBits} de host` },
      { label: 'Wildcard', value: toDotted(info.wildcard), hint: 'Máscara invertida (ACL, OSPF)' },
      { label: 'Clase', value: info.ipClass, hint: CLASS_HINTS[info.ipClass] },
      { label: 'Hexadecimal', value: IPv4.toHex(info.ip) },
      { label: 'Entero de 32 bits', value: String(info.ip) },
    ];

    const statsHtml = stats.map(({ label, value, copy, hint }) => `
      <div class="stat">
        <dt class="stat__label">${label}</dt>
        <dd class="stat__value">${value === null ? '<span class="muted">—</span>' : copyable(value, copy)}</dd>
        ${hint ? `<dd class="stat__hint">${hint}</dd>` : ''}
      </div>`).join('');

    const tone = TYPE_TONES[type.id] || 'warm';
    const network = toDotted(info.network);

    return `
      <div class="card result-card">
        <div class="summary">
          <div>
            <p class="summary__label">Red</p>
            <p class="summary__cidr">
              <button type="button" class="copy" data-copy="${network}/${prefix}" aria-describedby="copy-hint">${network}<span class="summary__prefix">/${prefix}</span></button>
            </p>
          </div>
          <div class="summary__badges">
            <span class="badge badge--${tone}"><span class="badge__dot" aria-hidden="true"></span>${type.label}${type.rfc ? ` · ${type.rfc}` : ''}</span>
            <span class="badge">Clase ${info.ipClass}</span>
          </div>
          <p class="summary__desc">${type.description}</p>
        </div>
        <dl class="stats">${statsHtml}</dl>
        <p class="copy-tip">Pulsa cualquier valor para copiarlo.</p>
      </div>
      ${subnetNote(info)}
      ${binaryHtml(info)}`;
  }

  /** Notas para casos especiales: /31, /32, o una IP que es la red o el broadcast. */
  function subnetNote(info) {
    const { prefix, ip } = info;
    let text = '';
    if (prefix === 31) {
      text = '<strong>/31: enlace punto a punto (RFC 3021).</strong> Solo hay 2 direcciones y las dos se asignan a las interfaces del enlace; no hay dirección de red ni de broadcast. Ahorra la mitad de direcciones respecto a una /30.';
    } else if (prefix === 32) {
      text = '<strong>/32: un único host.</strong> La red es la propia dirección. Se usa en rutas de host, interfaces loopback de routers y reglas de firewall.';
    } else if (ip === info.network) {
      text = '<strong>Has escrito la dirección de red.</strong> Identifica a la subred y no se puede asignar a un equipo.';
    } else if (ip === info.broadcast) {
      text = '<strong>Has escrito la dirección de broadcast.</strong> Llega a todos los equipos de la subred y no se puede asignar a uno solo.';
    }
    return text ? `<p class="note">${text}</p>` : '';
  }

  /** 32 bits separados por octetos; los bits de red en color de acento. */
  function bitsHtml(value, prefix) {
    const binary = IPv4.toBinary(value); // "11000000.10101000.00000001.00001010"
    // Posición del corte en el texto: cada octeto completo añade un punto
    const cut = prefix + Math.floor(prefix / 8);
    const withDots = (text) => text.replace(/\./g, '<span class="bits__dot">.</span>');
    const cutClass = prefix > 0 && prefix < 32 ? ' bits__host--cut' : '';
    return `<span class="bits__net">${withDots(binary.slice(0, cut))}</span><span class="bits__host${cutClass}">${withDots(binary.slice(cut))}</span>`;
  }

  function binaryHtml(info) {
    const rows = [
      ['Dirección IP', '', info.ip],
      ['Máscara', '', info.mask],
      ['Red', 'IP AND máscara', info.network],
    ];
    if (info.broadcast !== null) {
      rows.push(['Broadcast', 'Red OR wildcard', info.broadcast]);
    }
    const rowsHtml = rows.map(([label, detail, value]) => `
      <div class="binary__row">
        <dt class="binary__label">${label}${detail ? `<small>${detail}</small>` : ''}</dt>
        <dd class="bits">${bitsHtml(value, info.prefix)}</dd>
        <dd class="binary__dec">${toDotted(value)}</dd>
      </div>`).join('');

    return `
      <section class="card binary-card" aria-labelledby="binary-title">
        <div class="card__head">
          <h3 class="card__title" id="binary-title">Vista binaria</h3>
          <ul class="legend">
            <li><span class="legend__swatch legend__swatch--net" aria-hidden="true"></span>Red · ${info.prefix} bits</li>
            <li><span class="legend__swatch legend__swatch--host" aria-hidden="true"></span>Host · ${32 - info.prefix} bits</li>
          </ul>
        </div>
        <dl class="binary">${rowsHtml}</dl>
      </section>`;
  }

  subnetIp.addEventListener('input', () => {
    updateSubnet();
    scheduleHashUpdate();
  });

  subnetMask.addEventListener('change', () => {
    // Si el campo de la IP lleva máscara escrita, se sustituye por la elegida
    const text = subnetIp.value.trim();
    if (/[\s/]/.test(text)) {
      subnetIp.value = `${text.split(/[\s/]/)[0]}/${subnetMask.value}`;
    }
    updateSubnet();
    scheduleHashUpdate();
  });

  // ---------------------------------------------------------------------------
  // Pestaña 2: VLSM
  // ---------------------------------------------------------------------------

  const vlsmBase = $('#vlsm-base');
  const vlsmBaseError = $('#vlsm-base-error');
  const vlsmRows = $('#vlsm-rows');
  const vlsmResults = $('#vlsm-results');
  let currentPlan = null; // último plan válido, para exportarlo
  let rowCounter = 0; // para generar ids únicos

  function addRow(name = '', hosts = '') {
    rowCounter++;
    const row = document.createElement('li');
    row.className = 'vrow';
    row.innerHTML = `
      <input class="input vrow__name" type="text" maxlength="40" autocomplete="off">
      <input class="input mono vrow__hosts" type="text" inputmode="numeric" autocomplete="off"
             aria-describedby="vrow-error-${rowCounter}">
      <button class="icon-btn vrow__remove" type="button">${ICONS.remove}</button>
      <p class="field__error vrow__error" id="vrow-error-${rowCounter}" aria-live="polite"></p>`;
    // Los valores se asignan como propiedad y no dentro del HTML: así un nombre
    // con "<" o comillas nunca se interpreta como código.
    $('.vrow__name', row).value = name;
    $('.vrow__hosts', row).value = String(hosts);
    vlsmRows.append(row);
    return row;
  }

  /** Etiquetas accesibles numeradas ("Hosts de la subred 3"), tras añadir o quitar filas. */
  function renumberRows() {
    $$('.vrow', vlsmRows).forEach((row, i) => {
      const n = i + 1;
      const name = $('.vrow__name', row);
      name.placeholder = `Subred ${n}`;
      name.setAttribute('aria-label', `Nombre de la subred ${n}`);
      $('.vrow__hosts', row).setAttribute('aria-label', `Hosts necesarios en la subred ${n}`);
      $('.vrow__remove', row).setAttribute('aria-label', `Eliminar subred ${n}`);
    });
  }

  function setRows(list) {
    vlsmRows.replaceChildren();
    list.forEach(([name, hosts]) => addRow(name, hosts));
    renumberRows();
  }

  function loadPreset(id) {
    const preset = PRESETS[id];
    vlsmBase.value = preset.base;
    setRows(preset.subnets);
  }

  /**
   * Lee la lista de subredes. Las filas con los hosts vacíos se ignoran
   * (por ejemplo, una recién añadida); las que tienen un valor no válido
   * muestran el error en su propia fila.
   */
  function readVlsmRows() {
    let valid = true;
    let skipped = 0;
    const requests = [];
    $$('.vrow', vlsmRows).forEach((row, i) => {
      const hostsInput = $('.vrow__hosts', row);
      const hostsText = hostsInput.value.trim();
      let message = '';
      if (hostsText === '') {
        skipped++;
      } else if (!/^\d+$/.test(hostsText) || Number(hostsText) < 1) {
        message = 'Escribe un número entero de hosts mayor que 0.';
        valid = false;
      } else {
        const name = $('.vrow__name', row).value.trim() || `Subred ${i + 1}`;
        requests.push({ name, hosts: Number(hostsText) });
      }
      setFieldError(hostsInput, $('.vrow__error', row), message);
    });
    return { valid, requests, skipped };
  }

  function updateVlsm() {
    currentPlan = null;
    let base = null;
    try {
      base = IPv4.parseCidr(vlsmBase.value);
      setFieldError(vlsmBase, vlsmBaseError, '');
    } catch (error) {
      setFieldError(vlsmBase, vlsmBaseError, error.message);
    }
    const { valid, requests, skipped } = readVlsmRows();
    if (!base || !valid) {
      markStale(vlsmResults, 'Corrige los datos marcados para ver el plan.');
      return;
    }
    vlsmResults.classList.remove('is-stale');

    if (requests.length === 0) {
      vlsmResults.innerHTML = '<p class="empty">Añade al menos una subred con su número de hosts para calcular el plan.</p>';
      return;
    }

    let plan;
    try {
      plan = IPv4.allocateVlsm(base.ip, base.prefix, requests);
    } catch (error) {
      vlsmResults.innerHTML = `<div class="alert" role="alert"><p>${escapeHtml(error.message)}</p></div>`;
      return;
    }

    if (plan.fits) {
      currentPlan = plan;
      vlsmResults.innerHTML = planHtml(plan, base, skipped);
    } else {
      vlsmResults.innerHTML = noFitHtml(plan);
    }
  }

  function planHtml(plan, base, skipped) {
    const subnets = plan.subnets;
    const totalHosts = subnets.reduce((sum, s) => sum + s.hosts, 0);
    const totalUnused = subnets.reduce((sum, s) => sum + s.unused, 0);
    const firstFree = plan.network + plan.used;
    const lastAddress = plan.network + plan.size - 1;
    const width = (size) => `${(size / plan.size) * 100}%`;

    const notes = [];
    if (base.ip !== plan.network) {
      notes.push(`Se usa la dirección de red <code>${cidr(plan.network, plan.prefix)}</code>.`);
    }
    if (skipped > 0) {
      notes.push(skipped === 1 ? 'Una fila sin hosts no se ha incluido.' : `${skipped} filas sin hosts no se han incluido.`);
    }

    const segments = subnets.map((s, i) => `
      <div class="spacebar__seg" data-color="${i % PALETTE_SIZE}" style="flex-basis: ${width(s.blockSize)}"
           title="${escapeHtml(s.name)} · ${cidr(s.network, s.prefix)} · ${formatNumber(s.blockSize)} direcciones">
        <span>${escapeHtml(s.name)}</span>
      </div>`).join('');
    const freeSegment = plan.free > 0 ? `
      <div class="spacebar__seg spacebar__seg--free" style="flex-basis: ${width(plan.free)}"
           title="Libre · ${formatNumber(plan.free)} direcciones"><span>Libre</span></div>` : '';

    const rows = subnets.map((s, i) => `
      <tr>
        <th scope="row"><span class="swatch" data-color="${i % PALETTE_SIZE}" aria-hidden="true"></span>${escapeHtml(s.name)}</th>
        <td class="num">${formatNumber(s.hosts)}</td>
        <td class="num">${formatNumber(s.blockSize)}</td>
        <td class="mono">/${s.prefix}</td>
        <td class="mono">${copyable(toDotted(s.network))}</td>
        <td class="mono">${copyable(toDotted(s.mask))}</td>
        <td class="mono range">${copyable(toDotted(s.firstHost))}<span class="range__sep">–</span>${copyable(toDotted(s.lastHost))}</td>
        <td class="mono">${s.broadcast === null ? '—' : copyable(toDotted(s.broadcast))}</td>
        <td class="num">${formatNumber(s.unused)}</td>
      </tr>`).join('');

    const usage = `${subnets.length} ${subnets.length === 1 ? 'subred' : 'subredes'}: ${formatNumber(plan.used)} de ${formatNumber(plan.size)} direcciones asignadas (${percent(plan.used, plan.size)})`;

    return `
      <div class="card__head">
        <div>
          <h3 class="card__title">Plan de direccionamiento</h3>
          <p class="card__sub">Ordenado de más a menos hosts. Pulsa una dirección para copiarla.</p>
        </div>
        <div class="actions">
          <button class="btn" type="button" data-action="vlsm-csv">${ICONS.download}Exportar CSV</button>
          <button class="btn" type="button" data-action="vlsm-markdown">${ICONS.copy}Copiar como Markdown</button>
        </div>
      </div>

      <div class="metrics">
        <div class="metric">
          <span class="metric__label">Red base</span>
          <span class="metric__value">${copyable(cidr(plan.network, plan.prefix))}</span>
        </div>
        <div class="metric">
          <span class="metric__label">Asignadas</span>
          <span class="metric__value">${formatNumber(plan.used)} <small>de ${formatNumber(plan.size)} · ${percent(plan.used, plan.size)}</small></span>
        </div>
        <div class="metric">
          <span class="metric__label">Libres al final</span>
          <span class="metric__value">${formatNumber(plan.free)} ${plan.free > 0 ? `<small>desde ${toDotted(firstFree)}</small>` : ''}</span>
        </div>
        <div class="metric">
          <span class="metric__label">Hosts sin usar</span>
          <span class="metric__value">${formatNumber(totalUnused)} <small>dentro de los bloques</small></span>
        </div>
      </div>

      ${notes.length ? `<p class="note">${notes.join(' ')}</p>` : ''}

      <figure class="spacebar">
        <figcaption class="spacebar__title">Espacio de direcciones</figcaption>
        <div class="spacebar__track" role="img" aria-label="${escapeHtml(usage)}">${segments}${freeSegment}</div>
        <div class="spacebar__scale"><span>${toDotted(plan.network)}</span><span>${toDotted(lastAddress)}</span></div>
      </figure>

      <div class="table-wrap" tabindex="0" role="region" aria-label="Tabla del plan VLSM">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Subred</th>
              <th scope="col" class="num">Hosts</th>
              <th scope="col" class="num">Bloque</th>
              <th scope="col">CIDR</th>
              <th scope="col">Dirección de red</th>
              <th scope="col">Máscara</th>
              <th scope="col">Rango de hosts</th>
              <th scope="col">Broadcast</th>
              <th scope="col" class="num">Sin usar</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td class="num">${formatNumber(totalHosts)}</td>
              <td class="num">${formatNumber(plan.used)}</td>
              <td colspan="5"></td>
              <td class="num">${formatNumber(totalUnused)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  function noFitHtml(plan) {
    const base = cidr(plan.network, plan.prefix);
    let suggestion = 'Ni siquiera todo el espacio IPv4 (/0) es suficiente.';
    let button = '';
    if (plan.suggestedPrefix !== null) {
      const suggested = cidr(plan.suggestedNetwork, plan.suggestedPrefix);
      suggestion = `Necesitarías al menos una <strong>/${plan.suggestedPrefix}</strong>
        (${formatNumber(2 ** (32 - plan.suggestedPrefix))} direcciones), por ejemplo <code>${suggested}</code>.`;
      button = `<button class="btn" type="button" data-action="vlsm-use" data-value="${suggested}">Usar ${suggested}</button>`;
    }
    const blocks = plan.blocks.map((b) => `
      <li><span>${escapeHtml(b.name)}</span>
        <span class="mono">${formatNumber(b.hosts)} hosts · /${b.prefix} · ${formatNumber(b.size)} direcciones</span></li>`).join('');

    return `
      <div class="alert" role="alert">
        <h3 class="alert__title">El plan no cabe en ${base}</h3>
        <p>Los bloques necesarios suman <strong>${formatNumber(plan.needed)}</strong> direcciones y la red base
          tiene <strong>${formatNumber(plan.size)}</strong>. ${suggestion}</p>
        ${button}
      </div>
      <h4 class="list-title">Bloques necesarios</h4>
      <ul class="block-list">${blocks}</ul>`;
  }

  /** Tabla completa del plan, para el CSV. */
  function vlsmCsvRows(plan) {
    const header = ['Subred', 'Hosts pedidos', 'Hosts utilizables', 'Bloque', 'CIDR', 'Dirección de red',
      'Máscara', 'Primer host', 'Último host', 'Broadcast', 'Hosts sin usar'];
    const rows = plan.subnets.map((s) => [
      s.name, s.hosts, s.usableHosts, s.blockSize, cidr(s.network, s.prefix), toDotted(s.network),
      toDotted(s.mask), toDotted(s.firstHost), toDotted(s.lastHost),
      s.broadcast === null ? '' : toDotted(s.broadcast), s.unused,
    ]);
    return [header, ...rows];
  }

  /** Versión reducida para Markdown (documentación, apuntes, issues). */
  function vlsmMarkdownRows(plan) {
    const header = ['Subred', 'Hosts', 'Red', 'Máscara', 'Rango de hosts', 'Broadcast', 'Sin usar'];
    const rows = plan.subnets.map((s) => [
      s.name, s.hosts, cidr(s.network, s.prefix), toDotted(s.mask),
      `${toDotted(s.firstHost)} – ${toDotted(s.lastHost)}`,
      s.broadcast === null ? '—' : toDotted(s.broadcast), s.unused,
    ]);
    return [header, ...rows];
  }

  function onVlsmChange() {
    updateVlsm();
    scheduleHashUpdate();
  }

  vlsmBase.addEventListener('input', onVlsmChange);
  vlsmRows.addEventListener('input', onVlsmChange); // cualquier campo de la lista

  vlsmRows.addEventListener('click', (event) => {
    const button = event.target.closest('.vrow__remove');
    if (!button) return;
    const row = button.closest('.vrow');
    const neighbour = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    renumberRows();
    // Deja el foco en un sitio lógico para no perder la posición con el teclado
    (neighbour ? $('.vrow__remove', neighbour) : $('#vlsm-add')).focus();
    onVlsmChange();
  });

  $('#vlsm-add').addEventListener('click', () => {
    const row = addRow();
    renumberRows();
    $('.vrow__name', row).focus();
    onVlsmChange();
  });

  $$('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      loadPreset(button.dataset.preset);
      onVlsmChange();
      announce(`Ejemplo cargado: ${PRESETS[button.dataset.preset].label}`);
    });
  });

  vlsmResults.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;

    if (action === 'vlsm-use') {
      vlsmBase.value = button.dataset.value;
      onVlsmChange();
      vlsmBase.focus();
      return;
    }
    if (!currentPlan) return;

    if (action === 'vlsm-csv') {
      const name = `vlsm-${toDotted(currentPlan.network)}-${currentPlan.prefix}.csv`;
      downloadFile(name, toCsv(vlsmCsvRows(currentPlan)));
      showFeedback(button, 'Descargado');
    } else if (action === 'vlsm-markdown') {
      const ok = await copyText(toMarkdown(vlsmMarkdownRows(currentPlan)));
      showFeedback(button, ok ? 'Copiado' : 'No se pudo copiar');
    }
  });

  // ---------------------------------------------------------------------------
  // Pestaña 3: Dividir
  // ---------------------------------------------------------------------------

  const splitNet = $('#split-net');
  const splitNetError = $('#split-net-error');
  const splitValue = $('#split-value');
  const splitValueError = $('#split-value-error');
  const splitValueLabel = $('#split-value-label');
  const splitResults = $('#split-results');
  let currentSplit = null; // { ip, prefix, newPrefix } del último cálculo válido

  const getSplitMode = () => $('input[name="split-mode"]:checked').value;

  function updateSplitLabel() {
    const byCount = getSplitMode() === 'count';
    splitValueLabel.textContent = byCount ? 'Número de subredes' : 'Prefijo nuevo';
    splitValue.placeholder = byCount ? '8' : '/26';
  }

  function updateSplit() {
    currentSplit = null;
    let base = null;
    try {
      base = IPv4.parseCidr(splitNet.value);
      setFieldError(splitNet, splitNetError, '');
    } catch (error) {
      setFieldError(splitNet, splitNetError, error.message);
      setFieldError(splitValue, splitValueError, '');
    }

    let result = null;
    if (base) {
      const text = splitValue.value.trim();
      try {
        if (getSplitMode() === 'count') {
          const count = /^\d+$/.test(text) ? Number(text) : NaN;
          result = IPv4.splitIntoCount(base.ip, base.prefix, count, MAX_RENDER_ROWS);
        } else {
          result = IPv4.splitByPrefix(base.ip, base.prefix, IPv4.parsePrefix(text), MAX_RENDER_ROWS);
        }
        setFieldError(splitValue, splitValueError, '');
      } catch (error) {
        setFieldError(splitValue, splitValueError, error.message);
      }
    }

    if (!result) {
      markStale(splitResults, 'Corrige los datos marcados para ver las subredes.');
      return;
    }
    currentSplit = { ip: base.ip, prefix: base.prefix, newPrefix: result.newPrefix };
    splitResults.classList.remove('is-stale');
    splitResults.innerHTML = splitHtml(result);
  }

  function splitHtml(result) {
    const { count, bits, size, newPrefix, requested } = result;
    const first = result.subnets[0];
    const spare = requested !== undefined ? count - requested : 0; // subredes que sobran

    const notes = [];
    if (spare > 0) {
      notes.push(`<p class="note">Has pedido ${formatNumber(requested)} subredes: hacen falta ${bits} bits de subred
        (2<sup>${bits}</sup> = ${formatNumber(count)}), así que resultan ${formatNumber(count)}.
        ${spare === 1 ? 'La última queda' : `Las ${formatNumber(spare)} últimas quedan`} de reserva.</p>`);
    }
    if (result.truncated) {
      const csvText = count > MAX_CSV_ROWS
        ? `El CSV incluye las primeras ${formatNumber(MAX_CSV_ROWS)}.`
        : 'El CSV las incluye todas.';
      notes.push(`<p class="notice">Se muestran las primeras ${formatNumber(MAX_RENDER_ROWS)} de
        ${formatNumber(count)} subredes. ${csvText}</p>`);
    }

    const rows = result.subnets.map((s, i) => {
      const isSpare = spare > 0 && i >= requested;
      return `
      <tr${isSpare ? ' class="is-spare"' : ''}>
        <td class="num">${i + 1}${isSpare ? ' <span class="tag">reserva</span>' : ''}</td>
        <td class="mono">${copyable(cidr(s.network, s.prefix))}</td>
        <td class="mono">${copyable(toDotted(s.firstHost))}</td>
        <td class="mono">${copyable(toDotted(s.lastHost))}</td>
        <td class="mono">${s.broadcast === null ? '<span class="muted">—</span>' : copyable(toDotted(s.broadcast))}</td>
      </tr>`;
    }).join('');

    const bitsText = bits === 1 ? '1 bit' : `${bits} bits`;

    return `
      <div class="card__head">
        <div>
          <h3 class="card__title">${formatNumber(count)} ${count === 1 ? 'subred' : 'subredes'} /${newPrefix}</h3>
          <p class="card__sub">${cidr(result.network, result.prefix)} dividida con ${bitsText} de subred.</p>
        </div>
        <div class="actions">
          <button class="btn" type="button" data-action="split-csv">${ICONS.download}Exportar CSV</button>
        </div>
      </div>
      <div class="metrics">
        <div class="metric"><span class="metric__label">Subredes</span><span class="metric__value">${formatNumber(count)}</span></div>
        <div class="metric"><span class="metric__label">Direcciones por subred</span><span class="metric__value">${formatNumber(size)}</span></div>
        <div class="metric"><span class="metric__label">Hosts por subred</span><span class="metric__value">${formatNumber(first.usableHosts)}</span></div>
        <div class="metric"><span class="metric__label">Máscara</span><span class="metric__value">${copyable(toDotted(first.mask))}</span></div>
      </div>
      ${notes.join('')}
      <div class="table-wrap" tabindex="0" role="region" aria-label="Lista de subredes">
        <table class="table">
          <thead>
            <tr>
              <th scope="col" class="num">#</th>
              <th scope="col">Subred</th>
              <th scope="col">Primer host</th>
              <th scope="col">Último host</th>
              <th scope="col">Broadcast</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  splitResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="split-csv"]');
    if (!button || !currentSplit) return;
    const { ip, prefix, newPrefix } = currentSplit;
    // Se recalcula con un límite mayor que el de la tabla
    const { subnets } = IPv4.splitByPrefix(ip, prefix, newPrefix, MAX_CSV_ROWS);
    const header = ['#', 'Subred', 'Dirección de red', 'Máscara', 'Primer host', 'Último host', 'Broadcast', 'Hosts utilizables'];
    const rows = subnets.map((s, i) => [
      i + 1, cidr(s.network, s.prefix), toDotted(s.network), toDotted(s.mask), toDotted(s.firstHost),
      toDotted(s.lastHost), s.broadcast === null ? '' : toDotted(s.broadcast), s.usableHosts,
    ]);
    downloadFile(`subredes-${toDotted(ip)}-${prefix}-a-${newPrefix}.csv`, toCsv([header, ...rows]));
    showFeedback(button, 'Descargado');
  });

  splitNet.addEventListener('input', onSplitChange);
  splitValue.addEventListener('input', onSplitChange);

  $$('input[name="split-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      // Traduce el valor al otro modo (en una /16: 8 subredes ⇄ /19)
      if (currentSplit) {
        const bits = currentSplit.newPrefix - currentSplit.prefix;
        splitValue.value = getSplitMode() === 'count' ? String(2 ** bits) : `/${currentSplit.newPrefix}`;
      }
      updateSplitLabel();
      onSplitChange();
    });
  });

  function onSplitChange() {
    updateSplit();
    scheduleHashUpdate();
  }

  // ---------------------------------------------------------------------------
  // Estado en la URL (#tab=vlsm&red=…): permite compartir un cálculo por enlace
  // ---------------------------------------------------------------------------

  let hashTimer = null;

  function stateToHash() {
    const params = new URLSearchParams({ tab: currentTab });
    if (currentTab === 'subred') {
      params.set('ip', subnetIp.value.trim());
      params.set('prefijo', subnetMask.value);
    } else if (currentTab === 'vlsm') {
      params.set('red', vlsmBase.value.trim());
      for (const row of $$('.vrow', vlsmRows)) {
        params.append('nombre', $('.vrow__name', row).value.trim());
        params.append('hosts', $('.vrow__hosts', row).value.trim());
      }
    } else {
      params.set('red', splitNet.value.trim());
      params.set('modo', getSplitMode() === 'count' ? 'subredes' : 'prefijo');
      params.set('valor', splitValue.value.trim());
    }
    return `#${params}`;
  }

  function writeHash() {
    clearTimeout(hashTimer);
    const hash = stateToHash();
    if (hash !== location.hash) {
      // replaceState cambia la URL sin añadir entradas al historial ni disparar 'hashchange'
      history.replaceState(null, '', hash);
    }
  }

  // Se espera un poco tras la última tecla para no reescribir la URL en cada pulsación
  function scheduleHashUpdate() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(writeHash, 250);
  }

  /** Aplica el estado guardado en la URL. Devuelve false si no hay un estado válido. */
  function restoreFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const tab = params.get('tab');
    if (!TABS.includes(tab)) return false;

    if (tab === 'subred') {
      if (params.has('ip')) subnetIp.value = params.get('ip');
      const prefix = params.get('prefijo');
      if (/^\d{1,2}$/.test(prefix) && Number(prefix) <= 32) {
        subnetMask.value = String(Number(prefix));
      }
    } else if (tab === 'vlsm') {
      if (params.has('red')) vlsmBase.value = params.get('red');
      const names = params.getAll('nombre');
      const hosts = params.getAll('hosts').slice(0, MAX_VLSM_ROWS);
      if (hosts.length > 0) {
        setRows(hosts.map((h, i) => [names[i] ?? '', h]));
      }
    } else {
      if (params.has('red')) splitNet.value = params.get('red');
      const mode = params.get('modo') === 'prefijo' ? 'prefix' : 'count';
      $(`input[name="split-mode"][value="${mode}"]`).checked = true;
      if (params.has('valor')) splitValue.value = params.get('valor');
      updateSplitLabel();
    }
    selectTab(tab);
    return true;
  }

  $('#copy-link').addEventListener('click', async (event) => {
    const button = event.currentTarget; // se guarda antes del await
    writeHash();
    const ok = await copyText(location.href);
    showFeedback(button, ok ? 'Enlace copiado' : 'No se pudo copiar');
  });

  // Si alguien pega otro enlace con estado en la misma pestaña
  window.addEventListener('hashchange', () => {
    if (restoreFromHash()) updateAll();
  });

  // ---------------------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------------------

  function updateAll() {
    updateSubnet();
    updateVlsm();
    updateSplit();
  }

  // Valores de ejemplo; si la URL trae un estado, lo sustituye
  subnetIp.value = '192.168.1.10';
  subnetMask.value = '24';
  loadPreset('oficina');
  splitNet.value = '10.0.0.0/16';
  splitValue.value = '8';
  updateSplitLabel();

  if (!restoreFromHash()) {
    selectTab('subred');
  }
  updateAll();
})();
