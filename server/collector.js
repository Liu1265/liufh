/**
 * 流量采集模块
 * 通过 PowerShell 获取网卡吞吐量，通过 netstat 获取真实连接
 */
const { spawn } = require('child_process');
const state = require('./state');
const { broadcast } = require('./ws');
const { isLocalNoise, guessAppProtocol, buildProtoStats, recordConnections } = require('./ip-tracker');

// 获取真实网卡流量计数器
function getRealThroughput() {
  return new Promise((resolve) => {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-Command',
      '$samples = Get-Counter -Counter "\\Network Interface(*)\\Bytes Received/sec","\\Network Interface(*)\\Bytes Sent/sec" -SampleInterval 1 -MaxSamples 1 | Select-Object -ExpandProperty CounterSamples; $rx = ($samples | Where-Object {$_.Path -like "*Received*" -and ($_.Path -like "*wi-fi*" -or $_.Path -like "*wlan*" -or $_.Path -like "*以太网*" -or $_.Path -like "*ethernet*")} | Select-Object -First 1).CookedValue; $tx = ($samples | Where-Object {$_.Path -like "*Sent*" -and ($_.Path -like "*wi-fi*" -or $_.Path -like "*wlan*" -or $_.Path -like "*以太网*" -or $_.Path -like "*ethernet*")} | Select-Object -First 1).CookedValue; Write-Output "$rx $tx"'
    ]);
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => {
      const parts = out.trim().split(/\s+/);
      const rxBytes = parseFloat(parts[0]) || 0;
      const txBytes = parseFloat(parts[1]) || 0;
      resolve({
        bytesPerSec: rxBytes + txBytes,
        downMbps: rxBytes * 8 / 1e6,
        upMbps: txBytes * 8 / 1e6,
      });
    });
    proc.on('error', () => resolve({ bytesPerSec: 0, downMbps: 0, upMbps: 0 }));
  });
}

// 获取真实连接列表（netstat -ano，过滤回环和监听端口）
function getRealConnections() {
  return new Promise((resolve) => {
    const proc = spawn('netstat', ['-ano']);
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => {
      const conns = [];
      const lines = out.split('\n');
      for (const line of lines) {
        const match = line.match(/^\s*(TCP|UDP)\s+(\d+\.\d+\.\d+\.\d+):(\d+)\s+(\d+\.\d+\.\d+\.\d+):(\d+)\s+(\w+)/);
        if (match) {
          const srcIP = match[2], dstIP = match[4];
          if (srcIP === '127.0.0.1' || dstIP === '127.0.0.1') continue;
          if (dstIP === '0.0.0.0' || srcIP === '0.0.0.0') continue;
          conns.push({
            protocol: match[1],
            src_ip: srcIP, src_port: parseInt(match[3]),
            dst_ip: dstIP, dst_port: parseInt(match[5]),
            state: match[6],
          });
        }
      }
      resolve(conns);
    });
    proc.on('error', () => resolve([]));
  });
}

// 启动采集定时器
function start(io = {}) {
  // 每 3 秒获取真实连接
  setInterval(async () => {
    try {
      const conns = await getRealConnections();
      state.connCache = conns;
      recordConnections(conns);

      const protoStats = buildProtoStats(conns);
      broadcast('protoStats', protoStats);

      // 传输层协议统计（TCP/UDP）
      let tcp = 0, udp = 0;
      for (const c of conns) {
        if (c.protocol === 'TCP') tcp++;
        else if (c.protocol === 'UDP') udp++;
      }
      if (tcp + udp > 0) {
        broadcast('transStats', { tcp, udp });
      }
    } catch (e) {
      console.error('[collector] 连接采集失败:', e.message);
    }
  }, 3000);

  // 每 1.5 秒获取真实网卡流量
  setInterval(async () => {
    try {
      const { bytesPerSec, downMbps, upMbps } = await getRealThroughput();
      if (bytesPerSec <= 0) return;
      state.prevDown = downMbps;
      state.prevUp = upMbps;
      state.totalBytesTransferred += bytesPerSec * 1.5;

      // 筛选对外连接
      const seen = new Set();
      const meaningfulConns = [];
      for (const c of state.connCache) {
        if (isLocalNoise(c.src_ip, c.dst_ip)) continue;
        const key = `${c.src_ip}:${c.dst_ip}:${c.dst_port}`;
        if (seen.has(key)) continue;
        seen.add(key);
        meaningfulConns.push(c);
        if (meaningfulConns.length >= 12) break;
      }

      const packets = meaningfulConns.map(c => ({
        captured_at: new Date().toLocaleString('zh-CN', { hour12: false }),
        src_ip: c.src_ip, dst_ip: c.dst_ip,
        protocol: c.protocol,
        app_protocol: guessAppProtocol(c.dst_port),
        src_port: c.src_port, dst_port: c.dst_port,
      }));
      broadcast('packets', packets);
      broadcast('throughput', {
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        downMbps: Math.round(downMbps * 100) / 100,
        upMbps: Math.round(upMbps * 100) / 100,
      });
    } catch (e) {
      console.error('[collector] 流量采集失败:', e.message);
    }
  }, 1500);

  console.log('[collector] 流量采集已启动');
}

module.exports = { start, getRealThroughput, getRealConnections };
