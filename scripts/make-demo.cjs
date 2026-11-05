// 生成一份演示用的数据目录：虚构的全年龄游戏、代码画的几何封面、几个待解压条目。README 截图用它。
//   npx electron scripts/make-demo.cjs <输出文件夹>
//   然后 BUTTER_BELL_DATA=<输出文件夹>\data npm run dev
// 只写进 <输出文件夹>，不碰平时的库。压缩包和游戏文件夹都只写进库、不建真文件
// （仓库目录和游戏目录指向不存在的文件夹，扫描时会跳过），所以收件箱里的条目解不开，游戏也启动不了，只用来看和截图。
const { app, BrowserWindow } = require('electron')
const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const Database = require('better-sqlite3')

const out = resolve(process.argv[2] ?? '')
if (!process.argv[2] || existsSync(join(out, 'data'))) {
  console.error('用法：npx electron scripts/make-demo.cjs <一个新的输出文件夹>（里面不能已经有 data）')
  process.exit(1)
}

// 封面：同原型（prototype/index.html 的 coverSVG），400×300 的几何图
const PALETTES = [
  ['#1f3a5f', '#f2c14e', '#f78154', '#e8e1d0'],
  ['#2d4a3e', '#e9c46a', '#a7c4a0', '#f4ede0'],
  ['#5b2a3c', '#f4a259', '#f7d6bf', '#e0c3a8'],
  ['#e8dcc8', '#c8553d', '#2e4057', '#f2b134'],
  ['#203040', '#86bbd8', '#f6ae2d', '#f26419'],
  ['#f1e3d3', '#99c1b9', '#d88c9a', '#5d737e'],
  ['#2b2d42', '#ef8354', '#bfc0c0', '#ffffff'],
  ['#3d5a40', '#f0c987', '#d9734e', '#efe6d8'],
  ['#0f4c5c', '#e36414', '#fb8b24', '#f6e7cb'],
  ['#e0e7e9', '#2f6690', '#3a7ca5', '#d9a441']
]
function rng(seed) {
  let s = seed * 9301 + 49297
  return () => (s = (s * 9301 + 49297) % 233280) / 233280
}
function coverSVG(seed) {
  const r = rng(seed)
  const [bg, a, b, c] = PALETTES[seed % PALETTES.length]
  const kind = Math.floor(seed / PALETTES.length + r() * 6) % 6
  let g = `<rect width="400" height="300" fill="${bg}"/>`
  if (kind === 0) {
    const cx = 120 + r() * 160
    g += `<circle cx="${cx}" cy="150" r="${60 + r() * 30}" fill="${a}"/><rect y="182" width="400" height="118" fill="${b}"/>`
    for (let i = 0; i < 5; i++) g += `<rect x="${cx - 70 + i * 6}" y="${196 + i * 14}" width="${140 - i * 12}" height="4" rx="2" fill="${c}" opacity=".7"/>`
  } else if (kind === 1) {
    g += `<circle cx="${80 + r() * 240}" cy="${70 + r() * 30}" r="26" fill="${c}"/>`
    g += `<path d="M0 230 L${90 + r() * 40} ${120 + r() * 30} L260 230Z" fill="${a}"/><path d="M120 300 L${260 + r() * 40} ${130 + r() * 30} L400 260 V300Z" fill="${b}"/><rect y="250" width="400" height="50" fill="${b}"/>`
  } else if (kind === 2) {
    for (let i = 0; i < 4; i++) g += `<path d="M${-100 + i * 110} 300 L${60 + i * 110} 0 L${110 + i * 110} 0 L${-50 + i * 110} 300Z" fill="${[a, b, c, a][i]}" opacity="${i === 3 ? 0.5 : 1}"/>`
    g += `<circle cx="${280 + r() * 60}" cy="${80 + r() * 40}" r="34" fill="${bg}"/>`
  } else if (kind === 3) {
    for (let x = 0; x < 10; x++) for (let y = 0; y < 7; y++) g += `<circle cx="${30 + x * 38}" cy="${30 + y * 40}" r="3" fill="${c}" opacity=".45"/>`
    g += `<circle cx="${140 + r() * 120}" cy="160" r="96" fill="${a}"/><circle cx="${200 + r() * 80}" cy="${120 + r() * 60}" r="40" fill="${b}"/>`
  } else if (kind === 4) {
    const mx = 110 + r() * 180
    g += `<circle cx="${mx}" cy="140" r="78" fill="${a}"/><circle cx="${mx + 34}" cy="120" r="70" fill="${bg}"/>`
    for (let i = 0; i < 14; i++) g += `<circle cx="${r() * 400}" cy="${r() * 300}" r="${1 + r() * 2.2}" fill="${c}"/>`
    g += `<rect y="262" width="400" height="38" fill="${b}"/>`
  } else {
    for (let i = 0; i < 4; i++) {
      const x = 30 + i * 92
      const h = 120 + r() * 80
      g += `<path d="M${x} 300 V${300 - h} a38 38 0 0 1 76 0 V300Z" fill="${[a, b, c, a][i]}"/>`
    }
    g += `<circle cx="${60 + r() * 280}" cy="56" r="18" fill="${c}"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${g}</svg>`
}

// 全是虚构的名字。min：游玩分钟；last：几小时前玩过；added：几天前加入；gone：已卸载
const GAMES = [
  { title: '星降る夜の図書館', circle: '月見堂', status: 'playing', tags: ['RPG', '探索', '中文'], min: 744, last: 22, added: 51, exe: 'Game.exe', folder: '[月見堂] 星降る夜の図書館 v1.03', ver: '1.03' },
  { title: '雾都面包店', circle: 'こむぎ工房', status: 'completed', tags: ['经营', '治愈', '中文'], min: 1872, last: 410, added: 125, exe: 'Bakery.exe', folder: '霧の街のパン屋さん' },
  { title: 'Clockwork Garden', circle: 'Tin Lantern', status: 'wishlist', tags: ['解谜', 'ADV'], added: 6, exe: 'ClockworkGarden.exe', folder: 'Clockwork Garden 1.0.2', ver: '1.0.2' },
  { title: '海辺のアトリエ日記', circle: '潮風ソフト', status: 'playing', tags: ['经营', '日常'], min: 408, last: 2, added: 30, exe: 'Atelier.exe', le: true, folder: '海辺のアトリエ日記' },
  { title: '灯台守と七つの鍵', circle: '白線舎', status: 'completed', tags: ['ADV', '解谜'], min: 570, last: 840, added: 64, exe: 'Game.exe', le: true, folder: '灯台守と七つの鍵' },
  { title: '夏雲ラジオ', circle: '青空回路', status: 'wishlist', tags: ['ADV', '日常'], added: 14, exe: 'NatsugumoRadio.exe', le: true, folder: '夏雲ラジオ_ver1.1', ver: '1.1' },
  { title: '魔女見習いの薬草帖', circle: '月見堂', status: 'completed', tags: ['RPG', '收集'], min: 1320, last: 2000, added: 136, exe: 'Game.exe', folder: '魔女見習いの薬草帖' },
  { title: 'Paper Moon Express', circle: 'Kite & Key', status: 'playing', tags: ['动作', '横版'], min: 192, last: 47, added: 8, exe: 'PaperMoon.exe', folder: 'PaperMoonExpress_Win' },
  { title: '雪原の郵便配達', circle: '北窓', status: 'wishlist', tags: ['探索', '治愈'], added: 5, exe: 'Yukihara.exe', le: true, folder: '雪原の郵便配達' },
  { title: 'からくり屋敷の謎', circle: '白線舎', status: 'completed', tags: ['解谜'], min: 246, last: 2860, added: 154, exe: 'Karakuri.exe', le: true, folder: 'からくり屋敷の謎', gone: true },
  { title: '星屑キャラバン', circle: 'Tin Lantern', status: 'completed', tags: ['RPG', '策略'], min: 2436, last: 620, added: 176, exe: 'Caravan.exe', folder: 'Stardust Caravan' },
  { title: '小さな竜と大きな森', circle: 'こむぎ工房', status: 'wishlist', tags: ['RPG', '治愈'], added: 3, exe: 'Game.exe', le: true, folder: '小さな竜と大きな森 体験版' },
  { title: '雨宿りの喫茶店', circle: '潮風ソフト', status: 'completed', tags: ['ADV', '治愈', '中文'], min: 318, last: 214, added: 23, exe: 'Cafe.exe', folder: '雨宿りの喫茶店【汉化】' },
  { title: 'Neon Koi Drift', circle: '青空回路', status: 'wishlist', tags: ['动作'], added: 4, exe: 'NeonKoi.exe', folder: 'NeonKoiDrift' },
  { title: '箱庭鉄道', circle: '北窓', status: 'playing', tags: ['策略', '经营'], min: 942, last: 73, added: 68, exe: 'Hakoniwa.exe', le: true, folder: '箱庭鉄道 v2.10', ver: '2.10' },
  { title: '時計塔のメロディ', circle: 'Kite & Key', status: 'completed', tags: ['ADV'], min: 132, last: 3200, added: 139, exe: 'Melody.exe', le: true, folder: '時計塔のメロディ', gone: true },
  { title: 'ひだまり農園', circle: 'こむぎ工房', status: 'completed', tags: ['经营', '治愈'], min: 1134, last: 1060, added: 98, exe: 'Hidamari.exe', folder: 'ひだまり農園' },
  { title: 'Starlit Fishing Club', circle: '潮風ソフト', status: 'wishlist', tags: ['休闲'], added: 2, exe: 'StarlitFishing.exe', folder: 'Starlit Fishing Club' }
]

// 待解压：分卷、同套建议、看不出内容的名字。sizes 是每个分卷的字节数
const MB = 1024 * 1024
const ARCHIVES = [
  { files: ['Paper Garden v1.2.part1.rar', 'Paper Garden v1.2.part2.rar', 'Paper Garden v1.2.part3.rar'], sizes: [1024 * MB, 1024 * MB, 881 * MB], format: 'rar', hours: 1 },
  { files: ['01_蒼の旅団_ADV.rar'], sizes: [1454 * MB], format: 'rar', hours: 3 },
  { files: ['02_蒼の旅団_動画.rar'], sizes: [983 * MB], format: 'rar', hours: 3 },
  { files: ['03_蒼の旅団_CG集.rar'], sizes: [389 * MB], format: 'rar', hours: 3 },
  { files: ['宵闇商店街.7z.001', '宵闇商店街.7z.002'], sizes: [1024 * MB, 614 * MB], format: '7z', hours: 26 },
  { files: ['GAME.rar'], sizes: [1126 * MB], format: 'rar', hours: 70 },
  { files: ['月影ノ森 体験版.zip'], sizes: [317 * MB], format: 'zip', hours: 190 }
]

const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600e3).toISOString().slice(0, 19) + 'Z'

app.whenReady().then(async () => {
  const data = join(out, 'data')
  mkdirSync(join(data, 'covers'), { recursive: true })
  const db = new Database(join(data, 'library.db'))
  db.pragma('journal_mode = WAL')
  // 和 src/main/db.ts 一样按顺序跑迁移，程序打开时就不会再迁移
  const dir = join(__dirname, '../src/main/migrations')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  files.forEach((f) => db.exec(readFileSync(join(dir, f), 'utf8')))
  db.pragma(`user_version = ${files.length}`)

  const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  set.run('archive_dir', JSON.stringify(join(out, '仓库')))
  set.run('library_dir', JSON.stringify(join(out, '游戏')))
  set.run('post_extract_action', JSON.stringify('move'))
  set.run('check_updates', 'false') // 截图时不联网

  // 在隐藏页面里用 canvas 把 SVG 画成 800×600 的 PNG
  const win = new BrowserWindow({ show: false })
  await win.loadURL('data:text/html,<body></body>')
  const png = (svg) =>
    win.webContents.executeJavaScript(`new Promise((ok, fail) => {
      const img = new Image(); img.onerror = fail
      img.onload = () => { const c = document.createElement('canvas'); c.width = 800; c.height = 600
        c.getContext('2d').drawImage(img, 0, 0, 800, 600); ok(c.toDataURL('image/png')) }
      img.src = ${JSON.stringify('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg))} })`)

  const addGame = db.prepare(
    `INSERT INTO games (title, circle, cover_file, cover_source, play_status, folder_name, uninstalled_at, launch_file, use_locale_emulator, source_kind, added_at, version)
     VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, 'manual', ?, ?)`
  )
  const addTag = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT (name) DO NOTHING')
  const tagGame = db.prepare('INSERT INTO game_tags (game_id, tag_id) SELECT ?, id FROM tags WHERE name = ?')
  const addSession = db.prepare('INSERT INTO play_sessions (game_id, started_at, ended_at, seconds) VALUES (?, ?, ?, ?)')
  for (const [i, g] of GAMES.entries()) {
    const cover = `covers/demo-${i + 1}.png`
    writeFileSync(join(data, cover), Buffer.from((await png(coverSVG((i + 1) * 7 + 3))).split(',')[1], 'base64'))
    const id = addGame.run(g.title, g.circle, cover, g.status, g.folder, g.gone ? iso(g.last - 1) : null, g.exe, g.le ? 1 : 0, iso(g.added * 24), g.ver ?? null).lastInsertRowid
    for (const t of g.tags) (addTag.run(t), tagGame.run(id, t))
    if (g.min) addSession.run(id, iso(g.last), iso(g.last - g.min / 60), g.min * 60)
  }
  win.destroy()

  const addArchive = db.prepare(`INSERT INTO archives (first_volume_name, total_size, format, current_dir, first_seen_at) VALUES (?, ?, ?, '', ?)`)
  const addVolume = db.prepare('INSERT INTO volumes (archive_id, seq, file_name, size, modified_at) VALUES (?, ?, ?, ?, ?)')
  for (const a of ARCHIVES) {
    const id = addArchive.run(a.files[0], a.sizes.reduce((x, y) => x + y), a.format, iso(a.hours)).lastInsertRowid
    a.files.forEach((f, i) => addVolume.run(id, i + 1, f, a.sizes[i], iso(a.hours)))
  }
  db.close()
  console.log(`演示数据：${data}（${GAMES.length} 个游戏，${ARCHIVES.length} 个待解压）`)
  app.quit()
}).catch((e) => {
  console.error(e)
  app.exit(1)
})
