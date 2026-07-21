<template>
  <div class="page">
    <h2 class="page-title">告警管理</h2>
    <el-row :gutter="16">
      <el-col :span="6"><el-card shadow="hover" style="text-align:center"><el-statistic title="总告警数" :value="list.length" /></el-card></el-col>
      <el-col :span="6">
        <el-tooltip content="实时下载流量 > 设定阈值时触发" placement="top">
          <el-card shadow="hover" style="text-align:center;cursor:help"><el-statistic title="阈值告警 ⓘ" :value="list.filter(a=>a.alert_type==='threshold').length" /></el-card>
        </el-tooltip>
      </el-col>
      <el-col :span="6">
        <el-tooltip content="①连接数飙升(>均值×2.5) ②同IP访问≥8个端口(疑似扫描)" placement="top">
          <el-card shadow="hover" style="text-align:center;cursor:help"><el-statistic title="异常行为 ⓘ" :value="list.filter(a=>a.alert_type==='anomaly').length" /></el-card>
        </el-tooltip>
      </el-col>
      <el-col :span="6"><el-card shadow="hover" style="text-align:center">
        <el-statistic title="当前阈值">
          <template #suffix>
            <el-popover trigger="click" :width="280">
              <template #reference>
                <el-button size="small" type="primary" text>{{ config.thresholdMbps }} Mbps <el-icon><Edit /></el-icon></el-button>
              </template>
              <div>
                <el-form label-width="80px" size="small">
                  <el-form-item label="流量阈值">
                    <el-input-number v-model="editThreshold" :min="1" :max="1000" :step="1" controls-position="right" style="width:140px" />
                    <span style="margin-left:4px;color:#909399">Mbps</span>
                  </el-form-item>
                  <el-form-item label="启用告警">
                    <el-switch v-model="editEnabled" />
                  </el-form-item>
                  <el-form-item>
                    <el-button type="primary" size="small" @click="saveConfig">保存</el-button>
                    <el-button size="small" @click="editThreshold=config.thresholdMbps;editEnabled=config.enabled">取消</el-button>
                  </el-form-item>
                </el-form>
              </div>
            </el-popover>
          </template>
        </el-statistic>
      </el-card></el-col>
    </el-row>
    <el-card shadow="hover" style="margin-top:16px">
      <template #header>
        <span>告警记录</span>
        <el-button size="small" type="primary" @click="refresh" style="float:right"><el-icon><Refresh /></el-icon> 刷新</el-button>
      </template>
      <el-table :data="list" stripe max-height="500" v-loading="loading">
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="alert_time" label="告警时间" width="170" sortable />
        <el-table-column prop="alert_type" label="类型" width="100"><template #default="{ row }"><el-tag :type="row.alert_type==='threshold'?'warning':'danger'" size="small">{{ row.alert_type==='threshold'?'流量超阈值':'异常行为' }}</el-tag></template></el-table-column>
        <el-table-column prop="ip" label="涉及 IP" width="160" />
        <el-table-column prop="message" label="告警内容" min-width="300" show-overflow-tooltip />
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { getAlerts } from '../api';
import api from '../api';
import socket from '../socket';
import { ElNotification, ElMessage } from 'element-plus';

const list = ref([]), loading = ref(false);
const config = ref({ thresholdMbps: 5, enabled: true });
const editThreshold = ref(5);
const editEnabled = ref(true);

async function refresh() {
  loading.value = true;
  try { const { data } = await getAlerts(); list.value = data; } catch (e) { console.error(e); }
  finally { loading.value = false; }
}

async function loadConfig() {
  try { const { data } = await api.get('/alerts/config'); config.value = data; editThreshold.value = data.thresholdMbps; editEnabled.value = data.enabled; } catch (e) {}
}

async function saveConfig() {
  try {
    await api.post('/alerts/config', { thresholdMbps: editThreshold.value, enabled: editEnabled.value });
    config.value.thresholdMbps = editThreshold.value;
    config.value.enabled = editEnabled.value;
    ElMessage.success('告警配置已更新');
  } catch (e) { ElMessage.error('保存失败'); }
}

onMounted(() => {
  refresh();
  loadConfig();
  socket.on('alert', (data) => {
    ElNotification({ title: '新告警', message: data.message, type: 'warning', duration: 6000 });
    list.value.unshift({ alert_type: data.type, ip: data.ip, message: data.message, alert_time: data.time });
    if (list.value.length > 200) list.value.length = 200;
  });
});
</script>
<style scoped>.page-title { font-size:22px; margin-bottom:20px; color:#1a1a2e; }</style>
