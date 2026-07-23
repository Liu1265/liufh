/**
 * 聚域网 — 局域网流量监控与安全分析系统
 * 后端入口
 *
 * 模块结构:
 *   state.js       — 全局共享状态
 *   ws.js          — WebSocket 连接管理
 *   utils.js       — 无状态工具函数
 *   ip-tracker.js  — IP 追踪 & 归属地查询
 *   collector.js   — 实时流量采集（PowerShell + netstat）
 *   alert-engine.js— 告警阈值 & 异常检测
 *   routes/nmap.js — nmap 扫描 REST API
 *   routes/traffic.js — 流量/IP/告警 REST API
 */
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ws = require('./ws');
const nmapRoutes = require('./routes/nmap');
const trafficRoutes = require('./routes/traffic');
const collector = require('./collector');
const alertEngine = require('./alert-engine');

const app = express();
const server = http.createServer(app);

// ==================== 中间件 ====================
app.use(cors());
app.use(express.json());

// ==================== 静态文件 ====================
const distPath = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// ==================== 路由挂载 ====================
app.use('/api/nmap', nmapRoutes);
app.use('/api', trafficRoutes);

// SPA fallback
app.get('*', (req, res) => {
  const indexFile = path.join(distPath, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
});

// ==================== 启动 ====================
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 3001;

ws.init(WS_PORT);
collector.start();
alertEngine.start();

server.listen(PORT, () => {
  const nmap = require('./nmap');
  console.log('========================================');
  console.log('  聚域网 — 流量监控与安全分析系统');
  console.log(`  HTTP API:   http://localhost:${PORT}`);
  console.log(`  WebSocket:  ws://localhost:${WS_PORT}`);
  console.log(`  本机网段:   ${nmap.getLocalNetwork()}`);
  console.log('========================================');
});
