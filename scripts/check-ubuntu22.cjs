// Only public packages and a read-only checker enter the containers. No user profile mount.
const { execFile } = require('node:child_process'), { promisify } = require('node:util'), path = require('node:path')
const exec = promisify(execFile), manifest = require('../package.json')
async function check() {
  const image = 'public.ecr.aws/docker/library/ubuntu:22.04'
  const root = path.resolve(__dirname, '..'), name = `libitum-compat-ubuntu22-${process.pid}`
  const deb = path.join(root, 'release', `libitum-music-${manifest.version}-amd64.deb`)
  console.log('ubuntu22: installing in disposable container…')
  try {
    const network = process.env.LIBITUM_COMPAT_NETWORK === 'host' ? ['--network','host'] : []
    const { stdout } = await exec('docker', ['run', '--rm', '--init', '--name', name, ...network,
      '--mount', `type=bind,src=${deb},dst=/input/app.deb,readonly`,
      '--mount', `type=bind,src=${path.join(__dirname,'check-linux-runtime.cjs')},dst=/input/check.cjs,readonly`,
      image, 'sh', '-ec',
      'export DEBIAN_FRONTEND=noninteractive; apt-get -qq -o Acquire::ForceIPv4=true -o Acquire::Retries=3 -o Acquire::http::Timeout=30 update; apt-get -qq -o Acquire::ForceIPv4=true -o Acquire::Retries=3 -o Acquire::http::Timeout=30 install --no-install-recommends -y /input/app.deb ca-certificates fontconfig; ELECTRON_RUN_AS_NODE=1 /opt/cloud-music-player/cloud-music-player /input/check.cjs'
    ], { timeout: 600000, maxBuffer: 8_000_000 })
    const report = stdout.split('\n').find(line => line.startsWith('{"system":'))
    if (!report) throw new Error('No compatibility report returned')
    console.log(report)
  } catch (error) {
    console.error('ubuntu22: failed')
    console.error((error.stderr || error.message).slice(-2500)); if(error.stdout) console.error(error.stdout.split('\n').slice(-5).join('\n')); process.exitCode = 1
  } finally { await exec('docker',['rm','-f',name]).catch(() => {}) }
}
check().catch(error => { console.error(error.message); process.exitCode=1 })
