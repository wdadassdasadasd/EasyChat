const regs = {
  email: /^[\w-]+(\.[\w-]+)*@[\w-]+(\.[\w-]+)+$/,
  number: /^\+?[1-9][0-9]*$/,
  // H-22: 统一密码规则为 8-18 位，与 UserInfoPassword.vue 和 UserInfo.vue 一致
  password: /^(?=.*\d)(?=.*[a-zA-Z])[\da-zA-Z~!@#$%^&*_]{8,18}$/,
  version: /^[0-9.]+$/
}

const verify = (rule, value, reg, callback) => {
  if (value) {
    if (reg.test(value)) {
      callback()
    } else {
      callback(new Error(rule.message))
    }
  } else {
    callback()
  }
}

const checkPassword = (value) => {
  return regs.password.test(value)
}

const checkEmail = (value) => {
  return regs.email.test(value)
}

const password = (rule, value, callback) => {
  return verify(rule, value, regs.password, callback)
}

const number = (rule, value, callback) => {
  return verify(rule, value, regs.number, callback)
}
export default {
  checkPassword,
  checkEmail,
  password,
  number
}
