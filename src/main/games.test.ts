import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { parseProduct } from '../core/dlsite'
import { openDb, tagsToChinese } from './db'
import { addGame, setLaunchFile } from './extract'
import { applyDlsite, applyManual, listGames } from './games'

const T = '2026-11-03T10:00:00Z'
const detail = parseProduct(readFileSync('src/core/fixtures/dlsite-product-RJ00473501.json', 'utf8'))!

let db: Database.Database, id: number
beforeEach(() => {
  db = openDb(':memory:')
  id = addGame(db, { folderName: '01_蒼の旅団', launchFile: null, members: [] }, T)
})
const game = () => db.prepare('SELECT title, original_title, circle, description, cover_file, source_kind, source_ref FROM games WHERE id = ?').get(id)
const tags = () => db.prepare('SELECT t.name FROM game_tags g JOIN tags t ON t.id = g.tag_id WHERE g.game_id = ? ORDER BY t.name').pluck().all(id)

describe('applyDlsite：DLsite 详情写进游戏记录', () => {
  it('名称还是文件夹名时换成 DLsite 的名字；原名、社团、简介、封面、来源都写上', () => {
    applyDlsite(db, id, detail, 'covers/1.jpg', [], detail.title)
    expect(game()).toEqual({
      title: '蒼の旅団アリアとニナ',
      original_title: '蒼の旅団アリアとニナ',
      circle: 'Tin Lantern',
      description: detail.description,
      cover_file: 'covers/1.jpg',
      source_kind: 'dlsite',
      source_ref: 'RJ00473501'
    })
  })

  it('名称总是用识别页上确认的那个（用户已经改过名也换）；原名仍是 DLsite 的完整名字', () => {
    db.prepare("UPDATE games SET title = '我起的名字' WHERE id = ?").run(id)
    applyDlsite(db, id, detail, 'covers/1.jpg', [], '拼出来的名字')
    expect(game()).toMatchObject({ title: '拼出来的名字', original_title: '蒼の旅団アリアとニナ' })
  })

  it('资料来自 DLsite 的游戏有作品页网址，手动填写和待补资料的没有', () => {
    const url = () => listGames(db).find((g) => g.id === id)!.dlsiteUrl
    expect(url()).toBeNull()
    applyDlsite(db, id, detail, null, [], detail.title)
    expect(url()).toBe('https://www.dlsite.com/maniax/work/=/product_id/RJ00473501.html')
    applyManual(db, id, '自己填的', 'covers/1.png')
    expect(url()).toBeNull()
  })

  it('名称去掉首尾空格；是空的就不写，抛错', () => {
    applyDlsite(db, id, detail, null, [], '  旅団  ')
    expect(game()).toMatchObject({ title: '旅団' })
    expect(() => applyDlsite(db, id, detail, null, [], '   ')).toThrow()
  })

  it('只有勾上的 DLsite 类型词变成标签；已有的同名标签（不分大小写）复用', () => {
    db.prepare("INSERT INTO tags (name) VALUES ('adv')").run()
    applyDlsite(db, id, detail, 'covers/1.jpg', ['ADV', detail.genres[0]], detail.title)
    expect(tags()).toEqual(['adv', detail.genres[0]].sort())
    expect(db.prepare('SELECT COUNT(*) FROM tags').pluck().get()).toBe(2)
  })

  it('再选一次（重新识别）不会重复加标签', () => {
    applyDlsite(db, id, detail, 'covers/1.jpg', ['ADV'], detail.title)
    applyDlsite(db, id, detail, 'covers/2.jpg', ['ADV'], detail.title)
    expect(tags()).toEqual(['ADV'])
    expect(game()).toMatchObject({ cover_file: 'covers/2.jpg' })
  })
})

describe('applyManual：手动填写', () => {
  it('封面可以不给：只写名称和来源，现在的封面和封面来源都不动', () => {
    db.prepare("UPDATE games SET cover_file = 'covers/shot.jpg', cover_source = 'screenshot' WHERE id = ?").run(id)
    applyManual(db, id, '只填名字', null)
    expect(db.prepare('SELECT title, cover_file, cover_source, source_kind FROM games WHERE id = ?').get(id)).toEqual({
      title: '只填名字',
      cover_file: 'covers/shot.jpg',
      cover_source: 'screenshot',
      source_kind: 'manual'
    })
    expect(listGames(db).find((g) => g.id === id)!.needsMetadata).toBe(false)
  })

  it('名称是空的抛错', () => {
    expect(() => applyManual(db, id, '  ', null)).toThrow()
  })

  it('写名称和封面，来源记成 manual', () => {
    applyManual(db, id, '  自己填的  ', 'covers/1.png')
    expect(game()).toMatchObject({ title: '自己填的', cover_file: 'covers/1.png', source_kind: 'manual', source_ref: null })
  })
})

describe('listGames', () => {
  it('列出全部游戏（已卸载的也在，单独标出），新加的在前；带上启动文件、是否待补资料、标签', () => {
    const b = addGame(db, { folderName: 'B', launchFile: 'b.exe', members: [] }, '2026-11-04T00:00:00Z')
    applyDlsite(db, id, detail, 'covers/1.jpg', ['ADV', 'RPG'], detail.title)
    setLaunchFile(db, id, 'Game.exe')
    db.prepare("UPDATE games SET uninstalled_at = ? WHERE id = ?").run(T, id)
    const base = { coverSource: null, version: null, circle: null, playStatus: 'wishlist', uninstalled: false, useLocaleEmulator: false, tags: [], playSeconds: 0, lastPlayedAt: null, favorite: false }
    expect(listGames(db)).toEqual([
      { ...base, id: b, title: 'B', folderName: 'B', coverFile: null, launchFile: 'b.exe', needsMetadata: true, dlsiteUrl: null, sourceKind: null, sourceRef: null, addedAt: '2026-11-04T00:00:00Z', recentExtractAt: '2026-11-04T00:00:00Z' },
      {
        ...base,
        id,
        title: '蒼の旅団アリアとニナ',
        circle: 'Tin Lantern',
        folderName: '01_蒼の旅団',
        coverFile: 'covers/1.jpg',
        coverSource: 'dlsite',
        launchFile: 'Game.exe',
        needsMetadata: false,
        dlsiteUrl: 'https://www.dlsite.com/maniax/work/=/product_id/RJ00473501.html',
        sourceKind: 'dlsite',
        sourceRef: 'RJ00473501',
        uninstalled: true,
        tags: ['ADV', 'RPG'],
        addedAt: T,
        recentExtractAt: T
      }
    ])
  })
})

describe('迁移 005', () => {
  it('games 有 window_title，新游戏是 null', () => {
    expect(db.prepare('SELECT window_title FROM games WHERE id = ?').pluck().get(id)).toBeNull()
  })
})

describe('迁移 006', () => {
  it('新解压的游戏进“最近解压”，收藏默认关', () => {
    expect(db.prepare('SELECT recent_extract_at, favorite FROM games WHERE id = ?').get(id)).toEqual({ recent_extract_at: T, favorite: 0 })
  })
  it('旧的日文类型词换成中文；中文的已经有了就并过去；对不上的不动', () => {
    const b = addGame(db, { folderName: 'B', launchFile: null, members: [] }, T)
    db.prepare('INSERT INTO tags (name) VALUES (?), (?), (?), (?)').run('ドット', 'ファンタジー', '奇幻', '我的标签')
    const tag = (g: number, n: string) => db.prepare('INSERT INTO game_tags (game_id, tag_id) SELECT ?, id FROM tags WHERE name = ?').run(g, n)
    tag(id, 'ドット'), tag(id, 'ファンタジー'), tag(b, '奇幻'), tag(b, 'ファンタジー'), tag(b, '我的标签')
    tagsToChinese(db)
    const names = (g: number) => db.prepare('SELECT t.name FROM game_tags gt JOIN tags t ON t.id = gt.tag_id WHERE gt.game_id = ? ORDER BY t.name').pluck().all(g)
    expect(names(id)).toEqual(['像素', '奇幻'])
    expect(names(b)).toEqual(['奇幻', '我的标签'])
    expect(db.prepare('SELECT name FROM tags ORDER BY name').pluck().all()).toEqual(['像素', '奇幻', '我的标签'])
  })
})
