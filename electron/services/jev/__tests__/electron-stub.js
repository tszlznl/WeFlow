/**
 * electron 的占位实现，只给单元测试用。config.ts 在加载 electron-store 时会
 * require('electron')——真实二进制在测试环境装不上也没必要装，这里给出
 * electron-store 启动所需的最小 app API。
 *
 * 绝不要打进产品包：只在 jev 内核的单元测试里通过 esbuild --alias 引入。
 */
const os = require('os')
const path = require('path')

function getPath(name) {
  if (name === 'userData') return path.join(os.tmpdir(), 'weflow-test-userdata')
  if (name === 'home') return os.homedir()
  return os.tmpdir()
}

module.exports = {
  app: { getPath: getPath, getName: function () { return 'WeFlow' }, getVersion: function () { return '0.0.0-test' }, isReady: function () { return true }, on: function () {}, once: function () {} },
  nativeTheme: { on: function () {}, off: function () {} },
  Menu: { buildFromTemplate: function () {}, setApplicationMenu: function () {} }
}
