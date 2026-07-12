import {
  ElCascader,
  ElCheckbox,
  ElCheckboxGroup,
  ElDialog,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElImage,
  ElInfiniteScroll,
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

const elementPlusAppPlugins = [
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
  ElInfiniteScroll
]

export const installElementPlusAppFeatures = (app) => {
  elementPlusAppPlugins.forEach((plugin) => app.use(plugin))
  return app
}

export { elementPlusAppPlugins }
