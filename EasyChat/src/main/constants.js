/**
 * 主进程 WebSocket 常量。
 */

// 初始化消息中需要过滤的系统联系人名
export const WS_SYSTEM_CONTACT_FILTER = 'EasyChat'

// 心跳间隔（ms）
export const HEARTBEAT_INTERVAL = 10000

// 心跳 pong 最大等待时间（ms），超过后认为连接半开
export const HEARTBEAT_PONG_TIMEOUT = HEARTBEAT_INTERVAL * 2

// 单个 WebSocket 消息处理最大耗时（ms），防止处理链永久阻塞
export const WS_MESSAGE_PROCESS_TIMEOUT = 15000

// 重连/退出前等待消息处理与刷盘完成的最长时间。
export const WS_RESET_FLUSH_TIMEOUT = 20000

// 消息队列刷盘延迟（ms）
export const RECEIVE_FLUSH_DELAY = 50

// 单次刷盘最大消息数
export const RECEIVE_FLUSH_MAX = 100

// WebSocket 重连延迟（ms）
export const WS_RECONNECT_DELAY = 5000

// WebSocket 最大重连次数
export const WS_MAX_RECONNECT_TIMES = 5

// SQL IN 子句参数上限
export const MAX_SQL_IN_PARAMS = 500
