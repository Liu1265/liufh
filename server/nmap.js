/**
 * nmap 扫描模块
 * 调用系统 nmap 对局域网进行扫描，解析 XML 输出为 JSON
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// nmap 安装路径（尝试多个常见位置）
const NMAP_PATHS = process.platform === 'win32'
  ? ['E:\\Nmap\\nmap.exe', 'C:\\Program Files (x86)\\Nmap\\nmap.exe', 'C:\\Program Files\\Nmap\\nmap.exe']
  : ['nmap'];

let NMAP_EXE = 'nmap';
for (const p of NMAP_PATHS) {
  if (fs.existsSync(p)) {
    NMAP_EXE = `"${p}"`;
    console.log(`[nmap] 找到 nmap: ${p}`);
    break;
  }
}
console.log(`[nmap] 使用路径: ${NMAP_EXE}`);

const TMP_DIR = path.join(__dirname, 'tmp');

// 确保临时目录存在
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// 追踪当前扫描进程，用于取消
let currentProc = null;
let currentMode = '';  // 'scan' | 'ping'

/**
 * 取消正在进行的扫描
 */
function cancelScan() {
  if (currentProc) {
    try {
      if (process.platform === 'win32') {
        require('child_process').execSync(`taskkill /F /T /PID ${currentProc.pid} 2>nul`, { stdio: 'ignore' });
      } else {
        currentProc.kill('SIGTERM');
      }
    } catch (e) { /* ignore */ }
    currentProc = null;
    currentMode = '';
    return true;
  }
  return false;
}

/**
 * 获取本机局域网网段
 */
function getLocalNetwork() {
  const interfaces = os.networkInterfaces();
  // 优先选择 WLAN/WiFi，其次是以太网，最后是其他
  const priority = [];
  const others = [];
  for (const [name, nets] of Object.entries(interfaces)) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) {
        const parts = net.address.split('.');
        const cidr = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
        const lower = name.toLowerCase();
        if (lower.includes('wlan') || lower.includes('wi-fi') || lower.includes('无线')) {
          priority.unshift({ name, cidr }); // 最优先
        } else if (lower.includes('以太') || lower.includes('ether')) {
          priority.push({ name, cidr });
        } else {
          others.push({ name, cidr });
        }
      }
    }
  }
  const candidates = [...priority, ...others];
  if (candidates.length > 0) {
    console.log(`[nmap] 选择网段: ${candidates[0].cidr} (接口: ${candidates[0].name})`);
    return candidates[0].cidr;
  }
  return '192.168.1.0/24'; // 默认
}

/**
 * 执行 nmap 扫描（实时输出进度）
 * @param {string} target - 扫描目标（网段或IP）
 * @param {function} onProgress - 进度回调
 * @returns {Promise<object>} 扫描结果
 */
function scan(target, onProgress) {
  return new Promise((resolve, reject) => {
    const network = target || getLocalNetwork();
    const xmlFile = path.join(TMP_DIR, `nmap-${Date.now()}.xml`);

    onProgress && onProgress({ type: 'start', network, xmlFile });

    // nmap 快速扫描参数：
    // -sS: SYN 扫描（半开扫描，速度快）
    // -sV: 服务版本检测
    // --top-ports 100: 扫描最常见的100个端口（覆盖95%的服务，大幅提速）
    // -T5: 速度级别（激进，适用于局域网）
    // --max-retries 1: 最多重试1次
    // --min-rate 500: 保证最低发包速率 500/秒
    // --host-timeout 30s: 单主机超时 30 秒
    // -oX: XML 输出
    const args = [
      '-sS',
      '-sV',
      '--top-ports', '100',
      '-T5',
      '--max-retries', '1',
      '--min-rate', '500',
      '--host-timeout', '30s',
      '-oX', xmlFile,
      network
    ];

    // Windows 的 cmd /c 处理
    const cmd = `${NMAP_EXE} ${args.join(' ')}`;
    console.log(`[nmap] 执行命令: ${cmd}`);
    onProgress && onProgress({ type: 'command', cmd });

    const proc = spawn(NMAP_EXE, args, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    currentProc = proc;
    currentMode = 'scan';

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      // latin1 无损解码，避免 GBK 字节被 UTF-8 解析报错
      const text = data.toString('latin1');
      stdout += text;
      // 解析进度（只匹配 ASCII 模式，不受编码影响）
      const lines = text.split('\n').filter(Boolean);
      for (const line of lines) {
        onProgress && onProgress({ type: 'stdout', line });
        const pctMatch = line.match(/About\s+(\d+\.?\d*)%\s+done/);
        if (pctMatch) {
          onProgress && onProgress({ type: 'progress', percent: parseFloat(pctMatch[1]) });
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString('latin1');
    });

    proc.on('close', (code) => {
      currentProc = null;
      currentMode = '';
      if (code !== 0 && code !== 1) {  // 1 = 被取消
        console.error(`[nmap] 扫描退出码: ${code}`);
        console.error(`[nmap] stderr: ${stderr}`);
      }
      onProgress && onProgress({ type: 'complete', exitCode: code });

      try {
        const result = parseXML(xmlFile);
        result.network = network;
        result.scanTime = new Date().toISOString();
        resolve(result);
      } catch (err) {
        reject(new Error(`解析 nmap 输出失败: ${err.message}`));
      }
    });

    proc.on('error', (err) => {
      currentProc = null;
      currentMode = '';
      console.error(`[nmap] 启动失败:`, err.message);
      reject(new Error(`启动 nmap 失败: ${err.message}`));
    });
  });
}

/**
 * 解析 nmap XML 输出为 JSON
 */
function parseXML(xmlFile) {
  // 简易 XML 解析（避免依赖 xml2js）
  // Windows nmap 可能输出 GBK 编码，先读 buffer 再解码
  const buf = fs.readFileSync(xmlFile);
  let xml;
  try {
    xml = buf.toString('utf8');
  } catch (e) {
    // UTF-8 失败则尝试 GBK（Windows 中文系统）
    try {
      const iconv = require('iconv-lite');
      xml = iconv.decode(buf, 'gbk');
    } catch (e2) {
      xml = buf.toString('latin1');  // 最后兜底
    }
  }

  const hosts = [];
  // 用正则提取 <host>...</host> 块
  const hostRegex = /<host[^>]*>([\s\S]*?)<\/host>/g;
  let hostMatch;

  while ((hostMatch = hostRegex.exec(xml)) !== null) {
    const hostBlock = hostMatch[1];

    // 提取地址
    const addresses = {};
    const addrRegex = /<address\s+addr="([^"]+)"\s+addrtype="([^"]+)"/g;
    let addrMatch;
    while ((addrMatch = addrRegex.exec(hostBlock)) !== null) {
      addresses[addrMatch[2]] = addrMatch[1];
    }

    if (!addresses.ipv4) continue; // 跳过没有 IPv4 的

    // 提取主机名
    const hostnameRegex = /<hostname[^>]*name="([^"]+)"/;
    const hostnameMatch = hostBlock.match(hostnameRegex);
    const hostname = hostnameMatch ? hostnameMatch[1] : '';

    // 提取操作系统
    const osRegex = /<osmatch[^>]*name="([^"]+)"\s+accuracy="(\d+)"/;
    const osMatch = hostBlock.match(osRegex);
    const os = osMatch ? { name: osMatch[1], accuracy: parseInt(osMatch[2]) } : null;

    // 提取状态
    const statusRegex = /<status\s+state="([^"]+)"\s+reason="([^"]*)"/;
    const statusMatch = hostBlock.match(statusRegex);
    const status = statusMatch ? statusMatch[1] : 'unknown';

    // 提取端口（只保留 open 状态的端口）
    const ports = [];
    const portRegex = /<port\s+protocol="([^"]+)"\s+portid="(\d+)">\s*<state\s+state="([^"]+)"[\s\S]*?<service\s+name="([^"]*)"(?:[\s\S]*?product="([^"]*)")?(?:[\s\S]*?version="([^"]*)")?/g;
    let portMatch;
    while ((portMatch = portRegex.exec(hostBlock)) !== null) {
      if (portMatch[3] === 'open') {
        ports.push({
          protocol: portMatch[1],
          port: parseInt(portMatch[2]),
          state: portMatch[3],
          service: portMatch[4] || '',
          product: portMatch[5] || '',
          version: portMatch[6] || '',
        });
      }
    }

    hosts.push({
      ip: addresses.ipv4,
      mac: addresses.mac || '',
      hostname,
      status,
      os,
      ports: ports.sort((a, b) => a.port - b.port),  // 按端口号排序
      portCount: ports.length,
    });
  }

  // 按 IP 排序
  hosts.sort((a, b) => {
    const aParts = a.ip.split('.').map(Number);
    const bParts = b.ip.split('.').map(Number);
    for (let i = 0; i < 4; i++) {
      if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
    }
    return 0;
  });

  // 提取扫描统计信息
  const runStatsRegex = /<runstats>[\s\S]*?<finished[^>]*elapsed="([\d.]+)"[\s\S]*?<hosts\s+up="(\d+)"\s+down="(\d+)"\s+total="(\d+)"/;
  const runStatsMatch = xml.match(runStatsRegex);
  const stats = runStatsMatch ? {
    elapsed: parseInt(runStatsMatch[1]),
    hostsUp: parseInt(runStatsMatch[2]),
    hostsDown: parseInt(runStatsMatch[3]),
    hostsTotal: parseInt(runStatsMatch[4]),
  } : {};

  return { hosts, stats };
}

/**
 * Ping 扫描 - 快速发现局域网主机（不扫描端口）
 */
function pingSweep(target, onProgress) {
  return new Promise((resolve, reject) => {
    const network = target || getLocalNetwork();
    const xmlFile = path.join(TMP_DIR, `nmap-ping-${Date.now()}.xml`);

    onProgress && onProgress({ type: 'start', network, mode: 'ping-sweep' });

    const args = ['-sn', '-T5', '--max-retries', '0', '-oX', xmlFile, network];
    console.log(`[nmap ping] ${NMAP_EXE} ${args.join(' ')}`);
    onProgress && onProgress({ type: 'command', cmd: `${NMAP_EXE} ${args.join(' ')}` });

    const proc = spawn(NMAP_EXE, args, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    currentProc = proc;
    currentMode = 'ping';

    let stdout = '';
    proc.stdout.on('data', (data) => {
      const text = data.toString('latin1');
      stdout += text;
      text.split('\n').filter(Boolean).forEach(line => {
        onProgress && onProgress({ type: 'stdout', line });
        const ipMatch = line.match(/Nmap scan report for ([\d.]+|[\w.-]+)/);
        if (ipMatch) {
          onProgress && onProgress({ type: 'host-found', host: ipMatch[1] });
        }
      });
    });

    proc.on('close', (code) => {
      currentProc = null;
      currentMode = '';
      onProgress && onProgress({ type: 'complete', exitCode: code });
      try {
        const result = parseXML(xmlFile);
        result.network = network;
        result.scanTime = new Date().toISOString();
        // ping sweep 没有端口数据，只返回主机发现
        result.hosts.forEach(h => {
          h.ports = [];
          h.portCount = 0;
        });
        resolve(result);
      } catch (err) {
        reject(new Error(`解析 ping 扫描输出失败: ${err.message}`));
      }
    });

    proc.on('error', (err) => {
      currentProc = null;
      currentMode = '';
      reject(new Error(`启动 ping 扫描失败: ${err.message}`));
    });
  });
}

/**
 * 快速扫描（仅扫描常见端口）
 */
function quickScan(target, onProgress) {
  return scan(target, onProgress);
}

/**
 * 获取本机开放端口（通过 netstat，弥补 nmap 扫描本机受限的问题）
 */
function getLocalPorts() {
  return new Promise((resolve) => {
    try {
      const proc = spawn('netstat', ['-ano'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', () => {
        const ports = [];
        const lines = stdout.split('\n');
        for (const line of lines) {
          // 只匹配 LISTENING 状态的端口（TCP有LISTENING，UDP是被动监听所以都算）
          // netstat -ano 格式:  Proto  Local Address          Foreign Address        State           PID
          //                     TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234
          //                     UDP    0.0.0.0:53             *:*                                    5678
          const tcpMatch = line.match(/^\s*(TCP)\s+[\d.]+\:(\d+)\s+[\d.*:]+\s+LISTENING/i);
          const udpMatch = line.match(/^\s*(UDP)\s+[\d.]+\:(\d+)\s+/i);
          let proto, port;
          if (tcpMatch) {
            proto = 'tcp';
            port = parseInt(tcpMatch[2]);
          } else if (udpMatch) {
            proto = 'udp';
            port = parseInt(udpMatch[2]);
            // 过滤掉常见的临时端口范围（>49152），保留知名端口和注册端口
            if (port > 49152) continue;
          } else {
            continue;
          }
          // 去重 & 只保留0-65535的有效端口
          if (port > 0 && port < 65536 && !ports.find(p => p.port === port && p.protocol === proto)) {
            ports.push({
              protocol: proto,
              port,
              state: 'open',
              service: lookupService(port, proto),
              product: '',
              version: '',
            });
          }
        }
        // 按端口排序
        ports.sort((a, b) => a.port - b.port);
        resolve(ports);
      });

      proc.on('error', () => resolve([]));
    } catch (e) {
      resolve([]);
    }
  });
}

// 加载 nmap-services 端口数据库
const serviceMap = new Map();
try {
  const servicesFile = path.join(path.dirname(NMAP_EXE.replace(/"/g, '')), 'nmap-services');
  if (fs.existsSync(servicesFile)) {
    const content = fs.readFileSync(servicesFile, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('#') || !line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const svcName = parts[0];
        const portProto = parts[1]; // e.g. "443/tcp"
        if (!serviceMap.has(portProto)) {
          serviceMap.set(portProto, svcName);
        }
      }
    }
    console.log(`[nmap] 加载端口服务库: ${serviceMap.size} 条`);
  }
} catch (e) { console.warn('[nmap] 加载端口库失败:', e.message); }

function lookupService(port, proto) {
  const key = `${port}/${proto}`;
  return serviceMap.get(key) || `${proto}/${port}`;
}

module.exports = { scan, quickScan, pingSweep, cancelScan, getLocalPorts, getLocalNetwork, lookupService };
