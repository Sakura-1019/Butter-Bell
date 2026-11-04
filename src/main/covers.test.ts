// 封面文件的存取和自动找封面：只换更高一档的，被换掉的旧文件删掉
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from './db'
import { addGame } from './extract'
import { createCovers } from './covers'
import { listGames } from './games'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 9, 9])
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])
let root: string, db: Database.Database, id: number, covers: ReturnType<typeof createCovers>
const at = (...p: string[]) => join(root, ...p)
const game = () => listGames(db).find((g) => g.id === id)!
const files = () => (existsSync(at('data/covers')) ? readdirSync(at('data/covers')) : [])

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bb-cover-'))
  mkdirSync(at('game'), { recursive: true })
  db = openDb(':memory:')
  id = addGame(db, { folderName: 'game', launchFile: null, members: [] }, '2026-11-04T00:00:00Z')
  covers = createCovers(db, at('data'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('offer：自动拿到的封面', () => {
  it('没封面就放上；更高一档的替换并删掉旧文件；低一档的不要', async () => {
    expect(await covers.offer(id, PNG, 'screenshot')).toBe(true)
    const first = files()
    expect(first).toHaveLength(1)
    expect(await covers.offer(id, JPG, 'folder')).toBe(true)
    expect(game().coverSource).toBe('folder')
    expect(files()).toHaveLength(1)
    expect(files()).not.toEqual(first) // 被换掉的截图删了
    expect(await covers.offer(id, PNG, 'rpgmaker')).toBe(false)
    expect(game().coverSource).toBe('folder')
  })

  it('手选的永远不被自动替换', async () => {
    await covers.put(id, PNG, 'manual')
    expect(await covers.offer(id, JPG, 'dlsite')).toBe(false)
    expect(game().coverSource).toBe('manual')
  })

  it('不是图片的不收', async () => {
    await expect(covers.put(id, Uint8Array.from([1, 2, 3]), 'manual')).rejects.toThrow()
    expect(files()).toEqual([])
  })
})

describe('fromFolder：游戏目录里的图片 > RPG Maker 标题画面', () => {
  it('有像封面的图片就用它', async () => {
    writeFileSync(at('game/cover.png'), PNG)
    await covers.fromFolder(id, at('game'))
    expect(game().coverSource).toBe('folder')
  })

  it('没有就用 RPG Maker 的标题画面，加密的先还原', async () => {
    mkdirSync(at('game/www/data'), { recursive: true })
    mkdirSync(at('game/www/img/titles1'), { recursive: true })
    writeFileSync(at('game/www/data/System.json'), '{"title1Name":"Castle"}')
    const enc = Uint8Array.from([...Buffer.from('RPGMV\0\0\0\0\x03\x01\0\0\0\0\0'), ...PNG.slice(0, 16).map((b) => b ^ 7), 9, 9])
    writeFileSync(at('game/www/img/titles1/Castle.rpgmvp'), enc)
    await covers.fromFolder(id, at('game'))
    expect(game().coverSource).toBe('rpgmaker')
  })

  it('已经有更好的封面就不动', async () => {
    await covers.put(id, JPG, 'dlsite')
    writeFileSync(at('game/cover.png'), PNG)
    await covers.fromFolder(id, at('game'))
    expect(game().coverSource).toBe('dlsite')
  })
})
