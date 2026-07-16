import { insertOrReplaceStrict, queryAll, queryOne, runStrict } from './ADB.js'

const getCurrentUserId = (explicitUserId) => {
  const userId = explicitUserId
  if (!userId) {
    throw new Error('Upload task requires an authenticated user')
  }
  return userId
}

const saveUploadTask = async (task = {}, userId) => {
  const ownerUserId = getCurrentUserId(userId || task.userId)
  const now = Date.now()
  const previous = task.taskId
    ? await queryOne('select * from upload_task where user_id=? and task_id=?', [ownerUserId, task.taskId])
    : null
  const next = {
    ...previous,
    ...task,
    userId: ownerUserId,
    createdAt: previous?.createdAt || task.createdAt || now,
    updatedAt: now
  }
  await insertOrReplaceStrict('upload_task', next)
  return next
}

const getUploadTaskByMessageId = async (messageId, userId) => {
  return queryOne('select * from upload_task where user_id=? and message_id=?', [
    getCurrentUserId(userId),
    messageId
  ])
}

const getUploadTaskByTaskId = async (taskId, userId) => {
  return queryOne('select * from upload_task where user_id=? and task_id=?', [
    getCurrentUserId(userId),
    taskId
  ])
}

const listUploadTasksByStates = async (states = [], userId) => {
  if (!Array.isArray(states) || states.length === 0) return []
  const placeholders = states.map(() => '?').join(',')
  return queryAll(
    `select * from upload_task where user_id=? and state in (${placeholders}) order by updated_at asc`,
    [getCurrentUserId(userId), ...states]
  )
}

const deleteUploadTask = async (taskId, userId) => {
  return runStrict('delete from upload_task where user_id=? and task_id=?', [getCurrentUserId(userId), taskId])
}

export {
  deleteUploadTask,
  getUploadTaskByMessageId,
  getUploadTaskByTaskId,
  listUploadTasksByStates,
  saveUploadTask
}
