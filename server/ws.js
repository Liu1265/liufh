/**
 * WebSocket 连接管理 — 端口 3001
 * 提供 broadcast() 供所有模块向已连接客户端推送消息
 */
const { WebSocketServer } = require('ws');

let wss = null;
const wsClients = new Set();

function init(port = 3001) {
  wss = new WebSocketServer({ port });
  wsClients.clear();

  wss.on('connection', (ws) => {
    wsClients.add(ws);
    console.log(`[WS] 客户端连接，当前连接数: ${wsClients.size}`);
    ws.on('close', () => {
      wsClients.delete(ws);
      console.log(`[WS] 客户端断开，当前连接数: ${wsClients.size}`);
    });
    ws.on('error', () => wsClients.delete(ws));
  });

  console.log(`[WS] WebSocket 服务启动在端口 ${port}`);
  return wss;
}

function broadcast(type, data) {
  if (!wss) return;
  const msg = JSON.stringify({ type, data });
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

module.exports = { init, broadcast };
