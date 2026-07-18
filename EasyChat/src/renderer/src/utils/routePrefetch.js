import { scheduleWhenIdle } from './idleTask'

let scheduled = false
let prefetched = false

export const prefetchSecondaryRoutes = () => {
  if (import.meta.env?.MODE === 'test') return () => {}
  if (scheduled || prefetched) return () => {}
  scheduled = true

  const cancelIdleTask = scheduleWhenIdle(() => {
    scheduled = false
    if (prefetched) return
    prefetched = true
    Promise.all([import('@/views/contact/Contact.vue'), import('@/views/setting/Setting.vue')]).catch(
      (error) => {
        prefetched = false
        console.warn('Failed to prefetch secondary routes', error)
      }
    )
  })
  return () => {
    if (scheduled) scheduled = false
    cancelIdleTask()
  }
}
