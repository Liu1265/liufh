/**
 * 全局共享状态 — 所有模块通过 require('./state') 访问同一实例
 */
const path = require('path');

// ==================== nmap 扫描状态 ====================
const scanState = {
  scanning: false,
  lastResult: null,
  lastScanTime: null,
  progress: 0,
  network: '',
  logs: [],
};

// ==================== IP 追踪 & 归属地 ====================
const ipTracker = {};       // { ip: { last_seen, protocols: {}, ports: { port: hits } } }
const ipGeoCache = new Map(); // ip -> { country, region, city, isp, org } | null | '__pending__'

// ==================== 连接 & 流量 ====================
let connCache = [];
let totalBytesTransferred = 0;
let prevDown = 0, prevUp = 0;

// ==================== 告警 ====================
const alertConfig = { thresholdMbps: 5, enabled: true, notifySound: false };
const alertLog = [];
let alertCount = 0;

// 异常检测基线
let avgConnCount = 0, connSamples = 0;

// ==================== 持久化路径 ====================
const RESULT_FILE = path.join(__dirname, 'scan_results.json');

module.exports = {
  scanState, ipTracker, ipGeoCache,
  connCache, totalBytesTransferred, prevDown, prevUp,
  alertConfig, alertLog, alertCount,
  avgConnCount, connSamples,
  RESULT_FILE,
};
