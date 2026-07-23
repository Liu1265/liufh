/**
 * nmap 扫描相关 API 路由
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const state = require('../state');
const nmap = require('../nmap');
const { broadcast } = require('../ws');
const { mergeLocalPorts } = require('../utils');

// 启动时加载历史扫描结果
try {
  if (fs.existsSync(state.RESULT_FILE)) {
    const saved = JSON.parse(fs.readFileSync(state.RESULT_FILE, 'utf-8'));
    state.scanState.lastResult = saved.result;
    state.scanState.lastScanTime = saved.time;
    state.scanState.network = saved.network || '';
  }
} catch (e) {
  console.error('[nmap-routes] 加载历史扫描结果失败:', e.message);
}

// 获取可用网络列表
router.get('/networks', (req, res) => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const networks = [];
  for (const [name, nets] of Object.entries(interfaces)) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) {
        const parts = net.address.split('.');
        networks.push({
          name, ip: net.address,
          cidr: `${parts[0]}.${parts[1]}.${parts[2]}.0/24`,
        });
      }
    }
  }
  res.json({ networks, preferred: nmap.getLocalNetwork() });
});

// 获取扫描状态 & 结果
router.get('/status', (req, res) => {
  res.json({
    scanning: state.scanState.scanning,
    progress: state.scanState.progress,
    lastScanTime: state.scanState.lastScanTime,
    network: state.scanState.network,
    result: state.scanState.lastResult,
  });
});

// 触发 Ping 扫描
router.post('/ping-sweep', async (req, res) => {
  if (state.scanState.scanning) {
    return res.status(409).json({ error: '已有扫描正在进行中' });
  }

  const target = (req.body && req.body.target) ? String(req.body.target).trim() : '';
  state.scanState.scanning = true;
  state.scanState.progress = 0;
  state.scanState.logs = [];
  state.scanState.network = target || nmap.getLocalNetwork();

  broadcast('nmap.status', { scanning: true, progress: 0, network: state.scanState.network });
  res.json({ ok: true, network: state.scanState.network });

  try {
    let result = await nmap.pingSweep(target, (evt) => {
      if (evt.type === 'host-found') {
        state.scanState.logs.push(`发现主机: ${evt.host}`);
        broadcast('nmap.log', { line: `发现主机: ${evt.host}` });
      } else if (evt.type === 'stdout') {
        state.scanState.logs.push(evt.line);
        if (state.scanState.logs.length > 500) state.scanState.logs.shift();
        broadcast('nmap.log', { line: evt.line });
      } else if (evt.type === 'complete') {
        state.scanState.progress = 100;
        broadcast('nmap.progress', { percent: 100, network: state.scanState.network });
      }
    });

    result = await mergeLocalPorts(result);

    for (const host of result.hosts) {
      if (!state.ipTracker[host.ip]) {
        state.ipTracker[host.ip] = {
          ip: host.ip, last_seen: new Date().toLocaleString('zh-CN', { hour12: false }),
          protocols: {}, ports: {},
        };
      }
      for (const p of (host.ports || [])) {
        const portKey = String(p.port);
        state.ipTracker[host.ip].ports[portKey] = (state.ipTracker[host.ip].ports[portKey] || 0) + 1;
      }
    }

    state.scanState.lastResult = result;
    state.scanState.lastScanTime = new Date().toISOString();
    state.scanState.scanning = false;
    fs.writeFileSync(state.RESULT_FILE, JSON.stringify({
      result, time: state.scanState.lastScanTime, network: result.network,
    }, null, 2));
    broadcast('nmap.result', result);
    broadcast('nmap.status', { scanning: false, progress: 100, network: state.scanState.network });
  } catch (err) {
    console.error('[nmap ping] 扫描失败:', err.message);
    state.scanState.scanning = false;
    broadcast('nmap.error', { message: err.message });
    broadcast('nmap.status', { scanning: false, progress: 0, network: state.scanState.network });
  }
});

// 触发端口扫描
router.post('/scan', async (req, res) => {
  if (state.scanState.scanning) {
    return res.status(409).json({ error: '已有扫描正在进行中' });
  }

  const target = (req.body && req.body.target) ? String(req.body.target).trim() : '';
  state.scanState.scanning = true;
  state.scanState.progress = 0;
  state.scanState.logs = [];
  state.scanState.network = target || nmap.getLocalNetwork();

  broadcast('nmap.status', { scanning: true, progress: 0, network: state.scanState.network });
  res.json({ ok: true, network: state.scanState.network });

  try {
    let result = await nmap.scan(target, (evt) => {
      if (evt.type === 'progress') {
        state.scanState.progress = evt.percent;
        broadcast('nmap.progress', { percent: evt.percent, network: state.scanState.network });
      } else if (evt.type === 'stdout') {
        state.scanState.logs.push(evt.line);
        if (state.scanState.logs.length > 500) state.scanState.logs.shift();
        broadcast('nmap.log', { line: evt.line });
      } else if (evt.type === 'complete') {
        state.scanState.progress = 100;
        broadcast('nmap.progress', { percent: 100, network: state.scanState.network });
      }
    });

    result = await mergeLocalPorts(result);

    for (const host of result.hosts) {
      if (!state.ipTracker[host.ip]) {
        state.ipTracker[host.ip] = {
          ip: host.ip, last_seen: new Date().toLocaleString('zh-CN', { hour12: false }),
          protocols: {}, ports: {},
        };
      }
      for (const p of (host.ports || [])) {
        const portKey = String(p.port);
        state.ipTracker[host.ip].ports[portKey] = (state.ipTracker[host.ip].ports[portKey] || 0) + 1;
      }
    }

    state.scanState.lastResult = result;
    state.scanState.lastScanTime = new Date().toISOString();
    state.scanState.scanning = false;

    fs.writeFileSync(state.RESULT_FILE, JSON.stringify({
      result, time: state.scanState.lastScanTime, network: result.network,
    }, null, 2));

    broadcast('nmap.result', result);
    broadcast('nmap.status', { scanning: false, progress: 100, network: state.scanState.network });
  } catch (err) {
    console.error('[nmap] 扫描失败:', err.message);
    state.scanState.scanning = false;
    state.scanState.progress = 0;
    broadcast('nmap.error', { message: err.message });
    broadcast('nmap.status', { scanning: false, progress: 0, network: state.scanState.network });
  }
});

// 取消扫描
router.post('/cancel', (req, res) => {
  if (!state.scanState.scanning) {
    return res.json({ ok: false, message: '没有正在进行的扫描' });
  }
  const cancelled = nmap.cancelScan();
  if (cancelled) {
    state.scanState.scanning = false;
    state.scanState.progress = 0;
    broadcast('nmap.status', { scanning: false, progress: 0, network: state.scanState.network });
    broadcast('nmap.log', { line: '⚠ 扫描已被用户取消' });
    res.json({ ok: true });
  } else {
    res.json({ ok: false, message: '无法取消（进程可能已退出）' });
  }
});

// 获取扫描日志
router.get('/logs', (req, res) => {
  res.json({ logs: state.scanState.logs });
});

// 获取某设备的端口详情
router.get('/device/:ip', (req, res) => {
  const ip = String(req.params.ip || '').trim();
  if (!ip || !/^[\d.]+$/.test(ip)) {
    return res.status(400).json({ error: '无效的 IP 地址' });
  }
  if (!state.scanState.lastResult) {
    return res.status(404).json({ error: '无扫描结果' });
  }
  const host = state.scanState.lastResult.hosts.find(h => h.ip === ip);
  if (!host) {
    return res.status(404).json({ error: '未找到该设备' });
  }
  res.json(host);
});

// 端口对齐数据
router.get('/port-align', (req, res) => {
  if (!state.scanState.lastResult || !state.scanState.lastResult.hosts) {
    return res.status(404).json({ error: '无扫描结果' });
  }

  const hosts = state.scanState.lastResult.hosts;
  const portMap = new Map();
  for (const host of hosts) {
    for (const p of host.ports) {
      const key = `${p.protocol}/${p.port}`;
      if (!portMap.has(key)) {
        portMap.set(key, { protocol: p.protocol, port: p.port, service: p.service, hosts: {} });
      }
      portMap.get(key).hosts[host.ip] = { state: p.state, product: p.product, version: p.version };
    }
  }

  const ports = Array.from(portMap.values()).sort((a, b) => {
    if (a.protocol !== b.protocol) return a.protocol.localeCompare(b.protocol);
    return a.port - b.port;
  });

  res.json({
    network: state.scanState.network,
    hosts: hosts.map(h => ({ ip: h.ip, hostname: h.hostname, mac: h.mac, status: h.status, os: h.os })),
    ports,
  });
});

module.exports = router;
