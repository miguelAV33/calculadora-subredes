/**
 * ipv4.js — Lógica de direccionamiento IPv4 (sin acceso al DOM).
 *
 * Todas las direcciones y máscaras se guardan como enteros SIN signo de
 * 32 bits (de 0 a 4.294.967.295). Los operadores de bits de JavaScript
 * (&, |, ~, <<) trabajan con enteros CON signo de 32 bits, así que después
 * de cada operación se aplica `>>> 0` para volver a leer el resultado como
 * número sin signo. Sin eso, 192.168.0.0 & 255.255.0.0 daría un negativo.
 *
 * El archivo funciona igual como script clásico en el navegador (crea la
 * variable global `IPv4`) y como módulo CommonJS en Node (para los tests).
 */
(function (root, factory) {
  const IPv4 = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = IPv4; // Node: require('./ipv4.js')
  } else {
    root.IPv4 = IPv4; // Navegador: window.IPv4
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_ADDRESS = 0xffffffff; // 255.255.255.255
  const TOTAL_ADDRESSES = 2 ** 32;

  // ---------------------------------------------------------------------------
  // Lectura de texto: direcciones, prefijos y máscaras
  // ---------------------------------------------------------------------------

  /** Valida un octeto escrito como texto ("192") y lo devuelve como número. */
  function parseOctet(part) {
    if (part === '') {
      throw new Error('Falta un octeto: revisa que no haya dos puntos seguidos ni un punto al final.');
    }
    if (!/^\d+$/.test(part)) {
      throw new Error(`«${part}» no es un octeto válido: solo se admiten dígitos.`);
    }
    const value = Number(part);
    if (value > 255) {
      throw new Error(`El octeto ${part} está fuera de rango: cada octeto va de 0 a 255.`);
    }
    // "010" es ambiguo: herramientas como ping o inet_aton lo leen en octal (= 8).
    // Para no dar un resultado distinto al que el usuario espera, se rechaza.
    if (part.length > 1 && part[0] === '0') {
      throw new Error(`El octeto «${part}» lleva ceros a la izquierda; escríbelo como ${value}.`);
    }
    return value;
  }

  /** "192.168.1.10" → 3232235786 */
  function parseIp(text) {
    const value = String(text ?? '').trim();
    if (value === '') {
      throw new Error('Introduce una dirección IPv4.');
    }
    const parts = value.split('.');
    if (parts.length !== 4) {
      throw new Error(`Una dirección IPv4 tiene 4 octetos separados por puntos y aquí hay ${parts.length}.`);
    }
    let ip = 0;
    for (const part of parts) {
      // Desplaza 8 bits a la izquierda y añade el octeto al final
      ip = ((ip << 8) | parseOctet(part)) >>> 0;
    }
    return ip;
  }

  /** "24" o "/24" → 24 */
  function parsePrefix(text) {
    const value = String(text ?? '').trim().replace(/^\//, '');
    if (!/^\d{1,2}$/.test(value) || Number(value) > 32) {
      throw new Error('El prefijo debe ser un número entre /0 y /32.');
    }
    return Number(value);
  }

  /** Acepta una máscara en decimal con puntos ("255.255.255.0") o un prefijo ("/24"). Devuelve el prefijo. */
  function parseMask(text) {
    const value = String(text ?? '').trim();
    if (value.includes('.')) {
      return maskToPrefix(parseIp(value));
    }
    return parsePrefix(value);
  }

  /**
   * Interpreta "IP", "IP/24", "IP/255.255.255.0" o "IP 255.255.255.0".
   * Devuelve { ip, prefix }; prefix es null si no se escribió máscara.
   */
  function parseAddress(text) {
    const value = String(text ?? '').trim();
    const parts = value.split(/\s*\/\s*|\s+/);
    if (parts.length > 2) {
      throw new Error('Formato no reconocido. Usa IP/prefijo, por ejemplo 192.168.1.10/24.');
    }
    const ip = parseIp(parts[0]);
    const prefix = parts.length === 2 ? parseMask(parts[1]) : null;
    return { ip, prefix };
  }

  /** Como parseAddress, pero la máscara es obligatoria ("192.168.10.0/24"). */
  function parseCidr(text) {
    const { ip, prefix } = parseAddress(text);
    if (prefix === null) {
      throw new Error('Falta el prefijo: escribe la red como 192.168.10.0/24.');
    }
    return { ip, prefix };
  }

  // ---------------------------------------------------------------------------
  // Máscaras
  // ---------------------------------------------------------------------------

  function checkPrefix(prefix) {
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error('El prefijo debe ser un número entero entre /0 y /32.');
    }
  }

  function checkIp(ip) {
    if (!Number.isInteger(ip) || ip < 0 || ip > MAX_ADDRESS) {
      throw new Error('La dirección debe ser un entero entre 0 y 4294967295.');
    }
  }

  /** 24 → 255.255.255.0 (como entero) */
  function prefixToMask(prefix) {
    checkPrefix(prefix);
    // En JavaScript `x << 32` equivale a `x << 0` (solo usa 5 bits del
    // desplazamiento), por eso /0 se resuelve aparte.
    if (prefix === 0) return 0;
    return (MAX_ADDRESS << (32 - prefix)) >>> 0;
  }

  /** 255.255.255.0 (como entero) → 24. Rechaza máscaras no contiguas. */
  function maskToPrefix(mask) {
    checkIp(mask);
    // Una máscara válida es 1…10…0, así que su inversa (wildcard) es 0…01…1.
    // Un número de la forma 0…01…1 cumple que w & (w + 1) === 0.
    const wildcard = ~mask >>> 0;
    if ((wildcard & (wildcard + 1)) !== 0) {
      throw new Error(
        `La máscara ${toDotted(mask)} no es válida: los bits a 1 deben ser contiguos (por ejemplo 255.255.255.0).`
      );
    }
    // El prefijo es el número de bits a 1
    let prefix = 0;
    for (let bits = mask; bits !== 0; bits >>>= 1) {
      prefix += bits & 1;
    }
    return prefix;
  }

  // ---------------------------------------------------------------------------
  // Formatos de salida
  // ---------------------------------------------------------------------------

  /** 3232235786 → "192.168.1.10" */
  function toDotted(ip) {
    return [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join('.');
  }

  /** 3232235786 → "11000000.10101000.00000001.00001010" */
  function toBinary(ip) {
    const bits = (ip >>> 0).toString(2).padStart(32, '0');
    return bits.match(/.{8}/g).join('.');
  }

  /** 3232235786 → "0xC0A8010A" */
  function toHex(ip) {
    return '0x' + (ip >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  // ---------------------------------------------------------------------------
  // Clasificación
  // ---------------------------------------------------------------------------

  /** Clase histórica (anterior a CIDR) según el primer octeto. */
  function getClass(ip) {
    const first = ip >>> 24;
    if (first < 128) return 'A';
    if (first < 192) return 'B';
    if (first < 224) return 'C';
    if (first < 240) return 'D';
    return 'E';
  }

  const PRIVATE = {
    id: 'private',
    label: 'Privada',
    rfc: 'RFC 1918',
    description: 'Rango privado: no se enruta en Internet y necesita NAT para salir.',
  };
  const DOCUMENTATION = {
    id: 'documentation',
    label: 'Documentación',
    rfc: 'RFC 5737',
    description: 'Reservada para ejemplos y documentación; no debe usarse en redes reales.',
  };

  // Rangos especiales. Se recorren en orden y gana el primero que coincide.
  const SPECIAL_RANGES = [
    { cidr: '0.0.0.0/8', id: 'this-network', label: 'Esta red', rfc: 'RFC 1122',
      description: '0.0.0.0/8 identifica «esta red»; 0.0.0.0 se usa como origen antes de tener IP.' },
    { cidr: '10.0.0.0/8', ...PRIVATE },
    { cidr: '100.64.0.0/10', id: 'cgnat', label: 'CGNAT', rfc: 'RFC 6598',
      description: 'Espacio compartido que usan los operadores para NAT a gran escala (CGNAT).' },
    { cidr: '127.0.0.0/8', id: 'loopback', label: 'Loopback', rfc: 'RFC 1122',
      description: 'Bucle local: el tráfico no sale del propio equipo.' },
    { cidr: '169.254.0.0/16', id: 'link-local', label: 'Enlace local (APIPA)', rfc: 'RFC 3927',
      description: 'Autoasignada cuando el equipo no obtiene respuesta del servidor DHCP.' },
    { cidr: '172.16.0.0/12', ...PRIVATE },
    { cidr: '192.0.2.0/24', ...DOCUMENTATION },
    { cidr: '192.168.0.0/16', ...PRIVATE },
    { cidr: '198.18.0.0/15', id: 'benchmark', label: 'Pruebas de rendimiento', rfc: 'RFC 2544',
      description: 'Reservada para pruebas de rendimiento de equipos de red.' },
    { cidr: '198.51.100.0/24', ...DOCUMENTATION },
    { cidr: '203.0.113.0/24', ...DOCUMENTATION },
    { cidr: '224.0.0.0/4', id: 'multicast', label: 'Multicast', rfc: 'RFC 5771',
      description: 'Dirección de grupo (clase D): identifica a varios receptores, no a un host.' },
    { cidr: '255.255.255.255/32', id: 'broadcast', label: 'Broadcast limitado', rfc: 'RFC 919',
      description: 'Llega a todos los equipos del segmento local y los routers no la reenvían.' },
    { cidr: '240.0.0.0/4', id: 'reserved', label: 'Reservada', rfc: 'RFC 1112',
      description: 'Clase E: reservada para uso futuro o experimental.' },
  ].map((range) => ({ ...range, ...parseCidr(range.cidr) }));

  const PUBLIC = {
    id: 'public',
    label: 'Pública',
    rfc: null,
    description: 'Dirección pública, enrutable en Internet.',
  };

  /** Devuelve { id, label, rfc, description } del rango al que pertenece la IP. */
  function classify(ip) {
    const range = SPECIAL_RANGES.find(
      (r) => ((ip & prefixToMask(r.prefix)) >>> 0) === r.ip
    );
    if (!range) return { ...PUBLIC };
    const { id, label, rfc, description } = range;
    return { id, label, rfc, description };
  }

  // ---------------------------------------------------------------------------
  // Cálculo de una subred
  // ---------------------------------------------------------------------------

  /**
   * Calcula todos los datos de la red a la que pertenece `ip` con el prefijo dado.
   * En /31 y /32 no hay dirección de broadcast (broadcast = null):
   *  - /31 (RFC 3021): enlaces punto a punto, las 2 direcciones son utilizables.
   *  - /32: un único host (rutas de host, loopbacks, reglas de firewall).
   */
  function subnetInfo(ip, prefix) {
    checkIp(ip);
    checkPrefix(prefix);

    const mask = prefixToMask(prefix);
    const wildcard = ~mask >>> 0;
    const network = (ip & mask) >>> 0; // IP AND máscara
    const lastAddress = (network | wildcard) >>> 0; // red OR wildcard
    const totalAddresses = 2 ** (32 - prefix);

    let broadcast = lastAddress;
    let firstHost = network + 1;
    let lastHost = lastAddress - 1;
    let usableHosts = totalAddresses - 2;

    if (prefix === 31) {
      broadcast = null;
      firstHost = network;
      lastHost = lastAddress;
      usableHosts = 2;
    } else if (prefix === 32) {
      broadcast = null;
      firstHost = network;
      lastHost = network;
      usableHosts = 1;
    }

    return {
      ip,
      prefix,
      mask,
      wildcard,
      network,
      broadcast,
      firstHost,
      lastHost,
      totalAddresses,
      usableHosts,
      ipClass: getClass(ip),
      type: classify(ip),
    };
  }

  // ---------------------------------------------------------------------------
  // VLSM
  // ---------------------------------------------------------------------------

  /**
   * Bloque más pequeño en el que caben `hosts` equipos, contando también la
   * dirección de red y la de broadcast. El mínimo es /30 (4 direcciones,
   * 2 hosts): es el criterio clásico para enlaces punto a punto.
   */
  function blockForHosts(hosts) {
    if (!Number.isInteger(hosts) || hosts < 1) {
      throw new Error('El número de hosts debe ser un entero mayor que 0.');
    }
    if (hosts > TOTAL_ADDRESSES - 2) {
      throw new Error('Ninguna red IPv4 admite tantos hosts.');
    }
    let prefix = 30;
    while (2 ** (32 - prefix) - 2 < hosts) {
      prefix--;
    }
    return { prefix, size: 2 ** (32 - prefix) };
  }

  /** Prefijo más largo (red más pequeña) que contiene al menos `size` direcciones; null si no existe. */
  function prefixForSize(size) {
    if (size > TOTAL_ADDRESSES) return null;
    let prefix = 32;
    while (2 ** (32 - prefix) < size) {
      prefix--;
    }
    return prefix;
  }

  /**
   * Reparte la red base entre las subredes pedidas ([{ name, hosts }]).
   *
   * 1. Cada petición recibe el bloque potencia de 2 más pequeño que la cubre.
   * 2. Se ordenan de más a menos hosts (con empate, se respeta el orden original).
   * 3. Se asignan bloques consecutivos desde el inicio de la red base.
   *
   * Como los bloques van de mayor a menor y todos son potencias de 2, cada
   * bloque empieza en un múltiplo de su tamaño (queda alineado) sin dejar huecos.
   */
  function allocateVlsm(ip, prefix, requests) {
    const base = subnetInfo(ip, prefix);
    const baseSize = base.totalAddresses;

    const blocks = requests
      .map((request, index) => {
        const name = String(request.name ?? '').trim() || `Subred ${index + 1}`;
        let block;
        try {
          block = blockForHosts(request.hosts);
        } catch (error) {
          throw new Error(`${name}: ${error.message}`);
        }
        return { name, hosts: request.hosts, index, ...block };
      })
      .sort((a, b) => b.hosts - a.hosts || a.index - b.index);

    const needed = blocks.reduce((sum, block) => sum + block.size, 0);

    if (needed > baseSize) {
      const suggestedPrefix = prefixForSize(needed);
      return {
        fits: false,
        network: base.network,
        prefix,
        size: baseSize,
        needed,
        suggestedPrefix,
        // Red del tamaño sugerido que contiene a la red base actual
        suggestedNetwork:
          suggestedPrefix === null ? null : (base.network & prefixToMask(suggestedPrefix)) >>> 0,
        blocks: blocks.map(({ name, hosts, size, prefix: p }) => ({ name, hosts, size, prefix: p })),
      };
    }

    let next = base.network; // primera dirección libre
    const subnets = blocks.map((block) => {
      const info = subnetInfo(next, block.prefix);
      next += block.size;
      return {
        name: block.name,
        hosts: block.hosts,
        index: block.index,
        blockSize: block.size,
        prefix: block.prefix,
        network: info.network,
        mask: info.mask,
        firstHost: info.firstHost,
        lastHost: info.lastHost,
        broadcast: info.broadcast,
        usableHosts: info.usableHosts,
        unused: info.usableHosts - block.hosts, // hosts disponibles que no se usan
      };
    });

    return {
      fits: true,
      network: base.network,
      prefix,
      size: baseSize,
      used: needed,
      free: baseSize - needed,
      subnets,
    };
  }

  // ---------------------------------------------------------------------------
  // División en subredes iguales
  // ---------------------------------------------------------------------------

  /**
   * Divide la red en subredes del prefijo `newPrefix`.
   * Solo genera las primeras `limit` (puede haber millones); `count` es el total real.
   */
  function splitByPrefix(ip, prefix, newPrefix, limit = Infinity) {
    checkPrefix(prefix);
    if (!Number.isInteger(newPrefix) || newPrefix < prefix || newPrefix > 32) {
      throw new Error(`El nuevo prefijo debe estar entre /${prefix} y /32.`);
    }
    const base = subnetInfo(ip, prefix);
    const count = 2 ** (newPrefix - prefix);
    const size = 2 ** (32 - newPrefix);
    const subnets = [];
    for (let i = 0; i < Math.min(count, limit); i++) {
      subnets.push(subnetInfo(base.network + i * size, newPrefix));
    }
    return {
      network: base.network,
      prefix,
      newPrefix,
      bits: newPrefix - prefix, // bits que se toman prestados de la parte de host
      count,
      size,
      subnets,
      truncated: subnets.length < count,
    };
  }

  /**
   * Divide la red en (al menos) `requested` subredes iguales.
   * Con n bits de subred salen 2^n subredes, así que si se piden 5 hacen falta
   * 3 bits y resultan 8.
   */
  function splitIntoCount(ip, prefix, requested, limit = Infinity) {
    checkPrefix(prefix);
    if (!Number.isInteger(requested) || requested < 1) {
      throw new Error('El número de subredes debe ser un entero mayor que 0.');
    }
    let bits = 0;
    while (2 ** bits < requested) {
      bits++;
    }
    if (prefix + bits > 32) {
      throw new Error(
        `Una /${prefix} admite como máximo ${(2 ** (32 - prefix)).toLocaleString('es-ES')} subredes (de /32).`
      );
    }
    return { ...splitByPrefix(ip, prefix, prefix + bits, limit), requested };
  }

  return {
    parseIp,
    parsePrefix,
    parseMask,
    parseAddress,
    parseCidr,
    prefixToMask,
    maskToPrefix,
    toDotted,
    toBinary,
    toHex,
    getClass,
    classify,
    subnetInfo,
    blockForHosts,
    prefixForSize,
    allocateVlsm,
    splitByPrefix,
    splitIntoCount,
  };
});
