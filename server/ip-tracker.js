/**
 * IP 追踪 & 归属地查询
 * 记录 netstat 中真实出现的 IP 和端口，查询公网 IP 归属地
 */
const state = require('./state');
const nmap = require('./nmap');

// 端口 → 应用协议映射
function guessAppProtocol(port) {
  return nmap.lookupService(port, 'tcp');
}

// 聚合连接，按协议统计
function buildProtoStats(conns) {
  const stats = {};
  for (const c of conns) {
    const proto = guessAppProtocol(c.dst_port);
    stats[proto] = (stats[proto] || 0) + 1;
  }
  return stats;
}

// 判断是否为公网 IP
function isPublicIP(ip) {
  if (!ip) return false;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const a = parts[0];
  if (a === 10) return false;
  if (a === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
  if (a === 192 && parts[1] === 168) return false;
  if (a === 127) return false;
  if (a === 0) return false;
  if (a === 169 && parts[1] === 254) return false;
  if (a >= 224 && a <= 239) return false;
  if (a >= 240) return false;
  if (a === 100 && parts[1] >= 64 && parts[1] <= 127) return false;
  if (a === 198 && (parts[1] === 18 || parts[1] === 19)) return false;
  return true;
}

// 判断是否为本地噪声（两端都是局域网）
function isLocalNoise(srcIP, dstIP) {
  if (srcIP === dstIP) return true;
  if (!isPublicIP(srcIP) && !isPublicIP(dstIP)) return true;
  return false;
}

// 查询单个 IP 归属地（ip-api.com，45次/分钟限制，硬超时 3s）
function lookupOneIP(ip) {
  return new Promise((resolve) => {
    if (!isPublicIP(ip)) { resolve(null); return; }
    if (state.ipGeoCache.has(ip) && state.ipGeoCache.get(ip) !== '__pending__') {
      resolve(state.ipGeoCache.get(ip));
      return;
    }
    state.ipGeoCache.set(ip, '__pending__');

    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (result !== '__pending__') state.ipGeoCache.set(ip, result);
      resolve(result === '__pending__' ? null : result);
    };

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
                  country: r.country || '', region: r.regionName || '',
                  city: r.city || '', isp: r.isp || '', org: r.org || '', as: r.as || '',
                };
                console.log(`[geo] ${ip} → ${info.country} ${info.region} ${info.city} ${info.isp}`);
                done(info);
              } else { done(null); }
            } catch (e) {
              console.error('[geo] JSON 解析失败:', e.message);
              done(null);
            }
          });
        }
      );
      req.on('error', (e) => { console.log(`[geo] ${ip} → ${e.message}`); done(null); });
      req.on('timeout', () => { req.destroy(); done(null); });
    } catch (e) {
      console.error('[geo] 请求创建失败:', e.message);
      done(null);
    }
  });
}

// 批量查询（每轮 3 并发 + 300ms 间隔）
let geoLookupQueue = [];
let geoLookupRunning = false;

function queueGeoLookups(ips) {
  const newIPs = ips.filter(ip => isPublicIP(ip) && !state.ipGeoCache.has(ip));
  if (newIPs.length === 0) return;
  geoLookupQueue.push(...newIPs);
  geoLookupQueue = [...new Set(geoLookupQueue)];
  if (!geoLookupRunning) drainGeoQueue();
}

async function drainGeoQueue() {
  geoLookupRunning = true;
  while (geoLookupQueue.length > 0) {
    const batch = geoLookupQueue.splice(0, 3).filter(ip => !state.ipGeoCache.has(ip));
    if (batch.length > 0) {
      await Promise.all(batch.map(ip => lookupOneIP(ip)));
    }
    if (geoLookupQueue.length > 0) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  geoLookupRunning = false;
}

// 记录 netstat 中真实出现的 IP 和端口
function recordConnections(conns) {
  const seen = new Set();
  const newIPs = [];
  for (const c of conns) {
    for (const ip of [c.src_ip, c.dst_ip]) {
      if (ip && !ip.startsWith('127.') && !ip.startsWith('0.') && !seen.has(ip)) {
        seen.add(ip);
        const port = c.dst_port || c.src_port;
        const proto = guessAppProtocol(port);

        if (!state.ipTracker[ip]) {
          state.ipTracker[ip] = { ip, last_seen: '', protocols: {}, ports: {} };
        }
        state.ipTracker[ip].last_seen = new Date().toLocaleString('zh-CN', { hour12: false });
        if (port && port > 0) {
          const portKey = String(port);
          state.ipTracker[ip].ports[portKey] = (state.ipTracker[ip].ports[portKey] || 0) + 1;
        }
        if (proto) {
          state.ipTracker[ip].protocols[proto] = (state.ipTracker[ip].protocols[proto] || 0) + 1;
        }
        if (isPublicIP(ip) && !state.ipGeoCache.has(ip)) {
          newIPs.push(ip);
        }
      }
    }
  }
  if (newIPs.length > 0) queueGeoLookups(newIPs);
}

module.exports = {
  guessAppProtocol, buildProtoStats, isPublicIP, isLocalNoise,
  lookupOneIP, queueGeoLookups, recordConnections,
};
