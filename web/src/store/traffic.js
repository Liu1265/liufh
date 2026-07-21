import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { getSummary, getIpPorts } from '../api';

export const useTrafficStore = defineStore('traffic', () => {
  const summary = ref({ today_total: 0, active_devices: 0, current_connections: 0, alert_count: 0 });
  const recentPackets = shallowRef([]);
  const ipPorts = ref([]);

  async function fetchSummary() {
    try {
      const { data } = await getSummary();
      summary.value = data;
    } catch (e) {
      console.error('获取概览失败:', e);
    }
  }

  async function fetchIpPorts() {
    try {
      const { data } = await getIpPorts();
      // 服务端已返回 geo / geoState，直接使用；局域网 IP 的 geoState 为 'none'，前端显示"局域网"
      ipPorts.value = data.map(item => {
        if (!item.geoState || item.geoState === 'none') {
          // 局域网或未查询 → 设为 undefined，模板走 v-else 显示"局域网"
          item.geoState = undefined;
        }
        return item;
      });
    } catch (e) {
      console.error('获取IP端口映射失败:', e);
    }
  }

  function addPacket(packet) {
    const arr = recentPackets.value;
    arr.unshift(packet);
    if (arr.length > 200) arr.length = 200;
    // shallowRef 需触发引用变更
    recentPackets.value = [...arr];
  }

  function addPackets(packets) {
    const arr = [...recentPackets.value];
    for (const p of packets) {
      arr.unshift(p);
    }
    if (arr.length > 200) arr.length = 200;
    recentPackets.value = arr;
  }

  return { summary, recentPackets, ipPorts, fetchSummary, fetchIpPorts, addPacket, addPackets };
});
