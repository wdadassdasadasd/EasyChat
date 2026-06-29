import {
  ElButton,
  ElCascader,
  ElCheckbox,
  ElCheckboxGroup,
  ElConfigProvider,
  ElDialog,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElForm,
  ElFormItem,
  ElIcon,
  ElImage,
  ElInfiniteScroll,
  ElInput,
  ElLoading,
  ElPopover,
  ElProgress,
  ElRadio,
  ElRadioGroup,
  ElSwitch,
  ElTabPane,
  ElTabs,
  ElTag,
  ElUpload
} from 'element-plus'

const elementPlusPlugins = [
  ElConfigProvider,
  ElForm,
  ElFormItem,
  ElInput,
  ElButton,
  ElIcon,
  ElSwitch,
  ElTag,
  ElRadio,
  ElRadioGroup,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElUpload,
  ElImage,
  ElPopover,
  ElDialog,
  ElProgress,
  ElTabs,
  ElTabPane,
  ElCascader,
  ElCheckbox,
  ElCheckboxGroup,
  ElInfiniteScroll,
  ElLoading
]

export const installElementPlus = (app) => {
  elementPlusPlugins.forEach((plugin) => app.use(plugin))
  return app
}

export { elementPlusPlugins }

export default installElementPlus
