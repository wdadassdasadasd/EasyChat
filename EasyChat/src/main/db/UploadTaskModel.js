import { insertOrReplaceStrict, queryAll, queryOne, runInTransaction, runStrict } from './ADB.js'

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

/**
 * Applies a task patch only when its persisted state is one of the expected
 * states. Keeping the read/merge/write sequence in a single DB transaction
 * prevents a late ACK or an aborted upload attempt from restoring stale state.
 */
const transitionUploadTask = async ({ taskId, allowedStates = [], patch = {} } = {}, userId) => {
  const ownerUserId = getCurrentUserId(userId || patch.userId)
  if (!taskId || !Array.isArray(allowedStates) || allowedStates.length === 0) {
    throw new Error('Upload task transition requires taskId and allowedStates')
  }

  return await runInTransaction(async () => {
    const previous = await queryOne('select * from upload_task where user_id=? and task_id=?', [
      ownerUserId,
      taskId
    ])
    if (!previous || !allowedStates.includes(previous.state)) {
      return { transitioned: false, task: previous || null }
    }
    const next = {
      ...previous,
      ...patch,
      taskId: previous.taskId,
      userId: ownerUserId,
      createdAt: previous.createdAt,
      updatedAt: Date.now()
    }
    await insertOrReplaceStrict('upload_task', next)
    return { transitioned: true, task: next }
  })
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
  saveUploadTask,
  transitionUploadTask
}
