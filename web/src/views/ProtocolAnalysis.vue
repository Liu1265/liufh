<template>
  <div class="page">
    <h2 class="page-title">协议分析</h2>
    <el-row :gutter="16">
      <el-col :span="12">
        <el-card shadow="hover"><template #header><span>应用层协议分布</span></template><div ref="pieChart" style="height:420px"></div></el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="hover"><template #header><span>协议统计明细</span></template>
          <el-table :data="tableData" stripe>
            <el-table-column prop="name" label="协议" width="120"><template #default="{ row }"><el-tag :type="tag(row.name)">{{ row.name }}</el-tag></template></el-table-column>
            <el-table-column prop="count" label="数据包数" sortable />
            <el-table-column prop="percent" label="占比" sortable><template #default="{ row }"><el-progress :percentage="row.percent" :stroke-width="16" :color="pColor(row.percent)" /></template></el-table-column>
            <el-table-column prop="total_size_display" label="总流量" sortable />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
    <el-row :gutter="16" style="margin-top:16px">
      <el-col :span="12">
        <el-card shadow="hover"><template #header><span>传输层协议占比</span></template><div ref="transChart" style="height:380px"></div></el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="hover"><template #header><span>端口访问频率 Top 15</span></template><div ref="portChart" style="height:380px"></div></el-card>
      </el-col>
    </el-row>
    <el-row :gutter="16" style="margin-top:16px">
      <el-col :span="24">
        <el-card shadow="hover"><template #header><span>协议说明</span></template>
          <el-table :data="info" size="small">
            <el-table-column prop="protocol" label="协议" width="80" />
            <el-table-column prop="port" label="默认端口" width="100" />
            <el-table-column prop="desc" label="说明" />
            <el-table-column prop="layer" label="层级" width="80" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import * as echarts from 'echarts';
import { getProtocolStats, getIpPorts } from '../api';
import socket from '../socket';

const pieChart=ref(null), transChart=ref(null), portChart=ref(null);
let pInst=null, tInst=null, portInst=null;
const tableData=ref([]);
const ipPortData = ref([]);
const transData = ref({ tcp: 0, udp: 0 });  // 真实传输层统计数据
const info=[
  { protocol:'HTTPS', port:'443', desc:'安全超文本传输协议，加密网页浏览', layer:'应用层' },
  { protocol:'HTTP', port:'80', desc:'超文本传输协议，明文网页浏览', layer:'应用层' },
  { protocol:'DNS', port:'53', desc:'域名系统，域名→IP解析', layer:'应用层' },
  { protocol:'DHCP', port:'67/68', desc:'动态主机配置协议，自动分配IP', layer:'应用层' },
  { protocol:'SSH', port:'22', desc:'安全外壳协议，远程加密登录', layer:'应用层' },
  { protocol:'FTP', port:'21', desc:'文件传输协议', layer:'应用层' },
  { protocol:'TCP', port:'-', desc:'传输控制协议，面向连接可靠传输', layer:'传输层' },
  { protocol:'UDP', port:'-', desc:'用户数据报协议，无连接快速传输', layer:'传输层' },
];

function fmt(b) { if(!b) return '0 B'; if(b<1024) return b+' B'; if(b<1048576) return (b/1024).toFixed(1)+' KB'; if(b<1073741824) return (b/1048576).toFixed(1)+' MB'; return (b/1073741824).toFixed(2)+' GB'; }
function tag(n) { const m={HTTPS:'primary', HTTP:'success', DNS:'info', DHCP:'warning', SSH:'danger'}; return m[n]||'info'; }
function pColor(v) { if(v>40) return '#409EFF'; if(v>20) return '#67C23A'; if(v>10) return '#E6A23C'; return '#F56C6C'; }

// 从 ipPortData 中聚合端口频率
const portFrequency = computed(() => {
  const freq = {};
  for (const item of ipPortData.value) {
    for (const p of item.ports || []) {
      const key = `${p.port} (${p.service})`;
      freq[key] = (freq[key] || 0) + p.hits;
    }
  }
  return Object.entries(freq)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);
});

async function refresh() {
  try {
    const { data } = await getProtocolStats();
    const total = data.reduce((s,d)=>s+d.count,0);
    tableData.value = data.map(d=>({ name:d.app_protocol, count:d.count, total_size:d.total_size, total_size_display:fmt(d.total_size), percent: total>0 ? parseFloat(((d.count/total)*100).toFixed(1)) : 0 })).sort((a,b)=>b.count-a.count);
    if(pInst) pInst.setOption({ series:[{ data: tableData.value.map(d=>({ name:d.name, value:d.count })) }] });
    // 刷新IP端口数据
    const ipRes = await getIpPorts();
    ipPortData.value = ipRes.data;
    if (portInst) {
      portInst.setOption({
        yAxis: { data: portFrequency.value.map(d => d.name) },
        series: [{ data: portFrequency.value.map(d => d.value) }],
      });
    }
  } catch(e) { console.error(e); }
}

let timer;
onMounted(() => {
  nextTick(() => {
    pInst = echarts.init(pieChart.value);
    pInst.setOption({
      tooltip: { trigger:'item', formatter:'{b}: {c} ({d}%)' },
      series:[{
        type:'pie', radius:['35%','60%'], center:['50%','50%'], data:[],
        avoidLabelOverlap: false,
        label: { show:true, position:'outside', formatter:'{b} {d}%', fontSize:12, alignTo:'edge', edgeDistance:8 },
        labelLine: { show:true, length:30, length2:25 },
        emphasis: { label:{ fontSize:16, fontWeight:'bold' } },
        itemStyle: { borderRadius:4, borderColor:'#fff', borderWidth:2 },
      }],
    });
    tInst = echarts.init(transChart.value);
    tInst.setOption({
      tooltip: { trigger:'item', formatter:'{b}: {c} ({d}%)' },
      series:[{
        type:'pie', radius:['40%','65%'], center:['50%','50%'], roseType:'radius',
        data:[
          { value: transData.value.tcp || 0, name:'TCP' },
          { value: transData.value.udp || 0, name:'UDP' },
        ],
        avoidLabelOverlap: false,
        label: { show:true, position:'outside', formatter:'{b}\n{d}%', fontSize:12, alignTo:'edge', edgeDistance:8 },
        labelLine: { show:true, length:30, length2:25 },
        emphasis: { label:{ fontSize:16, fontWeight:'bold' } },
      }],
    });
    portInst = echarts.init(portChart.value);
    portInst.setOption({
      tooltip: { trigger:'axis', axisPointer:{ type:'shadow' } },
      grid: { left:120, right:20, top:10, bottom:20 },
      xAxis: { type:'value', name:'命中次数' },
      yAxis: { type:'category', data:[], inverse:true, axisLabel:{ fontSize:11 } },
      series: [{
        type:'bar', data:[],
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0,0,1,0,[
            {offset:0, color:'#409EFF'},{offset:1, color:'#67C23A'}
          ]),
          borderRadius: [0,4,4,0],
        },
        label: { show:true, position:'right', fontSize:11 },
      }],
    });
  });
  refresh();
  timer = setInterval(refresh, 30000);

  // 接收真实传输层协议统计（TCP/UDP），替换原硬编码数据
  socket.on('transStats', (stats) => {
    transData.value = stats;
    if (tInst) {
      tInst.setOption({
        series: [{
          data: [
            { value: stats.tcp || 0, name: 'TCP' },
            { value: stats.udp || 0, name: 'UDP' },
          ],
        }],
      });
    }
  });

  // 接收真实应用层协议统计，实时更新饼图
  socket.on('protoStats', (stats) => {
    const data = Object.entries(stats)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    if (pInst) pInst.setOption({ series: [{ data }] });
  });
});
onUnmounted(() => {
  pInst?.dispose(); tInst?.dispose(); portInst?.dispose();
  clearInterval(timer);
  socket.off('transStats');
  socket.off('protoStats');
});
</script>
<style scoped>.page-title { font-size:22px; margin-bottom:20px; color:#1a1a2e; }</style>
