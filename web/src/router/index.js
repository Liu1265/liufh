import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'Dashboard', component: () => import('../views/Dashboard.vue') },
  { path: '/protocol', name: 'Protocol', component: () => import('../views/ProtocolAnalysis.vue') },
  { path: '/alerts', name: 'Alerts', component: () => import('../views/Alerts.vue') },
  { path: '/lan-scan', name: 'LanScan', component: () => import('../views/LanScan.vue') },
];

const router = createRouter({
  history: createWebHashHistory(), // Electron 中必须用 hash 路由
  routes,
});

export default router;
