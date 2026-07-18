import { CHUNK_UPLOAD_THRESHOLD, UPLOAD_CHUNK_SIZE } from '../../../shared/uploadConstants.js'

/**
 * 聊天模块公共常量。
 * 集中管理分页、滚动、消息长度等阈值，避免散落在组件中的 magic number。
 */
export const CHAT_CONSTANTS = {
  // 触顶分页阈值（px）
  LOAD_MORE_THRESHOLD: 80,

  // 消息内容最大长度（与后端约定一致）
  MAX_MESSAGE_LENGTH: 500,

  // 一次最多选择文件数
  MAX_FILE_SELECT_COUNT: 9,

  // 发送链路最多允许的执行中/待执行任务数
  MAX_SEND_TASK_QUEUE: 100,

  // 文件大小硬限制，单位 byte。后端默认值需保持一致。
  FILE_LIMITS: {
    image: 20 * 1024 * 1024,
    video: 2 * 1024 * 1024 * 1024,
    file: 2 * 1024 * 1024 * 1024
  },

  // 大文件分片上传配置。小文件仍可走旧接口作为兼容 fallback。
  UPLOAD_CHUNK_SIZE,
  CHUNK_UPLOAD_THRESHOLD,
  MAX_DOWNLOAD_SIZE: 2 * 1024 * 1024 * 1024,

  // 相邻消息展示时间分割线的最小间隔（ms）
  TIME_SEPARATOR_GAP: 5 * 60 * 1000,

  // 滚动贴底容差（px）
  BOTTOM_GAP_TOLERANCE: 2,

  // 首屏贴底锁定持续时间（ms）
  INITIAL_BOTTOM_LOCK_DURATION: 800,

  // 多帧稳定：最多检查帧数
  MAX_BOTTOM_SETTLE_FRAMES: 8,

  // 多帧稳定：连续稳定帧数
  STABLE_FRAME_COUNT: 2,

  // 靠近底部判断阈值（px）
  NEAR_BOTTOM_THRESHOLD: 120,

  // 图片加载后贴底额外容忍距离（px）
  IMAGE_LOADED_BOTTOM_TOLERANCE: 360,

  // 虚拟列表：未测量消息的估算高度（px）
  VIRTUAL_ESTIMATE_HEIGHT: 76,

  // 虚拟列表：视口外预渲染行数
  VIRTUAL_OVERSCAN: 8,

  // 分页每页条数
  MESSAGE_PAGE_SIZE: 20,

  // 定位消息时上下文条数（单侧）
  MESSAGE_CONTEXT_SIZE: 20
}
