//确认框封装
import { ElMessageBox } from 'element-plus'

const Confirm = ({
  message,
  okfun,
  showCancelBtn = true,
  showClose = true,
  okText = '确定',
  cancelText = '取消',
  cancelfun
}) => {
  ElMessageBox.confirm(message, '提示', {
    'close-on-click-modal': false,
    confirmButtonText: okText,
    cancelButtonText: cancelText,
    showCancelButton: showCancelBtn,
    showClose: showClose,
    type: 'info'
  })
    .then(async () => {
      if (okfun) {
        try {
          await okfun()
        } catch (error) {
          console.error('Confirm okfun rejected:', error)
        }
      }
    })
    .catch((action) => {
      if (action == 'cancel' && cancelfun) {
        cancelfun()
      }
    })
}

const Alert = (msg, okfun) => {
  ElMessageBox.alert(msg, '确认', {
    confirmButtonText: 'OK',
    showClose: false,
    callback: async (action) => {
      if (action == 'confirm' && okfun) {
        try {
          await okfun()
        } catch (error) {
          console.error('Alert okfun rejected:', error)
        }
      }
    }
  })
}
export { Confirm, Alert }
