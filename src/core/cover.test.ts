import { describe, expect, it } from 'vitest'
import { decryptRpgImage, findFolderCover, isBlankImage, outranks, rpgTitleImage } from './cover'

describe('outranks', () => {
  it('手选 > DLsite > 目录图片 > RPG Maker 标题画面 > 自动截图', () => {
    expect(outranks('dlsite', 'folder')).toBe(true)
    expect(outranks('folder', 'rpgmaker')).toBe(true)
    expect(outranks('rpgmaker', 'screenshot')).toBe(true)
    expect(outranks('screenshot', 'rpgmaker')).toBe(false)
    expect(outranks('folder', 'dlsite')).toBe(false)
    expect(outranks('folder', 'folder')).toBe(false)
  })
  it('没有封面时什么都能放；手选的永远不被自动替换', () => {
    expect(outranks('screenshot', null)).toBe(true)
    expect(outranks('dlsite', 'manual')).toBe(false)
  })
})

describe('findFolderCover', () => {
  it('根目录或浅层里文件名像封面的图片', () => {
    expect(findFolderCover(['Game.exe', 'readme.txt', 'cover.jpg'])).toBe('cover.jpg')
    expect(findFolderCover(['Game/Game.exe', 'Game/Jacket_Front.PNG'])).toBe('Game/Jacket_Front.PNG')
    expect(findFolderCover(['封面.webp', 'x.exe'])).toBe('封面.webp')
  })
  it('按 cover > jacket > package > thumb > title 的顺序，同一档浅的优先', () => {
    expect(findFolderCover(['title.png', 'package.jpg', 'sub/cover.png'])).toBe('sub/cover.png')
    expect(findFolderCover(['a/b/cover.png', 'a/cover.png'])).toBe('a/cover.png')
    expect(findFolderCover(['thumbnail.jpg', 'title.png'])).toBe('thumbnail.jpg')
  })
  it('不要游戏素材目录里的、太深的、不是图片的、只是名字里沾边的', () => {
    expect(findFolderCover(['www/img/titles1/title.png', 'img/system/title.png', 'a/b/c/cover.png', 'cover.txt', 'subtitle.png', 'discovery.jpg'])).toBeNull()
  })
})

describe('rpgTitleImage', () => {
  const read = (files: Record<string, string>) => (p: string) => files[p]
  it('MZ：data/System.json 的 title1Name，在 img/titles1/ 下', () => {
    const paths = ['Game.exe', 'data/System.json', 'img/titles1/Castle.png', 'img/titles1/Other.png']
    expect(rpgTitleImage(paths, read({ 'data/System.json': '﻿{"title1Name":"Castle"}' }))).toEqual({ path: 'img/titles1/Castle.png', encrypted: false })
  })
  it('MV 加密：www/ 下的 .rpgmvp；也认 .png_', () => {
    const sys = { 'Foo/www/data/System.json': '{"title1Name":"Night"}' }
    expect(rpgTitleImage(['Foo/Game.exe', 'Foo/www/data/System.json', 'Foo/www/img/titles1/Night.rpgmvp'], read(sys))).toEqual({
      path: 'Foo/www/img/titles1/Night.rpgmvp',
      encrypted: true
    })
    expect(rpgTitleImage(['data/System.json', 'img/titles1/Night.png_'], read({ 'data/System.json': '{"title1Name":"Night"}' }))?.path).toBe('img/titles1/Night.png_')
  })
  it('没有标题画面、文件不在、不是 RPG Maker：null', () => {
    expect(rpgTitleImage(['data/System.json', 'img/titles1/A.png'], read({ 'data/System.json': '{"title1Name":""}' }))).toBeNull()
    expect(rpgTitleImage(['data/System.json'], read({ 'data/System.json': '{"title1Name":"A"}' }))).toBeNull()
    expect(rpgTitleImage(['Game.exe', 'img/titles1/A.png'], read({}))).toBeNull()
  })
})

describe('decryptRpgImage', () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]
  it('去掉 16 字节的 RPGMV 头，把被异或过的前 16 字节换回 PNG 文件头', () => {
    const header = [0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0]
    const scrambled = PNG.map((b) => b ^ 0x5a)
    const out = decryptRpgImage(new Uint8Array([...header, ...scrambled, 1, 2, 3]))
    expect([...out!]).toEqual([...PNG, 1, 2, 3])
  })
  it('不是 RPGMV 加密格式：null', () => {
    expect(decryptRpgImage(new Uint8Array([...PNG, 1, 2]))).toBeNull()
  })
})

describe('isBlankImage', () => {
  // BGRA
  const img = (w: number, h: number, px: (x: number, y: number) => [number, number, number]) => {
    const b = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [r, g, bl] = px(x, y)
        b.set([bl, g, r, 255], (y * w + x) * 4)
      }
    return b
  }
  it('全黑、纯色：是', () => {
    expect(isBlankImage(img(200, 150, () => [0, 0, 0]), 200, 150)).toBe(true)
    expect(isBlankImage(img(200, 150, () => [250, 250, 250]), 200, 150)).toBe(true)
    expect(isBlankImage(img(200, 150, () => [30, 60, 200]), 200, 150)).toBe(true)
  })
  it('黑底加一小行加载文字：近乎全黑，也算', () => {
    expect(isBlankImage(img(200, 150, (x, y) => (y > 140 && x > 180 ? [255, 255, 255] : [2, 2, 2])), 200, 150)).toBe(true)
  })
  it('正常画面：不是', () => {
    expect(isBlankImage(img(200, 150, (x, y) => [x, y, (x + y) % 256]), 200, 150)).toBe(false)
    expect(isBlankImage(img(200, 150, (x) => (x < 100 ? [0, 0, 0] : [200, 120, 40])), 200, 150)).toBe(false)
  })
})
