import axios from 'axios';

// 开发模式用绝对路径（Vite 代理），生产模式用相对路径（同源）
const baseURL = import.meta.env.DEV ? 'http://localhost:3000/api' : '/api';

const api = axios.create({ baseURL, timeout: 10000 });

export const getSummary = () => api.get('/summary');
export const getProtocolStats = () => api.get('/protocol-stats');
export const getAlerts = () => api.get('/alerts');
export const getIpPorts = () => api.get('/ip-ports');

// nmap 扫描 API
export const getNmapStatus = () => api.get('/nmap/status');
export const triggerNmapScan = (target) => api.post('/nmap/scan', { target: target || '' });
export const triggerPingSweep = (target) => api.post('/nmap/ping-sweep', { target: target || '' });
export const getNmapLogs = () => api.get('/nmap/logs');
export const getNmapDevice = (ip) => api.get(`/nmap/device/${encodeURIComponent(ip)}`);
export const getNmapPortAlign = () => api.get('/nmap/port-align');
export const cancelNmapScan = () => api.post('/nmap/cancel');
export const getNmapNetworks = () => api.get('/nmap/networks');

export default api;
