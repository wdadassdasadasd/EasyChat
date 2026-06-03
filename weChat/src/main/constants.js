/**
 * 主进程 WebSocket 常量。
 */

// 初始化消息中需要过滤的系统联系人名
export const WS_SYSTEM_CONTACT_FILTER = 'EasyChat';

// 心跳间隔（ms）
export const HEARTBEAT_INTERVAL = 10000;

// 消息队列刷盘延迟（ms）
export const RECEIVE_FLUSH_DELAY = 50;

// 单次刷盘最大消息数
export const RECEIVE_FLUSH_MAX = 100;

// WebSocket 重连延迟（ms）
export const WS_RECONNECT_DELAY = 5000;

// WebSocket 最大重连次数
export const WS_MAX_RECONNECT_TIMES = 5;

// SQL IN 子句参数上限
export const MAX_SQL_IN_PARAMS = 500;
