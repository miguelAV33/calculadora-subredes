/**
 * Tests de js/ipv4.js — se ejecutan con:  node tests/ipv4.test.js
 * Usa solo módulos de Node (node:test y node:assert), sin dependencias.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const IPv4 = require(path.join(__dirname, '..', 'js', 'ipv4.js'));

// Atajos para que los tests se lean como la notación habitual
const ip = (text) => IPv4.parseIp(text);
const dotted = (value) => (value === null ? null : IPv4.toDotted(value));

/** Calcula una subred a partir de "IP/prefijo" y devuelve los campos como texto. */
function info(cidr) {
  const { ip: address, prefix } = IPv4.parseCidr(cidr);
  const result = IPv4.subnetInfo(address, prefix);
  return {
    ...result,
    network: dotted(result.network),
    broadcast: dotted(result.broadcast),
    firstHost: dotted(result.firstHost),
    lastHost: dotted(result.lastHost),
    mask: dotted(result.mask),
    wildcard: dotted(result.wildcard),
  };
}

describe('parseIp', () => {
  it('convierte una IP a entero sin signo', () => {
    assert.equal(ip('192.168.1.10'), 3232235786);
    assert.equal(ip('0.0.0.0'), 0);
    assert.equal(ip('10.0.0.1'), 167772161);
  });

  it('255.255.255.255 es 4294967295, nunca -1', () => {
    assert.equal(ip('255.255.255.255'), 4294967295);
    assert.ok(ip('200.1.2.3') > 0);
  });

  it('ignora espacios al principio y al final', () => {
    assert.equal(ip('  172.16.0.1 '), ip('172.16.0.1'));
  });

  it('rechaza octetos fuera de rango', () => {
    assert.throws(() => ip('256.1.1.1'), /fuera de rango/);
    assert.throws(() => ip('192.168.1.256'), /fuera de rango/);
    assert.throws(() => ip('192.168.1.999'), /fuera de rango/);
  });

  it('rechaza un número de octetos distinto de 4', () => {
    assert.throws(() => ip('192.168.1'), /4 octetos/);
    assert.throws(() => ip('192.168.1.1.1'), /4 octetos/);
    assert.throws(() => ip('3232235786'), /4 octetos/);
  });

  it('rechaza octetos vacíos', () => {
    assert.throws(() => ip('192.168..1'), /Falta un octeto/);
    assert.throws(() => ip('192.168.1.'), /Falta un octeto/);
    assert.throws(() => ip('.192.168.1'), /Falta un octeto/);
  });

  it('rechaza caracteres que no son dígitos', () => {
    assert.throws(() => ip('a.b.c.d'), /solo se admiten dígitos/);
    assert.throws(() => ip('192.168.1.-1'), /solo se admiten dígitos/);
    assert.throws(() => ip('192.168.1.+1'), /solo se admiten dígitos/);
    assert.throws(() => ip('192.168.1.1a'), /solo se admiten dígitos/);
    assert.throws(() => ip('192.168.1.0x1'), /solo se admiten dígitos/);
  });

  it('rechaza ceros a la izquierda (ambiguos: podrían leerse en octal)', () => {
    assert.throws(() => ip('192.168.01.1'), /ceros a la izquierda/);
    assert.throws(() => ip('010.0.0.1'), /ceros a la izquierda/);
    assert.throws(() => ip('10.0.0.00'), /ceros a la izquierda/);
  });

  it('acepta el 0 como octeto', () => {
    assert.equal(ip('10.0.0.0'), 167772160);
  });

  it('rechaza la entrada vacía, null y undefined', () => {
    assert.throws(() => ip(''), /Introduce una dirección/);
    assert.throws(() => ip('   '), /Introduce una dirección/);
    assert.throws(() => ip(null), /Introduce una dirección/);
    assert.throws(() => ip(undefined), /Introduce una dirección/);
  });
});

describe('Máscaras y prefijos', () => {
  it('prefixToMask en los extremos y valores típicos', () => {
    assert.equal(IPv4.prefixToMask(0), 0);
    assert.equal(IPv4.prefixToMask(1), 0x80000000);
    assert.equal(IPv4.prefixToMask(8), 0xff000000);
    assert.equal(IPv4.prefixToMask(24), 0xffffff00);
    assert.equal(IPv4.prefixToMask(30), 0xfffffffc);
    assert.equal(IPv4.prefixToMask(32), 0xffffffff);
  });

  it('prefixToMask nunca devuelve negativos', () => {
    for (let prefix = 0; prefix <= 32; prefix++) {
      assert.ok(IPv4.prefixToMask(prefix) >= 0, `/${prefix}`);
    }
  });

  it('maskToPrefix es la inversa de prefixToMask para /0 … /32', () => {
    for (let prefix = 0; prefix <= 32; prefix++) {
      assert.equal(IPv4.maskToPrefix(IPv4.prefixToMask(prefix)), prefix);
    }
  });

  it('parseMask acepta máscara decimal con puntos', () => {
    assert.equal(IPv4.parseMask('255.255.255.0'), 24);
    assert.equal(IPv4.parseMask('255.255.255.252'), 30);
    assert.equal(IPv4.parseMask('255.255.240.0'), 20);
    assert.equal(IPv4.parseMask('255.255.255.255'), 32);
    assert.equal(IPv4.parseMask('0.0.0.0'), 0);
  });

  it('parseMask acepta prefijo con o sin barra', () => {
    assert.equal(IPv4.parseMask('/24'), 24);
    assert.equal(IPv4.parseMask('24'), 24);
    assert.equal(IPv4.parseMask(' /0 '), 0);
    assert.equal(IPv4.parseMask('32'), 32);
  });

  it('rechaza máscaras no contiguas', () => {
    for (const mask of ['255.0.255.0', '255.255.255.1', '0.255.255.255', '255.255.254.255', '128.0.0.1']) {
      assert.throws(() => IPv4.parseMask(mask), /contiguos/, mask);
    }
  });

  it('rechaza prefijos fuera de /0 … /32', () => {
    for (const prefix of ['33', '/99', '-1', 'abc', '', '/2 4']) {
      assert.throws(() => IPv4.parseMask(prefix), /prefijo/, prefix);
    }
    assert.throws(() => IPv4.parseMask('24.5'), /4 octetos/); // con punto se lee como máscara
    assert.throws(() => IPv4.prefixToMask(33), /prefijo/);
    assert.throws(() => IPv4.prefixToMask(-1), /prefijo/);
  });
});

describe('parseAddress y parseCidr', () => {
  it('lee IP/prefijo', () => {
    assert.deepEqual(IPv4.parseAddress('192.168.1.10/24'), { ip: ip('192.168.1.10'), prefix: 24 });
    assert.deepEqual(IPv4.parseCidr('10.0.0.0/8'), { ip: ip('10.0.0.0'), prefix: 8 });
  });

  it('lee IP/máscara e IP máscara', () => {
    assert.equal(IPv4.parseAddress('192.168.1.10/255.255.255.0').prefix, 24);
    assert.equal(IPv4.parseAddress('192.168.1.10 255.255.255.0').prefix, 24);
    assert.equal(IPv4.parseAddress('192.168.1.10 / 26').prefix, 26);
  });

  it('sin máscara devuelve prefix null; parseCidr la exige', () => {
    assert.equal(IPv4.parseAddress('192.168.1.10').prefix, null);
    assert.throws(() => IPv4.parseCidr('192.168.1.10'), /Falta el prefijo/);
  });

  it('rechaza formatos incorrectos', () => {
    assert.throws(() => IPv4.parseCidr('192.168.1.10/33'), /prefijo/);
    assert.throws(() => IPv4.parseCidr('192.168.1.10/'), /prefijo/);
    assert.throws(() => IPv4.parseCidr('1.2.3.4/24/8'), /Formato no reconocido/);
    assert.throws(() => IPv4.parseCidr('192.168.1.300/24'), /fuera de rango/);
    assert.throws(() => IPv4.parseCidr('192.168.1.1/255.0.255.0'), /contiguos/);
  });
});

describe('Formatos de salida', () => {
  it('toDotted, toBinary y toHex', () => {
    const value = ip('192.168.1.10');
    assert.equal(IPv4.toDotted(value), '192.168.1.10');
    assert.equal(IPv4.toBinary(value), '11000000.10101000.00000001.00001010');
    assert.equal(IPv4.toHex(value), '0xC0A8010A');
    assert.equal(IPv4.toBinary(0), '00000000.00000000.00000000.00000000');
    assert.equal(IPv4.toHex(4294967295), '0xFFFFFFFF');
    assert.equal(IPv4.toDotted(4294967295), '255.255.255.255');
  });
});

describe('subnetInfo', () => {
  it('/24', () => {
    const r = info('192.168.1.10/24');
    assert.equal(r.network, '192.168.1.0');
    assert.equal(r.broadcast, '192.168.1.255');
    assert.equal(r.firstHost, '192.168.1.1');
    assert.equal(r.lastHost, '192.168.1.254');
    assert.equal(r.usableHosts, 254);
    assert.equal(r.totalAddresses, 256);
    assert.equal(r.mask, '255.255.255.0');
    assert.equal(r.wildcard, '0.0.0.255');
  });

  it('/0 (todo el espacio IPv4)', () => {
    const r = info('10.20.30.40/0');
    assert.equal(r.network, '0.0.0.0');
    assert.equal(r.broadcast, '255.255.255.255');
    assert.equal(r.firstHost, '0.0.0.1');
    assert.equal(r.lastHost, '255.255.255.254');
    assert.equal(r.totalAddresses, 4294967296);
    assert.equal(r.usableHosts, 4294967294);
    assert.equal(r.mask, '0.0.0.0');
    assert.equal(r.wildcard, '255.255.255.255');
  });

  it('/8', () => {
    const r = info('10.1.2.3/8');
    assert.equal(r.network, '10.0.0.0');
    assert.equal(r.broadcast, '10.255.255.255');
    assert.equal(r.firstHost, '10.0.0.1');
    assert.equal(r.lastHost, '10.255.255.254');
    assert.equal(r.usableHosts, 16777214);
    assert.equal(r.totalAddresses, 16777216);
  });

  it('/20 (límite que no coincide con un octeto)', () => {
    const r = info('172.16.37.200/20');
    assert.equal(r.network, '172.16.32.0');
    assert.equal(r.broadcast, '172.16.47.255');
    assert.equal(r.mask, '255.255.240.0');
    assert.equal(r.wildcard, '0.0.15.255');
    assert.equal(r.usableHosts, 4094);
  });

  it('/30', () => {
    const r = info('192.168.1.5/30');
    assert.equal(r.network, '192.168.1.4');
    assert.equal(r.broadcast, '192.168.1.7');
    assert.equal(r.firstHost, '192.168.1.5');
    assert.equal(r.lastHost, '192.168.1.6');
    assert.equal(r.usableHosts, 2);
    assert.equal(r.totalAddresses, 4);
  });

  it('/31 (RFC 3021): 2 direcciones utilizables, sin red ni broadcast', () => {
    const r = info('192.168.1.5/31');
    assert.equal(r.network, '192.168.1.4');
    assert.equal(r.broadcast, null);
    assert.equal(r.firstHost, '192.168.1.4');
    assert.equal(r.lastHost, '192.168.1.5');
    assert.equal(r.usableHosts, 2);
    assert.equal(r.totalAddresses, 2);
  });

  it('/32: un único host', () => {
    const r = info('8.8.8.8/32');
    assert.equal(r.network, '8.8.8.8');
    assert.equal(r.broadcast, null);
    assert.equal(r.firstHost, '8.8.8.8');
    assert.equal(r.lastHost, '8.8.8.8');
    assert.equal(r.usableHosts, 1);
    assert.equal(r.totalAddresses, 1);
    assert.equal(r.wildcard, '0.0.0.0');
  });

  it('direcciones altas siguen siendo positivas (aritmética sin signo)', () => {
    const high = IPv4.subnetInfo(ip('255.255.255.255'), 24);
    assert.equal(high.network, 4294967040);
    assert.equal(high.broadcast, 4294967295);
    const r = IPv4.subnetInfo(ip('200.1.2.3'), 1);
    assert.equal(r.network, 2147483648);
    assert.equal(dotted(r.network), '128.0.0.0');
  });

  it('incluye clase y tipo de la IP', () => {
    const r = info('192.168.1.10/24');
    assert.equal(r.ipClass, 'C');
    assert.equal(r.type.id, 'private');
    assert.equal(r.type.rfc, 'RFC 1918');
  });

  it('rechaza valores fuera de rango', () => {
    assert.throws(() => IPv4.subnetInfo(-1, 24));
    assert.throws(() => IPv4.subnetInfo(2 ** 32, 24));
    assert.throws(() => IPv4.subnetInfo(0, 33));
  });
});

describe('Clasificación', () => {
  it('clase según el primer octeto', () => {
    const cases = {
      '0.0.0.1': 'A', '10.0.0.1': 'A', '127.0.0.1': 'A',
      '128.0.0.1': 'B', '191.255.0.1': 'B',
      '192.0.0.1': 'C', '223.255.255.1': 'C',
      '224.0.0.1': 'D', '239.255.255.255': 'D',
      '240.0.0.1': 'E', '255.255.255.255': 'E',
    };
    for (const [address, expected] of Object.entries(cases)) {
      assert.equal(IPv4.getClass(ip(address)), expected, address);
    }
  });

  it('tipo de dirección', () => {
    const cases = {
      '10.0.0.1': 'private',
      '10.255.255.255': 'private',
      '172.16.0.1': 'private',
      '172.31.255.255': 'private',
      '172.15.255.255': 'public',
      '172.32.0.1': 'public',
      '192.168.0.1': 'private',
      '192.169.0.1': 'public',
      '8.8.8.8': 'public',
      '1.1.1.1': 'public',
      '127.0.0.1': 'loopback',
      '127.255.255.254': 'loopback',
      '169.254.10.20': 'link-local',
      '100.64.0.1': 'cgnat',
      '100.127.255.255': 'cgnat',
      '100.63.255.255': 'public',
      '100.128.0.1': 'public',
      '224.0.0.251': 'multicast',
      '239.255.255.250': 'multicast',
      '240.0.0.1': 'reserved',
      '254.1.2.3': 'reserved',
      '255.255.255.255': 'broadcast',
      '0.0.0.0': 'this-network',
      '0.1.2.3': 'this-network',
      '192.0.2.1': 'documentation',
      '198.51.100.7': 'documentation',
      '203.0.113.200': 'documentation',
      '198.18.0.1': 'benchmark',
    };
    for (const [address, expected] of Object.entries(cases)) {
      assert.equal(IPv4.classify(ip(address)).id, expected, address);
    }
  });

  it('cada tipo trae etiqueta y descripción', () => {
    const type = IPv4.classify(ip('169.254.1.1'));
    assert.equal(type.label, 'Enlace local (APIPA)');
    assert.equal(type.rfc, 'RFC 3927');
    assert.ok(type.description.length > 0);
    assert.equal(IPv4.classify(ip('8.8.8.8')).rfc, null);
  });
});

describe('blockForHosts', () => {
  it('elige el bloque potencia de 2 más pequeño (hosts + red + broadcast)', () => {
    const cases = [
      [1, 30, 4], [2, 30, 4], [3, 29, 8], [6, 29, 8], [7, 28, 16],
      [14, 28, 16], [15, 27, 32], [50, 26, 64], [62, 26, 64], [63, 25, 128],
      [254, 24, 256], [255, 23, 512], [4294967294, 0, 4294967296],
    ];
    for (const [hosts, prefix, size] of cases) {
      assert.deepEqual(IPv4.blockForHosts(hosts), { prefix, size }, `${hosts} hosts`);
    }
  });

  it('rechaza cantidades no válidas', () => {
    for (const hosts of [0, -1, 1.5, NaN, Infinity, '10', 4294967295]) {
      assert.throws(() => IPv4.blockForHosts(hosts), undefined, String(hosts));
    }
  });
});

describe('allocateVlsm', () => {
  const OFICINA = [
    { name: 'Ventas', hosts: 50 },
    { name: 'Administración', hosts: 25 },
    { name: 'IT', hosts: 10 },
    { name: 'Enlace WAN', hosts: 2 },
  ];

  /** Comprueba las propiedades que todo plan VLSM correcto debe cumplir. */
  function assertValidPlan(plan) {
    assert.equal(plan.fits, true);
    const end = plan.network + plan.size;
    let previousEnd = plan.network;
    let previousSize = Infinity;
    for (const s of plan.subnets) {
      assert.equal(s.network % s.blockSize, 0, `${s.name} alineada a su tamaño`);
      assert.ok(s.network >= previousEnd, `${s.name} no se solapa con la anterior`);
      assert.ok(s.network + s.blockSize <= end, `${s.name} dentro de la red base`);
      assert.ok(s.blockSize <= previousSize, 'ordenadas de mayor a menor');
      assert.ok(s.usableHosts >= s.hosts, `${s.name} tiene hosts suficientes`);
      assert.ok(s.blockSize / 2 - 2 < s.hosts || s.blockSize === 4, `${s.name} usa el bloque mínimo`);
      previousEnd = s.network + s.blockSize;
      previousSize = s.blockSize;
    }
    assert.equal(plan.used, plan.subnets.reduce((sum, s) => sum + s.blockSize, 0));
    assert.equal(plan.free, plan.size - plan.used);
  }

  it('ejemplo «Oficina pequeña» en 192.168.10.0/24', () => {
    const plan = IPv4.allocateVlsm(ip('192.168.10.0'), 24, OFICINA);
    assertValidPlan(plan);
    const rows = plan.subnets.map((s) => [s.name, `${dotted(s.network)}/${s.prefix}`, dotted(s.broadcast)]);
    assert.deepEqual(rows, [
      ['Ventas', '192.168.10.0/26', '192.168.10.63'],
      ['Administración', '192.168.10.64/27', '192.168.10.95'],
      ['IT', '192.168.10.96/28', '192.168.10.111'],
      ['Enlace WAN', '192.168.10.112/30', '192.168.10.115'],
    ]);
    assert.equal(plan.used, 116);
    assert.equal(plan.free, 140);
    assert.deepEqual(plan.subnets.map((s) => s.unused), [12, 5, 4, 0]);
    assert.equal(dotted(plan.subnets[0].firstHost), '192.168.10.1');
    assert.equal(dotted(plan.subnets[0].lastHost), '192.168.10.62');
    assert.equal(dotted(plan.subnets[1].mask), '255.255.255.224');
  });

  it('ordena de mayor a menor aunque la lista venga desordenada', () => {
    const shuffled = [OFICINA[3], OFICINA[2], OFICINA[0], OFICINA[1]];
    const plan = IPv4.allocateVlsm(ip('192.168.10.0'), 24, shuffled);
    assertValidPlan(plan);
    assert.deepEqual(plan.subnets.map((s) => s.name), ['Ventas', 'Administración', 'IT', 'Enlace WAN']);
    assert.deepEqual(plan.subnets.map((s) => s.index), [2, 3, 1, 0]);
  });

  it('ejercicio clásico: 192.168.1.0/24 con 100, 50, 20, 10, 2 y 2 hosts', () => {
    const requests = [
      { name: 'LAN A', hosts: 100 }, { name: 'LAN B', hosts: 50 },
      { name: 'LAN C', hosts: 20 }, { name: 'LAN D', hosts: 10 },
      { name: 'WAN 1', hosts: 2 }, { name: 'WAN 2', hosts: 2 },
    ];
    const plan = IPv4.allocateVlsm(ip('192.168.1.0'), 24, requests);
    assertValidPlan(plan);
    assert.deepEqual(
      plan.subnets.map((s) => `${dotted(s.network)}/${s.prefix}`),
      ['192.168.1.0/25', '192.168.1.128/26', '192.168.1.192/27', '192.168.1.224/28', '192.168.1.240/30', '192.168.1.244/30']
    );
    assert.equal(plan.free, 8);
  });

  it('con empate de hosts respeta el orden original', () => {
    const plan = IPv4.allocateVlsm(ip('10.0.0.0'), 24, [
      { name: 'B', hosts: 2 }, { name: 'A', hosts: 2 }, { name: 'C', hosts: 2 },
    ]);
    assert.deepEqual(plan.subnets.map((s) => s.name), ['B', 'A', 'C']);
  });

  it('usa la dirección de red aunque la base se escriba con una IP de host', () => {
    const plan = IPv4.allocateVlsm(ip('192.168.10.77'), 24, OFICINA);
    assert.equal(dotted(plan.network), '192.168.10.0');
    assert.equal(dotted(plan.subnets[0].network), '192.168.10.0');
  });

  it('ajuste exacto: dos /25 llenan una /24', () => {
    const plan = IPv4.allocateVlsm(ip('192.168.0.0'), 24, [
      { name: 'A', hosts: 126 }, { name: 'B', hosts: 120 },
    ]);
    assertValidPlan(plan);
    assert.equal(plan.free, 0);
  });

  it('lista mixta grande sin solapes ni huecos', () => {
    const requests = [500, 3, 60, 1000, 2, 120, 30, 2, 14, 250].map((hosts, i) => ({ name: `R${i}`, hosts }));
    const plan = IPv4.allocateVlsm(ip('172.16.0.0'), 20, requests);
    assertValidPlan(plan);
    // Sin huecos: cada bloque empieza donde acaba el anterior
    for (let i = 1; i < plan.subnets.length; i++) {
      const prev = plan.subnets[i - 1];
      assert.equal(plan.subnets[i].network, prev.network + prev.blockSize);
    }
  });

  it('si no cabe, indica cuántas direcciones hacen falta y qué red bastaría', () => {
    const plan = IPv4.allocateVlsm(ip('192.168.10.0'), 24, [
      { name: 'Grande', hosts: 200 }, { name: 'Mediana', hosts: 100 },
    ]);
    assert.equal(plan.fits, false);
    assert.equal(plan.needed, 384); // 256 + 128
    assert.equal(plan.size, 256);
    assert.equal(plan.suggestedPrefix, 23);
    assert.equal(dotted(plan.suggestedNetwork), '192.168.10.0');
    assert.deepEqual(plan.blocks.map((b) => b.size), [256, 128]);
  });

  it('la red sugerida contiene a la base aunque no empiece igual', () => {
    const plan = IPv4.allocateVlsm(ip('192.168.11.0'), 24, [{ name: 'X', hosts: 300 }]);
    assert.equal(plan.fits, false);
    assert.equal(plan.suggestedPrefix, 23);
    assert.equal(dotted(plan.suggestedNetwork), '192.168.10.0');
  });

  it('un solo host de más ya no cabe', () => {
    const fits = IPv4.allocateVlsm(ip('10.0.0.0'), 30, [{ name: 'P2P', hosts: 2 }]);
    assert.equal(fits.fits, true);
    const tooBig = IPv4.allocateVlsm(ip('10.0.0.0'), 30, [{ name: 'P2P', hosts: 3 }]);
    assert.equal(tooBig.fits, false);
    assert.equal(tooBig.suggestedPrefix, 29);
  });

  it('lista vacía: plan válido sin subredes', () => {
    const plan = IPv4.allocateVlsm(ip('10.0.0.0'), 8, []);
    assert.equal(plan.fits, true);
    assert.deepEqual(plan.subnets, []);
    assert.equal(plan.free, 16777216);
  });

  it('pone nombre por defecto y valida los hosts de cada subred', () => {
    const plan = IPv4.allocateVlsm(ip('10.0.0.0'), 24, [{ name: '  ', hosts: 5 }]);
    assert.equal(plan.subnets[0].name, 'Subred 1');
    assert.throws(
      () => IPv4.allocateVlsm(ip('10.0.0.0'), 24, [{ name: 'Ventas', hosts: 0 }]),
      /Ventas: El número de hosts/
    );
  });
});

describe('División en subredes iguales', () => {
  it('192.168.1.0/24 en 4 subredes → 4 × /26', () => {
    const r = IPv4.splitIntoCount(ip('192.168.1.0'), 24, 4);
    assert.equal(r.newPrefix, 26);
    assert.equal(r.count, 4);
    assert.deepEqual(r.subnets.map((s) => dotted(s.network)), [
      '192.168.1.0', '192.168.1.64', '192.168.1.128', '192.168.1.192',
    ]);
    assert.deepEqual(r.subnets.map((s) => dotted(s.broadcast)), [
      '192.168.1.63', '192.168.1.127', '192.168.1.191', '192.168.1.255',
    ]);
  });

  it('si se piden 5 hacen falta 3 bits: resultan 8 subredes /27', () => {
    const r = IPv4.splitIntoCount(ip('192.168.1.0'), 24, 5);
    assert.equal(r.bits, 3);
    assert.equal(r.newPrefix, 27);
    assert.equal(r.count, 8);
    assert.equal(r.requested, 5);
    assert.equal(r.subnets.length, 8);
  });

  it('1 subred devuelve la misma red', () => {
    const r = IPv4.splitIntoCount(ip('10.0.0.0'), 8, 1);
    assert.equal(r.newPrefix, 8);
    assert.equal(r.count, 1);
  });

  it('por prefijo: 10.0.0.0/16 en /20 → 16 subredes contiguas', () => {
    const r = IPv4.splitByPrefix(ip('10.0.0.0'), 16, 20);
    assert.equal(r.count, 16);
    assert.equal(r.size, 4096);
    assert.equal(dotted(r.subnets[15].network), '10.0.240.0');
    assert.equal(dotted(r.subnets[15].broadcast), '10.0.255.255');
    for (let i = 1; i < r.subnets.length; i++) {
      assert.equal(r.subnets[i].network, r.subnets[i - 1].network + r.size);
    }
  });

  it('normaliza la red base', () => {
    const r = IPv4.splitByPrefix(ip('10.0.77.1'), 16, 17);
    assert.equal(dotted(r.network), '10.0.0.0');
    assert.equal(dotted(r.subnets[1].network), '10.0.128.0');
  });

  it('/0 en dos /1 (direcciones altas sin signo)', () => {
    const r = IPv4.splitByPrefix(0, 0, 1);
    assert.deepEqual(r.subnets.map((s) => dotted(s.network)), ['0.0.0.0', '128.0.0.0']);
    assert.equal(dotted(r.subnets[1].broadcast), '255.255.255.255');
  });

  it('respeta el límite de filas generadas pero informa del total', () => {
    const r = IPv4.splitByPrefix(ip('10.0.0.0'), 8, 30, 1024);
    assert.equal(r.count, 4194304);
    assert.equal(r.subnets.length, 1024);
    assert.equal(r.truncated, true);
    const all = IPv4.splitByPrefix(ip('10.0.0.0'), 16, 32, 65536);
    assert.equal(all.subnets.length, 65536);
    assert.equal(all.truncated, false);
    assert.equal(dotted(all.subnets[65535].network), '10.0.255.255');
  });

  it('rechaza divisiones imposibles', () => {
    assert.throws(() => IPv4.splitByPrefix(ip('10.0.0.0'), 16, 8), /nuevo prefijo/);
    assert.throws(() => IPv4.splitByPrefix(ip('10.0.0.0'), 16, 33), /nuevo prefijo/);
    assert.throws(() => IPv4.splitIntoCount(ip('10.0.0.0'), 30, 8), /como máximo/);
    assert.throws(() => IPv4.splitIntoCount(ip('10.0.0.0'), 24, 0), /entero mayor que 0/);
    assert.throws(() => IPv4.splitIntoCount(ip('10.0.0.0'), 24, 2.5), /entero mayor que 0/);
  });
});
