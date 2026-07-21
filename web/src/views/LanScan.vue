<template>
  <div class="lan-scan">
    <h2 class="page-title">局域网扫描</h2>

    <!-- 扫描控制 -->
    <el-card shadow="hover" class="scan-ctrl-card">
      <div class="scan-ctrl">
        <div class="scan-ctrl-left">
          <el-select v-model="scanTarget" placeholder="选择网段" style="width:200px" clearable filterable>
            <el-option v-for="n in networks" :key="n.cidr"
              :label="`${n.cidr} (${n.name})`" :value="n.cidr" />
          </el-select>
          <el-button type="success" :icon="Search" @click="doPingSweep" :loading="scanning" :disabled="scanning">
            {{ scanning && scanMode==='ping' ? 'Ping扫描中...' : 'Ping扫描' }}
          </el-button>
          <el-button type="primary" :icon="Aim" @click="doScan" :loading="scanning && scanMode==='ports'" :disabled="scanning">
            {{ scanning && scanMode==='ports' ? `端口扫描中 ${progress.toFixed(0)}%` : '端口扫描' }}
          </el-button>
          <el-button v-if="scanning" type="danger" :icon="Close" @click="doCancel" plain>
            取消扫描
          </el-button>
          <el-button v-if="lastScanTime && !scanning" text type="info">
            上次扫描: {{ fmtTime(lastScanTime) }}
          </el-button>
        </div>
        <div class="scan-ctrl-right">
          <el-radio-group v-model="viewMode" size="small">
            <el-radio-button label="devices">设备列表</el-radio-button>
            <el-radio-button label="ports">端口对齐</el-radio-button>
          </el-radio-group>
        </div>
      </div>

      <!-- 进度条 -->
      <el-progress v-if="scanning" :percentage="progress" :stroke-width="18" :text-inside="true" style="margin-top:12px" />

      <!-- 统计概览 -->
      <el-row :gutter="16" style="margin-top:16px" v-if="result">
        <el-col :span="4">
          <div class="mini-stat"><span class="mini-num">{{ result.stats?.hostsUp || result.hosts?.length || 0 }}</span><span class="mini-label">在线设备</span></div>
        </el-col>
        <el-col :span="4">
          <div class="mini-stat"><span class="mini-num">{{ totalPorts }}</span><span class="mini-label">开放端口</span></div>
        </el-col>
        <el-col :span="4">
          <div class="mini-stat"><span class="mini-num">{{ result.stats?.hostsTotal || 0 }}</span><span class="mini-label">扫描总数</span></div>
        </el-col>
        <el-col :span="4">
          <div class="mini-stat"><span class="mini-num">{{ fmtElapsed(result.stats?.elapsed) }}</span><span class="mini-label">扫描耗时</span></div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 设备列表视图 -->
    <el-card shadow="hover" style="margin-top:16px" v-if="viewMode==='devices' && result">
      <template #header>
        <span>发现的设备 ({{ result.hosts?.length || 0 }})</span>
        <el-input v-model="deviceFilter" placeholder="搜索 IP / 主机名 / MAC / 端口" size="small" clearable style="width:240px; margin-left:16px">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
      </template>
      <el-table :data="filteredDevices" size="small" stripe default-expand-all
        :row-class-name="rowClass">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="port-detail">
              <div class="port-detail-title">开放端口详情 ({{ row.ports?.length || 0 }})</div>
              <div class="port-tags">
                <el-tag v-for="p in row.ports" :key="p.protocol+'/'+p.port"
                  :type="portTagType(p)"
                  size="small"
                  effect="plain"
                  style="margin:2px">
                  <b>{{ p.protocol }}/{{ p.port }}</b>
                  &nbsp;{{ p.service || 'unknown' }}
                  <template v-if="p.product">{{ p.product }} {{ p.version }}</template>
                </el-tag>
                <span v-if="!row.ports?.length" style="color:#999">无开放端口</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="ip" label="IP 地址" width="160" sortable />
        <el-table-column prop="mac" label="MAC 地址" width="170">
          <template #default="{ row }">
            <span :style="{color: row.mac ? '#303133' : '#ccc'}">{{ row.mac || 'N/A' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="hostname" label="主机名" width="180">
          <template #default="{ row }">
            <span :style="{color: row.hostname ? '#303133' : '#ccc'}">{{ row.hostname || 'N/A' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="os.name" label="操作系统" min-width="200">
          <template #default="{ row }">
            <template v-if="row.os">
              <span>{{ row.os.name }}</span>
              <el-tag size="small" style="margin-left:6px" :type="row.os.accuracy >= 90 ? 'success' : 'warning'">
                置信度 {{ row.os.accuracy }}%
              </el-tag>
            </template>
            <span v-else style="color:#ccc">未识别</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status==='up'?'success':'info'">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="portCount" label="端口数" width="80" sortable>
          <template #default="{ row }">
            <el-badge :value="row.portCount" :type="row.portCount>5?'warning':'primary'" :max="99" />
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 端口对齐视图 -->
    <el-card shadow="hover" style="margin-top:16px" v-if="viewMode==='ports'">
      <template #header>
        <span>端口对齐对比</span>
        <el-tag size="small" type="info" style="margin-left:10px">同一端口在不同设备的开放情况</el-tag>
      </template>
      <div v-if="!portAlignData" style="text-align:center;padding:40px;color:#999">
        <el-icon :size="48"><Warning /></el-icon>
        <p style="margin-top:12px">暂无扫描结果，请先执行扫描</p>
      </div>
      <div v-else class="port-align-table-wrap">
        <table class="port-align-table">
          <thead>
            <tr>
              <th class="pa-port-col">端口</th>
              <th class="pa-svc-col">服务</th>
              <th v-for="h in portAlignData.hosts" :key="h.ip" class="pa-host-col">
                <div class="pa-host-ip">{{ h.ip }}</div>
                <div class="pa-host-name">{{ h.hostname || h.mac || '-' }}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in portAlignData.ports" :key="p.protocol+'/'+p.port">
              <td class="pa-port-col">
                <el-tag size="small" :type="p.protocol==='tcp'?'primary':'warning'" effect="dark">
                  {{ p.protocol }}/{{ p.port }}
                </el-tag>
              </td>
              <td class="pa-svc-col">{{ p.service }}</td>
              <td v-for="h in portAlignData.hosts" :key="h.ip" class="pa-host-col"
                :class="p.hosts[h.ip] ? 'pa-open' : 'pa-closed'">
                <template v-if="p.hosts[h.ip]">
                  <el-icon :size="16" color="#52c41a"><CircleCheckFilled /></el-icon>
                  <span class="pa-product">{{ p.hosts[h.ip].product }}</span>
                  <span class="pa-version" v-if="p.hosts[h.ip].version">{{ p.hosts[h.ip].version }}</span>
                </template>
                <template v-else>
                  <span style="color:#ddd">—</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </el-card>

    <!-- 扫描日志 -->
    <el-card shadow="hover" style="margin-top:16px" v-if="logs.length">
      <template #header>
        <span>扫描日志</span>
        <el-button size="small" text @click="logs=[]" style="float:right">清空</el-button>
      </template>
      <div class="log-area">
        <div v-for="(l,i) in logs" :key="i" class="log-line">{{ l }}</div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Aim, Search, Warning, CircleCheckFilled, Close } from '@element-plus/icons-vue';
import dayjs from 'dayjs';
import { getNmapStatus, triggerNmapScan, triggerPingSweep, cancelNmapScan, getNmapPortAlign, getNmapNetworks } from '../api';
import socket from '../socket';

const scanTarget = ref('');
const scanning = ref(false);
const scanMode = ref('');  // 'ping' or 'ports'
const progress = ref(0);
const lastScanTime = ref('');
const result = ref(null);
const logs = ref([]);
const viewMode = ref('devices');
const deviceFilter = ref('');
const portAlignData = ref(null);
const networks = ref([]);
const preferredNetwork = ref('');

const totalPorts = computed(() => {
  if (!result.value?.hosts) return 0;
  return result.value.hosts.reduce((sum, h) => sum + (h.portCount || 0), 0);
});

const filteredDevices = computed(() => {
  if (!result.value?.hosts) return [];
  const kw = deviceFilter.value.trim().toLowerCase();
  if (!kw) return result.value.hosts;
  return result.value.hosts.filter(h => {
    const portsStr = h.ports?.map(p => p.port + '/' + p.service).join(' ') || '';
    return h.ip.includes(kw) ||
      (h.hostname || '').toLowerCase().includes(kw) ||
      (h.mac || '').toLowerCase().includes(kw) ||
      portsStr.includes(kw);
  });
});

function fmtTime(t) {
  return dayjs(t).format('MM-DD HH:mm:ss');
}
function fmtElapsed(s) {
  if (!s) return '-';
  const sec = parseFloat(s);
  if (sec < 60) return sec.toFixed(0) + 's';
  const min = Math.floor(sec / 60);
  const remain = Math.round(sec % 60);
  return min + 'min' + (remain > 0 ? ' ' + remain + 's' : '');
}

function rowClass({ row }) {
  if (row.portCount > 10) return 'high-port-row';
  return '';
}

function portTagType(p) {
  if (p.service === 'http' || p.service === 'https') return 'success';
  if (p.service === 'ssh' || p.service === 'mysql' || p.service === 'rdp') return 'danger';
  if (p.port <= 1024) return undefined; // 知名系统端口，不设 type 用默认样式
  return 'info';
}

async function doScan() {
  try {
    scanMode.value = 'ports';
    await triggerNmapScan(scanTarget.value.trim());
    ElMessage.success('端口扫描已启动，请等待完成...');
  } catch (e) {
    ElMessage.error('启动扫描失败: ' + (e.response?.data?.error || e.message));
  }
}

async function doPingSweep() {
  try {
    scanMode.value = 'ping';
    await triggerPingSweep(scanTarget.value.trim());
    ElMessage.success('Ping扫描已启动，请等待完成...');
  } catch (e) {
    ElMessage.error('启动Ping扫描失败: ' + (e.response?.data?.error || e.message));
  }
}

async function doCancel() {
  try {
    await cancelNmapScan();
    ElMessage.info('扫描已取消');
  } catch (e) {
    ElMessage.error('取消失败: ' + (e.response?.data?.error || e.message));
  }
}

// 使用共享 WebSocket（socket.js），接收 nmap 实时数据
function onNmapStatus(data) {
  scanning.value = data.scanning;
  progress.value = data.progress || 0;
}
function onNmapProgress(data) {
  progress.value = data.percent || 0;
}
function onNmapLog(data) {
  logs.value.push(data.line);
  if (logs.value.length > 500) logs.value.shift();
}
function onNmapResult(data) {
  result.value = data;
  lastScanTime.value = new Date().toISOString();
  scanning.value = false;
  progress.value = 100;
  ElMessage.success(`扫描完成！发现 ${data.hosts?.length || 0} 台设备`);
}
function onNmapError(data) {
  ElMessage.error('扫描失败: ' + data.message);
  scanning.value = false;
}

async function init() {
  try {
    const { data } = await getNmapStatus();
    if (data.result) {
      result.value = data.result;
      lastScanTime.value = data.lastScanTime;
    }
    const netResp = await getNmapNetworks();
    networks.value = netResp.data.networks || [];
    preferredNetwork.value = netResp.data.preferred || '';
    if (!scanTarget.value && preferredNetwork.value) {
      scanTarget.value = preferredNetwork.value;
    }
  } catch (e) { /* server可能未启动 */ }

  // 通过共享 socket 监听 nmap 事件（无需单独建 WebSocket 连接）
  socket.on('nmap.status', onNmapStatus);
  socket.on('nmap.progress', onNmapProgress);
  socket.on('nmap.log', onNmapLog);
  socket.on('nmap.result', onNmapResult);
  socket.on('nmap.error', onNmapError);
}

// 监听视图切换，加载端口对齐数据
watch(viewMode, async (mode) => {
  if (mode === 'ports' && result.value) {
    try {
      const { data } = await getNmapPortAlign();
      portAlignData.value = data;
    } catch (e) { /* ignore */ }
  }
});

onMounted(init);
onUnmounted(() => {
  socket.off('nmap.status', onNmapStatus);
  socket.off('nmap.progress', onNmapProgress);
  socket.off('nmap.log', onNmapLog);
  socket.off('nmap.result', onNmapResult);
  socket.off('nmap.error', onNmapError);
});
</script>

<style scoped>
.page-title { font-size:22px; margin-bottom:20px; color:#1a1a2e; }
.scan-ctrl-card { background:#fff; }
.scan-ctrl { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; }
.scan-ctrl-left { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.scan-ctrl-right { flex-shrink:0; }

.mini-stat {
  text-align:center; background:#f7f8fc; border-radius:8px; padding:12px 8px;
}
.mini-num { display:block; font-size:26px; font-weight:bold; color:#1a1a2e; }
.mini-label { display:block; font-size:12px; color:#8c8c8c; margin-top:2px; }

.port-detail { padding:8px 16px; background:#fafafa; }
.port-detail-title { font-size:13px; color:#606266; margin-bottom:8px; font-weight:bold; }
.port-tags { line-height:28px; }

:deep(.high-port-row) { background:#fff7e6 !important; }

/* 端口对齐表格 */
.port-align-table-wrap { overflow-x:auto; max-height:600px; overflow-y:auto; }
.port-align-table { width:100%; border-collapse:collapse; font-size:13px; }
.port-align-table th, .port-align-table td {
  padding:6px 10px; border:1px solid #e8e8e8; text-align:center; vertical-align:middle;
}
.port-align-table thead { position:sticky; top:0; z-index:2; }
.port-align-table thead th { background:#1a1a2e; color:#e0e0e0; font-weight:bold; }
.pa-port-col { width:100px; }
.pa-svc-col { width:80px; color:#606266; }
.pa-host-col { min-width:100px; }
.pa-host-ip { font-weight:bold; font-size:12px; color:#303133; }
.pa-host-name { font-size:11px; color:#909399; }
.pa-open { background:#f6ffed; }
.pa-closed { background:#fafafa; }
.pa-product { font-size:11px; color:#52c41a; display:block; }
.pa-version { font-size:10px; color:#909399; display:block; }

/* 日志 */
.log-area { max-height:300px; overflow-y:auto; background:#1a1a2e; color:#a0aec0;
  font-family:'Consolas','Courier New',monospace; font-size:12px; padding:10px; border-radius:4px; }
.log-line { line-height:1.6; white-space:pre-wrap; word-break:break-all; }
</style>
