/**
 * 工具函数 — 无状态，纯计算
 */
const os = require('os');
const nmap = require('./nmap');

// 获取 Windows 友好名称
function getWindowsFriendlyName() {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-Command',
      'chcp 65001 >$null; [Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-CimInstance Win32_OperatingSystem).Caption'
    ]);
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => {
      const name = out.trim();
      resolve(name || `${os.type()} ${os.release()}`);
    });
    proc.on('error', () => resolve(`${os.type()} ${os.release()}`));
  });
}

// 获取本机所有 IPv4 地址
function getLocalIPs() {
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

// 合并本机 netstat 端口到 nmap 扫描结果
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
        hostname: os.hostname(),
        status: 'up',
        os: { name: await getWindowsFriendlyName(), accuracy: 100 },
        ports: [],
        portCount: 0,
      };
      result.hosts.push(localHost);
      result.stats.hostsUp = (result.stats.hostsUp || 0) + 1;
    } else {
      if (!localHost.os || localHost.os.accuracy < 90) {
        localHost.os = { name: await getWindowsFriendlyName(), accuracy: 100 };
      }
    }
    const existingKeys = new Set(localHost.ports.map(p => `${p.protocol}/${p.port}`));
    for (const p of localPorts) {
      if (!existingKeys.has(`${p.protocol}/${p.port}`)) {
        localHost.ports.push(p);
      }
    }
    localHost.ports.sort((a, b) => a.port - b.port);
    localHost.portCount = localHost.ports.length;
  } catch (e) {
    console.error('[utils] mergeLocalPorts 失败:', e.message);
  }
  return result;
}

module.exports = { getWindowsFriendlyName, getLocalIPs, ipInSubnet, mergeLocalPorts };
