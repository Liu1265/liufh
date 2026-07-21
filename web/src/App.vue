<template>
  <div id="app-container">
    <el-container style="height: 100vh">
      <!-- 侧边栏 -->
      <el-aside width="140px" style="background: #1a1a2e; overflow-x: hidden; overflow-y: auto">
        <div class="logo">
          <el-icon :size="18" color="#409EFF"><Monitor /></el-icon>
          <span>流量监控</span>
        </div>
        <el-menu
          :default-active="currentRoute"
          router
          background-color="#1a1a2e"
          text-color="#a0aec0"
          active-text-color="#409EFF"
          style="border-right: none; font-size:13px"
        >
          <el-menu-item index="/">
            <el-icon :size="16"><DataBoard /></el-icon>
            <span>实时仪表盘</span>
          </el-menu-item>
          <el-menu-item index="/protocol">
            <el-icon :size="16"><PieChart /></el-icon>
            <span>协议分析</span>
          </el-menu-item>
          <el-menu-item index="/alerts">
            <el-icon :size="16"><Warning /></el-icon>
            <span>告警管理</span>
          </el-menu-item>
          <el-menu-item index="/lan-scan">
            <el-icon :size="16"><Aim /></el-icon>
            <span>局域网扫描</span>
          </el-menu-item>
        </el-menu>
      </el-aside>

      <!-- 主内容 -->
      <el-main style="background: #f0f2f5; padding: 16px; overflow-y: auto">
        <router-view />
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
const route = useRoute();
const currentRoute = computed(() => route.path);
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; }
.logo {
  height: 52px; display: flex; align-items: center; justify-content: center;
  gap: 6px; color: #409EFF; font-size: 15px; font-weight: bold;
  border-bottom: 1px solid #16213e;
}
.logo span { color: #e0e0e0; }
.el-menu-item {
  padding-left: 12px !important;
  padding-right: 8px !important;
  height: 44px !important;
  line-height: 44px !important;
  font-size: 13px;
}
.el-menu-item.is-active {
  background-color: #16213e !important;
  border-left: 3px solid #409EFF;
}
</style>
