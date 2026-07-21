/**
 * 局域网流量监控 + nmap 扫描 后端服务器
 * REST API (端口 3000) + WebSocket (端口 3001)
 */
const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const nmap = require('./nmap');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ port: 3001 });

app.use(cors());
app.use(express.json());

// ==================== 静态文件服务 ====================
// 生产环境部署前端 dist
const distPath = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// ==================== WebSocket 连接管理 ====================
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] 客户端连接，当前连接数: ${wsClients.size}`);
  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] 客户端断开，当前连接数: ${wsClients.size}`);
  });
  ws.on('error', () => wsClients.delete(ws));
});

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

// 获取 Windows 友好名称（如 "Windows 11 家庭中文版"）
function getWindowsFriendlyName() {
  return new Promise((resolve) => {
    const proc = spawnAsync('powershell.exe', [
      '-NoProfile', '-Command',
      'chcp 65001 >\$null; [Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-CimInstance Win32_OperatingSystem).Caption'
    ]);
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => {
      const name = out.trim();
      resolve(name || `${require('os').type()} ${require('os').release()}`);
    });
    proc.on('error', () => resolve(`${require('os').type()} ${require('os').release()}`));
  });
}

// 获取本机所有 IP
function getLocalIPs() {
  const os = require('os');
  const ips = [];
  for (const [, nets] of Object.entries(os.networkInterfaces())) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

// 判断 IP 是否在 CIDR 网段内
function ipInSubnet(ip, cidr) {
  const [subnet, bits] = cidr.split('/');
  const ipNum = ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0);
  const subnetNum = subnet.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0);
  const mask = ~(2 ** (32 - parseInt(bits)) - 1);
  return (ipNum & mask) === (subnetNum & mask);
}

// 合并本机 netstat 端口到扫描结果
async function mergeLocalPorts(result) {
  try {
    const localIPs = getLocalIPs();
    const localIP = localIPs.find(ip => result.network && ipInSubnet(ip, result.network));
    if (!localIP) return result;
    const localPorts = await nmap.getLocalPorts();
    let localHost = result.hosts.find(h => h.ip === localIP);
    if (!localHost) {
      localHost = {
        ip: localIP,
        mac: '',
        hostname: require('os').hostname(),
        status: 'up',
        os: { name: await getWindowsFriendlyName(), accuracy: 100 },
        ports: [],
        portCount: 0,
      };
      result.hosts.push(localHost);
      result.stats.hostsUp = (result.stats.hostsUp || 0) + 1;
    } else {
      // 更新 OS 信息（不管之前有没有）
      if (!localHost.os || localHost.os.accuracy < 90) {
        localHost.os = { name: await getWindowsFriendlyName(), accuracy: 100 };
      }
    }
    // 合并端口
    const existingKeys = new Set(localHost.ports.map(p => `${p.protocol}/${p.port}`));
    for (const p of localPorts) {
      if (!existingKeys.has(`${p.protocol}/${p.port}`)) {
        localHost.ports.push(p);
      }
    }
    localHost.ports.sort((a, b) => a.port - b.port);
    localHost.portCount = localHost.ports.length;
  } catch (e) { /* ignore */ }
  return result;
}

// ==================== nmap 扫描状态 ====================
let scanState = {
  scanning: false,
  lastResult: null,
  lastScanTime: null,
  progress: 0,
  network: '',
  logs: [],
};

// 加载上次的扫描结果（如果存在）
const RESULT_FILE = path.join(__dirname, 'scan_results.json');
try {
  if (fs.existsSync(RESULT_FILE)) {
    const saved = JSON.parse(fs.readFileSync(RESULT_FILE, 'utf-8'));
    scanState.lastResult = saved.result;
    scanState.lastScanTime = saved.time;
    scanState.network = saved.network || '';
  }
} catch (e) { /* ignore */ }

// ==================== REST API ====================

// 获取可用网络列表
app.get('/api/nmap/networks', (req, res) => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const networks = [];
  for (const [name, nets] of Object.entries(interfaces)) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) {
        const parts = net.address.split('.');
        networks.push({
          name,
          ip: net.address,
          cidr: `${parts[0]}.${parts[1]}.${parts[2]}.0/24`,
        });
      }
    }
  }
  res.json({ networks, preferred: nmap.getLocalNetwork() });
});

// 获取扫描状态 & 结果
app.get('/api/nmap/status', (req, res) => {
  res.json({
    scanning: scanState.scanning,
    progress: scanState.progress,
    lastScanTime: scanState.lastScanTime,
    network: scanState.network,
    result: scanState.lastResult,
  });
});

// 触发 Ping 扫描（快速发现主机）
app.post('/api/nmap/ping-sweep', async (req, res) => {
  if (scanState.scanning) {
    return res.status(409).json({ error: '已有扫描正在进行中' });
  }

  const target = req.body.target || '';
  scanState.scanning = true;
  scanState.progress = 0;
  scanState.logs = [];
  scanState.network = target || nmap.getLocalNetwork();

  broadcast('nmap.status', { scanning: true, progress: 0, network: scanState.network });
  res.json({ ok: true, network: scanState.network });

  try {
    let result = await nmap.pingSweep(target, (evt) => {
      if (evt.type === 'host-found') {
        scanState.logs.push(`发现主机: ${evt.host}`);
        broadcast('nmap.log', { line: `发现主机: ${evt.host}` });
      } else if (evt.type === 'stdout') {
        scanState.logs.push(evt.line);
        if (scanState.logs.length > 500) scanState.logs.shift();
        broadcast('nmap.log', { line: evt.line });
      } else if (evt.type === 'complete') {
        scanState.progress = 100;
        broadcast('nmap.progress', { percent: 100, network: scanState.network });
      }
    });

    // 合并本机端口和OS
    result = await mergeLocalPorts(result);

    // 将扫描发现的局域网主机加入 ipTracker（含端口）
    for (const host of result.hosts) {
      if (!ipTracker[host.ip]) {
        ipTracker[host.ip] = { ip: host.ip, last_seen: new Date().toLocaleString('zh-CN', { hour12: false }), protocols: {}, ports: {} };
      }
      // 将 nmap 扫到的端口也录入
      for (const p of (host.ports || [])) {
        const portKey = String(p.port);
        ipTracker[host.ip].ports[portKey] = (ipTracker[host.ip].ports[portKey] || 0) + 1;
      }
    }

    scanState.lastResult = result;
    scanState.lastScanTime = new Date().toISOString();
    scanState.scanning = false;
    fs.writeFileSync(RESULT_FILE, JSON.stringify({
      result, time: scanState.lastScanTime, network: result.network,
    }, null, 2));
    broadcast('nmap.result', result);
    broadcast('nmap.status', { scanning: false, progress: 100, network: scanState.network });
  } catch (err) {
    console.error('[nmap ping] 扫描失败:', err.message);
    scanState.scanning = false;
    broadcast('nmap.error', { message: err.message });
    broadcast('nmap.status', { scanning: false, progress: 0, network: scanState.network });
  }
});

// 触发扫描
app.post('/api/nmap/scan', async (req, res) => {
  if (scanState.scanning) {
    return res.status(409).json({ error: '已有扫描正在进行中' });
  }

  const target = req.body.target || '';

  scanState.scanning = true;
  scanState.progress = 0;
  scanState.logs = [];
  scanState.network = target || nmap.getLocalNetwork();

  broadcast('nmap.status', {
    scanning: true,
    progress: 0,
    network: scanState.network,
  });

  res.json({ ok: true, network: scanState.network });

  try {
    let result = await nmap.scan(target, (evt) => {
      if (evt.type === 'progress') {
        scanState.progress = evt.percent;
        broadcast('nmap.progress', { percent: evt.percent, network: scanState.network });
      } else if (evt.type === 'stdout') {
        scanState.logs.push(evt.line);
        if (scanState.logs.length > 500) scanState.logs.shift();
        broadcast('nmap.log', { line: evt.line });
      } else if (evt.type === 'complete') {
        scanState.progress = 100;
        broadcast('nmap.progress', { percent: 100, network: scanState.network });
      }
    });

    // 合并本机端口（nmap 扫本机受防火墙限制）
    result = await mergeLocalPorts(result);

    // 将扫描发现的局域网主机加入 ipTracker（含端口）
    for (const host of result.hosts) {
      if (!ipTracker[host.ip]) {
        ipTracker[host.ip] = {
          ip: host.ip,
          last_seen: new Date().toLocaleString('zh-CN', { hour12: false }),
          protocols: {},
          ports: {},
        };
      }
      // 将 nmap 扫到的端口也录入
      for (const p of (host.ports || [])) {
        const portKey = String(p.port);
        ipTracker[host.ip].ports[portKey] = (ipTracker[host.ip].ports[portKey] || 0) + 1;
      }
    }

    scanState.lastResult = result;
    scanState.lastScanTime = new Date().toISOString();
    scanState.scanning = false;

    // 保存结果
    fs.writeFileSync(RESULT_FILE, JSON.stringify({
      result,
      time: scanState.lastScanTime,
      network: result.network,
    }, null, 2));

    broadcast('nmap.result', result);
    broadcast('nmap.status', {
      scanning: false,
      progress: 100,
      network: scanState.network,
    });

  } catch (err) {
    console.error('[nmap] 扫描失败:', err.message);
    scanState.scanning = false;
    scanState.progress = 0;
    broadcast('nmap.error', { message: err.message });
    broadcast('nmap.status', { scanning: false, progress: 0, network: scanState.network });
  }
});

// 取消扫描
app.post('/api/nmap/cancel', (req, res) => {
  if (!scanState.scanning) {
    return res.json({ ok: false, message: '没有正在进行的扫描' });
  }
  const cancelled = nmap.cancelScan();
  if (cancelled) {
    scanState.scanning = false;
    scanState.progress = 0;
    broadcast('nmap.status', { scanning: false, progress: 0, network: scanState.network });
    broadcast('nmap.log', { line: '⚠ 扫描已被用户取消' });
    res.json({ ok: true });
  } else {
    res.json({ ok: false, message: '无法取消（进程可能已退出）' });
  }
});

// 获取扫描日志
app.get('/api/nmap/logs', (req, res) => {
  res.json({ logs: scanState.logs });
});

// 获取某个设备的端口详情
app.get('/api/nmap/device/:ip', (req, res) => {
  if (!scanState.lastResult) {
    return res.status(404).json({ error: '无扫描结果' });
  }
  const host = scanState.lastResult.hosts.find(h => h.ip === req.params.ip);
  if (!host) {
    return res.status(404).json({ error: '未找到该设备' });
  }
  res.json(host);
});

// 端口对齐数据（把所有设备的端口放在一起对比）
app.get('/api/nmap/port-align', (req, res) => {
  if (!scanState.lastResult || !scanState.lastResult.hosts) {
    return res.status(404).json({ error: '无扫描结果' });
  }

  const hosts = scanState.lastResult.hosts;

  // 收集所有出现的端口
  const portMap = new Map();
  for (const host of hosts) {
    for (const p of host.ports) {
      const key = `${p.protocol}/${p.port}`;
      if (!portMap.has(key)) {
        portMap.set(key, {
          protocol: p.protocol,
          port: p.port,
          service: p.service,
          hosts: {},  // ip -> { state, product, version }
        });
      }
      portMap.get(key).hosts[host.ip] = {
        state: p.state,
        product: p.product,
        version: p.version,
      };
    }
  }

  // 排序
  const ports = Array.from(portMap.values()).sort((a, b) => {
    if (a.protocol !== b.protocol) return a.protocol.localeCompare(b.protocol);
    return a.port - b.port;
  });

  res.json({
    network: scanState.network,
    hosts: hosts.map(h => ({ ip: h.ip, hostname: h.hostname, mac: h.mac, status: h.status, os: h.os })),
    ports,
  });
});

// ==================== IP 与端口追踪（仅真实数据，无模拟） ====================
const ipTracker = {};  // { ip: { last_seen, protocols: {}, ports: { port: hits } } }
let alertCount = 0;
let totalBytesTransferred = 0;  // 累计真实吞吐量（bytes）

// 记录 netstat 中真实出现的 IP 和端口（不生成任何模拟数据）
function recordConnections(conns) {
  const seen = new Set();
  const newIPs = [];
  for (const c of conns) {
    for (const ip of [c.src_ip, c.dst_ip]) {
      if (ip && !ip.startsWith('127.') && !ip.startsWith('0.') && !seen.has(ip)) {
        seen.add(ip);
        const port = c.dst_port || c.src_port;
        const proto = guessAppProtocol(port);

        if (!ipTracker[ip]) {
          ipTracker[ip] = { ip, last_seen: '', protocols: {}, ports: {} };
        }
        ipTracker[ip].last_seen = new Date().toLocaleString('zh-CN', { hour12: false });
        if (port && port > 0) {
          const portKey = String(port);
          ipTracker[ip].ports[portKey] = (ipTracker[ip].ports[portKey] || 0) + 1;
        }
        if (proto) {
          ipTracker[ip].protocols[proto] = (ipTracker[ip].protocols[proto] || 0) + 1;
        }
        // 新出现的公网 IP 自动触发归属地查询
        if (isPublicIP(ip) && !ipGeoCache.has(ip)) {
          newIPs.push(ip);
        }
      }
    }
  }
  if (newIPs.length > 0) queueGeoLookups(newIPs);
}

// ==================== IP 归属地查询（缓存） ====================
const ipGeoCache = new Map();  // ip -> { country, region, city, isp, org }

// 判断是否为公网 IP（排除所有私有、保留、多播地址）
function isPublicIP(ip) {
  if (!ip) return false;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const a = parts[0];
  // RFC 1918 私有地址
  if (a === 10) return false;
  if (a === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
  if (a === 192 && parts[1] === 168) return false;
  // 回环 127.0.0.0/8
  if (a === 127) return false;
  // 0.0.0.0/8
  if (a === 0) return false;
  // 链路本地 169.254.0.0/16 (APIPA)
  if (a === 169 && parts[1] === 254) return false;
  // 多播 224.0.0.0/4
  if (a >= 224 && a <= 239) return false;
  // 未来使用/保留 240.0.0.0/4
  if (a >= 240) return false;
  // CGNAT 100.64.0.0/10
  if (a === 100 && parts[1] >= 64 && parts[1] <= 127) return false;
  // 基准测试 198.18.0.0/15
  if (a === 198 && (parts[1] === 18 || parts[1] === 19)) return false;
  return true;
}

// 判断是否为本地噪声（仅局域网内部通信，不涉及外部网络）
function isLocalNoise(srcIP, dstIP) {
  // 源和目标相同（自己连自己）
  if (srcIP === dstIP) return true;
  // 两端都是非公网（局域网 ↔ 局域网、链路本地、多播等）
  if (!isPublicIP(srcIP) && !isPublicIP(dstIP)) return true;
  return false;
}

// 查询单个 IP 归属地（ip-api.com 免费 API，45次/分钟，硬超时 3s）
function lookupOneIP(ip) {
  return new Promise((resolve) => {
    if (!isPublicIP(ip)) { resolve(null); return; }
    if (ipGeoCache.has(ip) && ipGeoCache.get(ip) !== '__pending__') {
      resolve(ipGeoCache.get(ip));
      return;
    }
    ipGeoCache.set(ip, '__pending__');

    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (result !== '__pending__') ipGeoCache.set(ip, result);
      resolve(result === '__pending__' ? null : result);
    };

    // 硬超时 3s
    const hardTimer = setTimeout(() => {
      console.log(`[geo] ${ip} → 超时`);
      done(null);
    }, 3000);

    try {
      const req = require('http').get(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN`,
        { timeout: 4000 },
        (res) => {
          const chunks = [];
          res.on('data', d => chunks.push(d));
          res.on('end', () => {
            try {
              const r = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if (r.status === 'success') {
                const info = {
                  country: r.country || '',
                  region: r.regionName || '',
                  city: r.city || '',
                  isp: r.isp || '',
                  org: r.org || '',
                  as: r.as || '',
                };
                console.log(`[geo] ${ip} → ${info.country} ${info.region} ${info.city} ${info.isp}`);
                done(info);
              } else {
                done(null);
              }
            } catch (e) {
              done(null);
            }
          });
        }
      );
      req.on('error', (e) => { console.log(`[geo] ${ip} → ${e.message}`); done(null); });
      req.on('timeout', () => { req.destroy(); done(null); });
    } catch (e) {
      done(null);
    }
  });
}

// 批量查询（每轮 3 并发 + 300ms 间隔，~10个/秒，控制在 45/min 以内）
let geoLookupQueue = [];
let geoLookupRunning = false;

function queueGeoLookups(ips) {
  const newIPs = ips.filter(ip => isPublicIP(ip) && !ipGeoCache.has(ip));
  if (newIPs.length === 0) return;
  geoLookupQueue.push(...newIPs);
  geoLookupQueue = [...new Set(geoLookupQueue)];
  if (!geoLookupRunning) drainGeoQueue();
}

async function drainGeoQueue() {
  geoLookupRunning = true;
  while (geoLookupQueue.length > 0) {
    // 每轮取 3 个并发查询
    const batch = geoLookupQueue.splice(0, 3).filter(ip => !ipGeoCache.has(ip));
    if (batch.length > 0) {
      await Promise.all(batch.map(ip => lookupOneIP(ip)));
    }
    if (geoLookupQueue.length > 0) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  geoLookupRunning = false;
}

// API: 动态概览（活跃设备 = nmap 扫描到的局域网主机数）
app.get('/api/summary', (req, res) => {
  const lanHosts = scanState.lastResult?.hosts?.length || 0;
  res.json({
    today_total: totalBytesTransferred,
    active_devices: lanHosts,
    current_connections: connCache.length,
    alert_count: alertCount,
  });
});

app.get('/api/protocol-stats', (req, res) => {
  const stats = buildProtoStats(connCache);
  res.json(Object.entries(stats).map(([name, count]) => ({
    app_protocol: name,
    name,
    count,
    total_size: count * 1500, // 每连接估算 1500 字节
    percent: 0  // 前端会重新计算
  })));
});

app.get('/api/alerts', (req, res) => {
  res.json(alertLog.slice(-50).map(a => ({
    alert_time: a.time,
    alert_type: a.level === 'warning' ? 'threshold' : 'anomaly',
    ip: a.ip || '',
    message: a.message,
  })));
});

// API: IP-端口映射（基于真实 netstat 观测数据，含 IP 归属地）
app.get('/api/ip-ports', (req, res) => {
  const list = Object.values(ipTracker)
    .filter(ip => ip.ports && Object.keys(ip.ports).length > 0)
    .map(ip => {
      const cached = ipGeoCache.get(ip.ip);
      let geo = null, geoState = 'none';
      if (cached === '__pending__') { geoState = 'pending'; }
      else if (cached === null) { geoState = 'failed'; }
      else if (cached) { geo = cached; geoState = 'ok'; }
      return {
        ip: ip.ip,
        last_seen: ip.last_seen,
        protocols: ip.protocols,
        geo,
        geoState,
        isPublic: isPublicIP(ip.ip),
        ports: Object.entries(ip.ports)
          .map(([port, hits]) => ({
            port: parseInt(port),
            hits,
            service: guessAppProtocol(parseInt(port)),
          }))
          .sort((a, b) => b.hits - a.hits),
      };
    })
    .sort((a, b) => {
      const aMax = Math.max(0, ...Object.values(a.ports || {}).map(p => p.hits || 0));
      const bMax = Math.max(0, ...Object.values(b.ports || {}).map(p => p.hits || 0));
      return bMax - aMax;
    });
  res.json(list);
});

// 告警配置
const alertConfig = { thresholdMbps: 5, enabled: true, notifySound: false };

// 异常检测：连接数突然飙升
let avgConnCount = 0, connSamples = 0;
function detectAnomaly() {
  const currentCount = connCache.length;
  if (connSamples > 10 && currentCount > avgConnCount * 2.5 && currentCount > 20) {
    return `连接数异常飙升: ${currentCount} (平均: ${Math.round(avgConnCount)})`;
  }
  // 检测端口扫描特征：同一远程IP短时间内访问多个不同端口
  const ipPorts = {};
  for (const c of connCache) {
    if (c.dst_ip.startsWith('127.') || c.dst_ip.startsWith('0.')) continue;
    if (!ipPorts[c.dst_ip]) ipPorts[c.dst_ip] = new Set();
    ipPorts[c.dst_ip].add(c.dst_port);
  }
  for (const [ip, ports] of Object.entries(ipPorts)) {
    if (ports.size >= 8) {
      return `可疑端口扫描: ${ip} 被访问 ${ports.size} 个不同端口`;
    }
  }
  return null;
}

// 每3秒更新连接统计（用于异常基线）
setInterval(() => {
  if (connCache.length > 0) {
    avgConnCount = (avgConnCount * connSamples + connCache.length) / (connSamples + 1);
    connSamples++;
  }
}, 10000);
app.get('/api/alerts/config', (req, res) => res.json(alertConfig));
app.post('/api/alerts/config', (req, res) => {
  const { thresholdMbps, enabled } = req.body;
  if (thresholdMbps !== undefined) alertConfig.thresholdMbps = Number(thresholdMbps);
  if (enabled !== undefined) alertConfig.enabled = enabled;
  res.json(alertConfig);
});

// 告警日志
const alertLog = [];
setInterval(() => {
  if (!alertConfig.enabled) return;
  // 1. 流量阈值告警
  if (prevDown > alertConfig.thresholdMbps) {
    const msg = `流量峰值: ${prevDown.toFixed(1)} Mbps (阈值: ${alertConfig.thresholdMbps} Mbps)`;
    alertLog.push({ time: new Date().toISOString(), message: msg, level: 'warning' });
    if (alertLog.length > 200) alertLog.shift();
    alertCount++;
    broadcast('alert', { time: new Date().toISOString(), type: 'threshold', ip: '', message: msg });
  }
  // 2. 异常行为检测
  const anomalyMsg = detectAnomaly();
  if (anomalyMsg) {
    alertLog.push({ time: new Date().toISOString(), message: anomalyMsg, level: 'danger' });
    if (alertLog.length > 200) alertLog.shift();
    alertCount++;
    broadcast('alert', { time: new Date().toISOString(), type: 'anomaly', ip: '', message: anomalyMsg });
  }
}, 15000);

// 生产环境 SPA fallback
app.get('*', (req, res) => {
  const indexFile = path.join(distPath, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
});

// ==================== 启动 ====================
const PORT = 3000;
// ==================== 真实流量采集 ====================
const { spawn: spawnAsync } = require('child_process');
const LAN_SUBNET = nmap.getLocalNetwork().replace('.0/24', '');
let prevDown = 0, prevUp = 0;

// 获取活动网卡名
function getActiveInterface() {
  return new Promise((resolve) => {
    const proc = spawnAsync('powershell.exe', [
      '-NoProfile', '-Command',
      `(Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -First 1).Name`
    ]);
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => resolve(out.trim()));
    proc.on('error', () => resolve(''));
  });
}

// 获取真实网卡流量计数器（分下载和上传）
function getRealThroughput() {
  return new Promise((resolve) => {
    const proc = spawnAsync('powershell.exe', [
      '-NoProfile', '-Command',
      `$samples = Get-Counter -Counter "\\Network Interface(*)\\Bytes Received/sec","\\Network Interface(*)\\Bytes Sent/sec" -SampleInterval 1 -MaxSamples 1 | Select-Object -ExpandProperty CounterSamples; $rx = ($samples | Where-Object {$_.Path -like "*Received*" -and ($_.Path -like "*wi-fi*" -or $_.Path -like "*wlan*" -or $_.Path -like "*以太网*" -or $_.Path -like "*ethernet*")} | Select-Object -First 1).CookedValue; $tx = ($samples | Where-Object {$_.Path -like "*Sent*" -and ($_.Path -like "*wi-fi*" -or $_.Path -like "*wlan*" -or $_.Path -like "*以太网*" -or $_.Path -like "*ethernet*")} | Select-Object -First 1).CookedValue; Write-Output "$rx $tx"`
    ]);
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => {
      const parts = out.trim().split(/\s+/);
      const rxBytes = parseFloat(parts[0]) || 0;  // 下载
      const txBytes = parseFloat(parts[1]) || 0;  // 上传
      resolve({
        bytesPerSec: rxBytes + txBytes,
        downMbps: rxBytes * 8 / 1e6,  // Bytes Received → 下载
        upMbps: txBytes * 8 / 1e6,    // Bytes Sent → 上传
      });
    });
    proc.on('error', () => resolve({ bytesPerSec: 0, downMbps: 0, upMbps: 0 }));
  });
}

// 获取真实连接列表（过滤纯本地回环和监听端口噪声）
function getRealConnections() {
  return new Promise((resolve) => {
    const proc = spawnAsync('netstat', ['-ano']);
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => {
      const conns = [];
      const lines = out.split('\n');
      for (const line of lines) {
        const match = line.match(/^\s*(TCP|UDP)\s+(\d+\.\d+\.\d+\.\d+):(\d+)\s+(\d+\.\d+\.\d+\.\d+):(\d+)\s+(\w+)/);
        if (match) {
          const srcIP = match[2];
          const dstIP = match[4];
          // 过滤纯本机回环
          if (srcIP === '127.0.0.1' || dstIP === '127.0.0.1') continue;
          // 过滤监听端口（目标为 0.0.0.0，无实际远程通信）
          if (dstIP === '0.0.0.0' || srcIP === '0.0.0.0') continue;
          const dstPort = parseInt(match[5]);
          conns.push({
            protocol: match[1],
            src_ip: srcIP,
            src_port: parseInt(match[3]),
            dst_ip: dstIP,
            dst_port: dstPort,
            state: match[6],
          });
        }
      }
      resolve(conns);
    });
    proc.on('error', () => resolve([]));
  });
}

// 端口 → 应用协议映射（基于 nmap-services 数据库，19941条）
function guessAppProtocol(port) {
  return nmap.lookupService(port, 'tcp');
}

// 聚合 netstat 连接，按协议统计
function buildProtoStats(conns) {
  const stats = {};
  for (const c of conns) {
    const proto = guessAppProtocol(c.dst_port);
    stats[proto] = (stats[proto] || 0) + 1;
  }
  return stats;
}

// 每 3 秒获取真实连接，更新协议分布 & 数据包
let connCache = [];
setInterval(async () => {
  try {
    const conns = await getRealConnections();
    connCache = conns;
    recordConnections(conns);

    // 计算真实协议分布并推送（用于饼图）
    const protoStats = buildProtoStats(conns);
    broadcast('protoStats', protoStats);
  } catch (e) { /* ignore */ }
}, 3000);

// 每 1.5 秒获取真实网卡流量并推送（用于吞吐量曲线）
setInterval(async () => {
  try {
    const { bytesPerSec, downMbps, upMbps } = await getRealThroughput();
    if (bytesPerSec <= 0) return;
    prevDown = downMbps; prevUp = upMbps;

    // 累计真实吞吐量（bytes）
    totalBytesTransferred += bytesPerSec * 1.5;

    // 筛选对外连接：过滤本地噪声，去重，最多 12 条
    const seen = new Set();
    const meaningfulConns = [];
    for (const c of connCache) {
      if (isLocalNoise(c.src_ip, c.dst_ip)) continue;
      const key = `${c.src_ip}:${c.dst_ip}:${c.dst_port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      meaningfulConns.push(c);
      if (meaningfulConns.length >= 12) break;
    }

    const packets = meaningfulConns.map(c => ({
      captured_at: new Date().toLocaleString('zh-CN', { hour12: false }),
      src_ip: c.src_ip,
      dst_ip: c.dst_ip,
      protocol: c.protocol,
      app_protocol: guessAppProtocol(c.dst_port),
      src_port: c.src_port,
      dst_port: c.dst_port,
    }));
    // 广播数据包列表（仅对外连接）
    broadcast('packets', packets);
    // 广播实时吞吐量（图表用）
    broadcast('throughput', {
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      downMbps: Math.round(downMbps * 100) / 100,
      upMbps: Math.round(upMbps * 100) / 100,
    });
  } catch (e) { /* ignore */ }
}, 1500);

server.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`  局域网流量监控系统`);
  console.log(`  打开浏览器访问: http://localhost:${PORT}`);
  console.log(`  本机网段: ${nmap.getLocalNetwork()}`);
  console.log(`========================================`);
});
