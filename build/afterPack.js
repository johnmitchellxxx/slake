// After the Mac app is assembled, give it a free "ad hoc" signature.
// Apple Silicon Macs won't open an app with no signature at all; this is the
// no-cost kind (a paid Apple certificate would replace it later).
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log('  • ad hoc signing', app)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
