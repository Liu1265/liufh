<template>
  <div class="dashboard">
    <h2 class="page-title">实时流量仪表盘</h2>

    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stat-row">
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-icon" style="background:#e6f7ff"><el-icon :size="28" color="#1890ff"><Coin /></el-icon></div>
          <div class="stat-info"><div class="stat-label">今日总流量</div><div class="stat-value">{{ fmt(store.summary.today_total) }}</div></div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-icon" style="background:#f6ffed"><el-icon :size="28" color="#52c41a"><Monitor /></el-icon></div>
          <div class="stat-info"><div class="stat-label">活跃设备</div><div class="stat-value">{{ store.summary.active_devices }} 台</div></div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-icon" style="background:#fff2f0"><el-icon :size="28" color="#ff4d4f"><Warning /></el-icon></div>
          <div class="stat-info"><div class="stat-label">今日告警</div><div class="stat-value alert-value">{{ store.summary.alert_count }} 次</div></div>
        </div>
      </el-col>
    </el-row>

    <!-- 图表区 -->
    <el-row :gutter="16" style="margin-top:16px">
      <el-col :span="13">
        <el-card shadow="hover">
          <template #header><span>实时吞吐量 (Mbps)</span><el-tag size="small" type="success" style="margin-left:10px">实时</el-tag></template>
          <div ref="tChart" style="height:420px"></div>
        </el-card>
      </el-col>
      <el-col :span="11">
        <el-card shadow="hover">
          <template #header><span>协议分布</span></template>
          <div ref="pChart" style="height:420px"></div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 实时数据包 -->
    <el-card shadow="hover" style="margin-top:16px">
      <template #header>
        <span>实时数据包</span>
        <el-tag size="small" type="warning" style="margin-left:10px">最近 {{ store.recentPackets.length }} 条</el-tag>
        <div style="float:right; display:flex; align-items:center; gap:8px">
          <el-input v-model="ipFilter" placeholder="搜索 IP" size="small" clearable style="width:180px" @clear="ipFilter=''">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-tag v-if="ipFilter" size="small" type="info" effect="plain">
            匹配 {{ filteredPackets.length }} 条
          </el-tag>
        </div>
      </template>
      <el-table :data="filteredPackets" max-height="360" size="small" stripe style="min-width:900px">
        <el-table-column prop="captured_at" label="时间" width="150" />
        <el-table-column prop="src_ip" label="源IP" width="140" />
        <el-table-column prop="dst_ip" label="目标IP" width="140" />
        <el-table-column prop="protocol" label="协议" width="70" />
        <el-table-column prop="app_protocol" label="应用" width="90">
          <template #default="{ row }"><el-tag size="small" :type="tagType(row.app_protocol)">{{ row.app_protocol }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="src_port" label="源端口" width="80" />
        <el-table-column prop="dst_port" label="目标端口" width="80" />
      </el-table>
    </el-card>

    <!-- IP-端口映射 -->
    <el-card shadow="hover" style="margin-top:16px">
      <template #header>
        <span>IP — 端口映射</span>
        <el-tag size="small" type="success" style="margin-left:10px">实时追踪</el-tag>
        <el-button size="small" text style="float:right" @click="refreshIpPorts">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </template>
      <el-table :data="store.ipPorts" max-height="400" size="small" stripe style="min-width:600px">
        <el-table-column prop="ip" label="IP 地址 / 归属" width="230" sortable>
          <template #default="{ row }">
            <span v-if="row.geoState === 'ok'" class="ip-cell">
              <span class="ip-addr">{{ row.ip }}</span>
              <span class="ip-org">{{ countryFlag(row.geo.country) }} {{ row.geo.city || row.geo.region || row.geo.country }}</span>
              <span class="ip-isp">{{ row.geo.isp || row.geo.org }}</span>
            </span>
            <span v-else-if="row.geoState === 'pending'" class="ip-cell">
              <span class="ip-addr">{{ row.ip }}</span>
              <span class="ip-org loading-text">查询中…</span>
            </span>
            <span v-else-if="row.geoState === 'failed'" class="ip-cell">
              <span class="ip-addr">{{ row.ip }}</span>
              <span class="ip-org failed-text">查询失败</span>
            </span>
            <span v-else class="ip-cell">
              <span class="ip-addr">{{ row.ip }}</span>
              <span class="ip-org lan-text">局域网</span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="端口列表" min-width="300">
          <template #default="{ row }">
            <div class="port-tags-inline">
              <el-tag v-for="p in row.ports" :key="p.port"
                size="small"
                :type="portDangerType(p.port)"
                effect="plain"
                style="margin:2px">
                <b>{{ p.port }}</b>
                <span style="margin-left:4px;font-size:11px">{{ p.service }}</span>
                <span style="margin-left:2px;font-size:10px;color:#999">({{ p.hits }})</span>
              </el-tag>
              <span v-if="!row.ports?.length" style="color:#ccc">—</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="last_seen" label="最后活跃" width="150" sortable />
      </el-table>
    </el-card>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import * as echarts from 'echarts';
import { ElNotification } from 'element-plus';
import { useTrafficStore } from '../store/traffic';
import socket from '../socket';

const store = useTrafficStore();
const tChart = ref(null), pChart = ref(null);
let tInst = null, pInst = null;
const ipFilter = ref('');
const throughput = [];
const protoMap = {};

// IP 搜索过滤
const filteredPackets = computed(() => {
  const keyword = ipFilter.value.trim();
  if (!keyword) return store.recentPackets;
  const lower = keyword.toLowerCase();
  return store.recentPackets.filter(p =>
    p.src_ip?.includes(lower) || p.dst_ip?.includes(lower)
  );
});
const MAX = 60;

function fmt(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b/1048576).toFixed(1) + ' MB';
  return (b/1073741824).toFixed(2) + ' GB';
}
function tagType(p) {
  const m = { HTTPS:'', HTTP:'success', DNS:'info', DHCP:'warning', SSH:'danger', FTP:'danger' };
  return m[p] || 'info';
}
function portDangerType(port) {
  if (port === 3389 || port === 22 || port === 3306 || port === 1433) return 'danger';
  if (port === 80 || port === 443 || port === 8080 || port === 8443) return 'success';
  if (port <= 1024) return undefined; // 知名系统端口，不设 type 用默认样式
  return 'info';
}
function refreshIpPorts() {
  store.fetchIpPorts();
}

// 国家名 → 国旗 emoji
const flagMap = {
  '中国':'🇨🇳','China':'🇨🇳','Japan':'🇯🇵','United States':'🇺🇸','South Korea':'🇰🇷','United Kingdom':'🇬🇧',
  'Germany':'🇩🇪','France':'🇫🇷','Netherlands':'🇳🇱','Singapore':'🇸🇬','Hong Kong':'🇭🇰',
  'Taiwan':'🇨🇳','Australia':'🇦🇺','Canada':'🇨🇦','India':'🇮🇳','Brazil':'🇧🇷',
  'Russia':'🇷🇺','Sweden':'🇸🇪','Ireland':'🇮🇪',
};
function countryFlag(country) {
  return flagMap[country] || '🌐';
}

function initCharts() {
  nextTick(() => {
    tInst = echarts.init(tChart.value);
    tInst.setOption({
      tooltip: { trigger:'axis' }, legend: { data:['下载','上传'], bottom:0 },
      xAxis: { type:'category', data:[], show:false },
      yAxis: { type:'value', name:'Mbps', splitLine:{ lineStyle:{ type:'dashed' } } },
      series: [
        { name:'下载', type:'line', smooth:true, symbol:'none', areaStyle:{ color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(82,196,26,0.3)'},{offset:1,color:'rgba(82,196,26,0)'}]) }, lineStyle:{ color:'#52c41a',width:2 } },
        { name:'上传', type:'line', smooth:true, symbol:'none', areaStyle:{ color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(24,144,255,0.3)'},{offset:1,color:'rgba(24,144,255,0)'}]) }, lineStyle:{ color:'#1890ff',width:2 } },
      ],
      grid: { left:50, right:20, top:20, bottom:40 },
    });
    pInst = echarts.init(pChart.value);
    pInst.setOption({
      tooltip: { trigger:'item', formatter:'{b}: {c} ({d}%)' },
      series:[{
        type:'pie',
        radius:['35%','60%'],
        center:['50%','50%'],
        data:[],
        avoidLabelOverlap: false,
        label: { show:true, position:'outside', formatter:'{b} {d}%', fontSize:12, alignTo:'edge', edgeDistance:8 },
        labelLine: { show:true, length:30, length2:25 },
        emphasis: { label:{ fontSize:16, fontWeight:'bold' } },
      }],
    });
  });
}

// 接收实时吞吐量（图表专用，来自网卡真实数据）
function onThroughput(data) {
  const t = data.time;
  const last = throughput[throughput.length - 1];
  if (last && last.time === t) {
    last.down += data.downMbps;
    last.up += data.upMbps;
  } else {
    throughput.push({ time: t, down: data.downMbps, up: data.upMbps });
    if (throughput.length > MAX) throughput.shift();
  }
}

// 批量接收数据包（仅对外连接，显示在表格）
function onPackets(packets) {
  store.addPackets(packets);
}

let cTimer, sTimer;
function refreshCharts() {
  if (!tInst) return;
  tInst.setOption({ xAxis:{ data: throughput.map(d=>d.time) }, series:[{ data: throughput.map(d=>d.down) },{ data: throughput.map(d=>d.up) }] });
  const pie = Object.entries(protoMap).map(([n,v])=>({ name:n, value:v })).sort((a,b)=>b.value-a.value);
  pInst.setOption({ series:[{ data: pie }] });
}

  // 接收真实协议分布统计
  socket.on('protoStats', (stats) => {
    // stats: { HTTPS: 12, HTTP: 3, DNS: 2, ... }
    // 直接替换 protoMap 为真实连接统计数据
    Object.keys(protoMap).forEach(k => delete protoMap[k]);
    Object.entries(stats).forEach(([k, v]) => { protoMap[k] = v; });
  });

onMounted(() => {
  initCharts();
  store.fetchSummary();
  store.fetchIpPorts();
  socket.on('throughput', onThroughput);
  socket.on('packets', onPackets);
  socket.on('alert', (data) => {
    ElNotification({ title:'流量告警', message:data.message, type:'warning', duration:5000 });
    store.fetchSummary();
  });
  cTimer = setInterval(refreshCharts, 500);
  sTimer = setInterval(() => { store.fetchSummary(); store.fetchIpPorts(); }, 3000);
});

onUnmounted(() => {
  socket.off('throughput', onThroughput); socket.off('packets', onPackets); socket.off('alert');
  clearInterval(cTimer); clearInterval(sTimer);
  tInst?.dispose(); pInst?.dispose();
});
</script>

<style scoped>
.page-title { font-size:22px; margin-bottom:20px; color:#1a1a2e; }
.stat-card { background:#fff; border-radius:8px; padding:14px; display:flex; align-items:center; gap:12px; box-shadow:0 2px 8px rgba(0,0,0,0.06); cursor:pointer; transition:transform .2s; }
.stat-card:hover { transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,0.1); }
.stat-icon { width:50px; height:50px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.stat-label { font-size:12px; color:#8c8c8c; margin-bottom:2px; white-space:nowrap; }
.stat-value { font-size:20px; font-weight:bold; color:#1a1a2e; white-space:nowrap; }
.alert-value { color:#ff4d4f; }
.port-tags-inline { line-height:28px; }

.ip-cell { display:block; line-height:1.4; cursor:default; }
.ip-addr { display:block; font-size:13px; color:#303133; font-family:'Consolas','Courier New',monospace; }
.ip-org { display:block; font-size:11px; color:#303133; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ip-isp { display:block; font-size:11px; color:#909399; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ip-org.loading-text { color:#c0c4cc; animation:pulse 1.5s ease-in-out infinite; }
.ip-org.failed-text { color:#e6a23c; }
.ip-org.lan-text { color:#c0c4cc; }
@keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }

</style>
