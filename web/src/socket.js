/**
 * 原生 WebSocket 连接（替代 socket.io）
 * 后端 ws://localhost:3001 推送 JSON: { type: 'packet'|'alert', data: {...} }
 */

const WS_URL = import.meta.env.DEV ? 'ws://localhost:3001' : `ws://${location.hostname}:3001`;

class TrafficSocket {
  constructor() {
    this.url = WS_URL;
    this.ws = null;
    this.listeners = {};
    this.reconnectDelay = 1000;
    this.maxDelay = 30000;
    this._connect();
  }

  _connect() {
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      console.warn('[WS] Connection failed, retrying...');
      this._retry();
      return;
    }

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      this.reconnectDelay = 1000;
      this._emit('connect');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type) {
          this._emit(msg.type, msg.data);
        }
      } catch (e) {
        console.warn('[WS] Invalid message:', event.data);
      }
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected');
      this._emit('disconnect');
      this._retry();
    };

    this.ws.onerror = (err) => {
      console.warn('[WS] Error, will reconnect...');
    };
  }

  _retry() {
    setTimeout(() => {
      console.log(`[WS] Reconnecting...`);
      this._connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  _emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}

const socket = new TrafficSocket();
export default socket;
