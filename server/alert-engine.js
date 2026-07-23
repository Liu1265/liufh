/**
 * 告警引擎 — 流量阈值 + 异常行为检测
 */
const state = require('./state');
const { broadcast } = require('./ws');

// 异常检测：连接数飙升 / 端口扫描
function detectAnomaly() {
  const currentCount = state.connCache.length;
  if (state.connSamples > 10 && currentCount > state.avgConnCount * 2.5 && currentCount > 20) {
    return `连接数异常飙升: ${currentCount} (平均: ${Math.round(state.avgConnCount)})`;
  }
  const ipPorts = {};
  for (const c of state.connCache) {
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

// 启动告警定时器
function start() {
  // 每 10 秒更新连接统计基线
  setInterval(() => {
    if (state.connCache.length > 0) {
      state.avgConnCount = (state.avgConnCount * state.connSamples + state.connCache.length) / (state.connSamples + 1);
      state.connSamples++;
    }
  }, 10000);

  // 每 15 秒检测告警
  setInterval(() => {
    if (!state.alertConfig.enabled) return;

    // 流量阈值告警
    if (state.prevDown > state.alertConfig.thresholdMbps) {
      const msg = `流量峰值: ${state.prevDown.toFixed(1)} Mbps (阈值: ${state.alertConfig.thresholdMbps} Mbps)`;
      state.alertLog.push({ time: new Date().toISOString(), message: msg, level: 'warning' });
      if (state.alertLog.length > 200) state.alertLog.shift();
      state.alertCount++;
      broadcast('alert', { time: new Date().toISOString(), type: 'threshold', ip: '', message: msg });
    }

    // 异常行为检测
    const anomalyMsg = detectAnomaly();
    if (anomalyMsg) {
      state.alertLog.push({ time: new Date().toISOString(), message: anomalyMsg, level: 'danger' });
      if (state.alertLog.length > 200) state.alertLog.shift();
      state.alertCount++;
      broadcast('alert', { time: new Date().toISOString(), type: 'anomaly', ip: '', message: anomalyMsg });
    }
  }, 15000);

  console.log('[alert-engine] 告警引擎已启动');
}

module.exports = { start, detectAnomaly };
