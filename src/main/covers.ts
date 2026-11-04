// 封面文件存在数据目录的 covers/ 下。换封面时删掉旧文件；自动拿到的封面只换更高一档的（src/core/cover.ts）。
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { decryptRpgImage, findFolderCover, imageType, outranks, rpgTitleImage, type CoverSource } from '../core/cover'
import { listFolder } from './extractor'
import { setCover } from './games'

export function createCovers(db: Database.Database, dataDir: string) {
  const source = (gameId: number) => db.prepare('SELECT cover_source FROM games WHERE id = ?').pluck().get(gameId) as CoverSource | null

  // 存成新文件（文件名带时间，界面上不会读到缓存的旧图），记下来源，删掉被换掉的旧文件
  async function put(gameId: number, bytes: Uint8Array, src: CoverSource): Promise<void> {
    const ext = imageType(bytes)
    if (!ext) throw new Error('封面要是 jpg / png / webp 图片')
    await mkdir(join(dataDir, 'covers'), { recursive: true })
    const file = `covers/${gameId}-${Date.now()}.${ext}`
    await writeFile(join(dataDir, file), bytes)
    const old = setCover(db, gameId, file, src)
    if (old) await rm(join(dataDir, old), { force: true })
  }

  // 自动拿到的封面：比现在的高一档才换，返回换了没有
  async function offer(gameId: number, bytes: Uint8Array, src: CoverSource): Promise<boolean> {
    if (!outranks(src, source(gameId)) || !imageType(bytes)) return false
    await put(gameId, bytes, src)
    return true
  }

  // 游戏文件夹里找：像封面的图片，没有就用 RPG Maker 的标题画面
  async function fromFolder(gameId: number, dir: string): Promise<void> {
    if (!existsSync(dir) || !outranks('rpgmaker', source(gameId))) return
    const paths = await listFolder(dir)
    const pic = findFolderCover(paths)
    if (pic && (await offer(gameId, await readFile(join(dir, pic)), 'folder'))) return
    const read = (p: string) => {
      try {
        return statSync(join(dir, p)).size < 256 * 1024 ? readFileSync(join(dir, p), 'utf8') : undefined
      } catch {
        return undefined
      }
    }
    const title = rpgTitleImage(paths, read)
    if (!title) return
    const bytes = new Uint8Array(await readFile(join(dir, title.path)))
    const png = title.encrypted ? decryptRpgImage(bytes) : bytes
    if (png) await offer(gameId, png, 'rpgmaker')
  }

  return { put, offer, fromFolder }
}
