/**
 * 流量 / IP / 告警相关 API 路由
 */
const express = require('express');
const router = express.Router();
const state = require('../state');
const { isPublicIP, guessAppProtocol, buildProtoStats } = require('../ip-tracker');

// 动态概览
router.get('/summary', (req, res) => {
  const lanHosts = state.scanState.lastResult?.hosts?.length || 0;
  res.json({
    today_total: state.totalBytesTransferred,
    active_devices: lanHosts,
    current_connections: state.connCache.length,
    alert_count: state.alertCount,
  });
});

// 协议统计
router.get('/protocol-stats', (req, res) => {
  const stats = buildProtoStats(state.connCache);
  res.json(Object.entries(stats).map(([name, count]) => ({
    app_protocol: name, name, count,
    total_size: count * 1500,
    percent: 0,
  })));
});

// 告警列表
router.get('/alerts', (req, res) => {
  res.json(state.alertLog.slice(-50).map(a => ({
    alert_time: a.time,
    alert_type: a.level === 'warning' ? 'threshold' : 'anomaly',
    ip: a.ip || '',
    message: a.message,
  })));
});

// 告警配置
router.get('/alerts/config', (req, res) => res.json(state.alertConfig));

router.post('/alerts/config', (req, res) => {
  const { thresholdMbps, enabled } = (req.body || {});
  if (thresholdMbps !== undefined) {
    const val = Number(thresholdMbps);
    if (isNaN(val) || val < 0) {
      return res.status(400).json({ error: 'thresholdMbps 必须是非负数' });
    }
    state.alertConfig.thresholdMbps = val;
  }
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled 必须是布尔值' });
    }
    state.alertConfig.enabled = enabled;
  }
  res.json(state.alertConfig);
});

// IP-端口映射
router.get('/ip-ports', (req, res) => {
  const list = Object.values(state.ipTracker)
    .filter(ip => ip.ports && Object.keys(ip.ports).length > 0)
    .map(ip => {
      const cached = state.ipGeoCache.get(ip.ip);
      let geo = null, geoState = 'none';
      if (cached === '__pending__') { geoState = 'pending'; }
      else if (cached === null) { geoState = 'failed'; }
      else if (cached) { geo = cached; geoState = 'ok'; }

      return {
        ip: ip.ip, last_seen: ip.last_seen, protocols: ip.protocols,
        geo, geoState, isPublic: isPublicIP(ip.ip),
        ports: Object.entries(ip.ports)
          .map(([port, hits]) => ({ port: parseInt(port), hits, service: guessAppProtocol(parseInt(port)) }))
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

module.exports = router;
