// 从 build/icon.svg 导出 build/icon.ico（16/24/32/48/256）。用 Electron 自己画，不需要装别的工具：
//   npx electron scripts/make-icon.cjs
// 小尺寸如果有 build/icon-small.svg 就用它（水滴加大，不然 16 像素时看不见）。
const { app, BrowserWindow } = require('electron')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const dir = join(__dirname, '../build')
const SIZES = [16, 24, 32, 48, 256]
const svgFor = (n) => readFileSync(join(dir, n <= 32 && existsSync(join(dir, 'icon-small.svg')) ? 'icon-small.svg' : 'icon.svg'), 'utf8')

app.whenReady().then(async () => {
  // 在隐藏页面里用 canvas 按每个尺寸直接画 SVG，不截图，不受系统缩放影响
  const win = new BrowserWindow({ show: false })
  await win.loadURL('data:text/html,<body></body>')
  const pngs = []
  for (const n of SIZES) {
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgFor(n))
    const data = await win.webContents.executeJavaScript(`new Promise((ok, fail) => {
      const img = new Image(); img.onerror = fail
      img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = ${n}
        c.getContext('2d').drawImage(img, 0, 0, ${n}, ${n}); ok(c.toDataURL('image/png')) }
      img.src = ${JSON.stringify(url)} })`)
    pngs.push(Buffer.from(data.split(',')[1], 'base64'))
  }
  win.destroy()

  // ICO：6 字节文件头 + 每个尺寸 16 字节目录项 + PNG 数据（Vista 起支持 PNG 条目）
  const head = Buffer.alloc(6 + 16 * SIZES.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(SIZES.length, 4)
  let offset = head.length
  SIZES.forEach((n, i) => {
    const e = 6 + 16 * i
    head.writeUInt8(n >= 256 ? 0 : n, e)
    head.writeUInt8(n >= 256 ? 0 : n, e + 1)
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(pngs[i].length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += pngs[i].length
  })
  writeFileSync(join(dir, 'icon.ico'), Buffer.concat([head, ...pngs]))
  console.log('build/icon.ico', SIZES.join('/'))
  app.quit()
}).catch((e) => { console.error(e); app.exit(1) })
