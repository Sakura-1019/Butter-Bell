import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { parseProduct } from '../core/dlsite'
import { openDb } from './db'
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
    applyDlsite(db, id, detail, 'covers/1.jpg', [])
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

  it('用户已经改过名称的不覆盖', () => {
    db.prepare("UPDATE games SET title = '我起的名字' WHERE id = ?").run(id)
    applyDlsite(db, id, detail, 'covers/1.jpg', [])
    expect(game()).toMatchObject({ title: '我起的名字', original_title: '蒼の旅団アリアとニナ' })
  })

  it('只有勾上的 DLsite 类型词变成标签；已有的同名标签（不分大小写）复用', () => {
    db.prepare("INSERT INTO tags (name) VALUES ('adv')").run()
    applyDlsite(db, id, detail, 'covers/1.jpg', ['ADV', detail.genres[0]])
    expect(tags()).toEqual(['adv', detail.genres[0]].sort())
    expect(db.prepare('SELECT COUNT(*) FROM tags').pluck().get()).toBe(2)
  })

  it('再选一次（重新识别）不会重复加标签', () => {
    applyDlsite(db, id, detail, 'covers/1.jpg', ['ADV'])
    applyDlsite(db, id, detail, 'covers/2.jpg', ['ADV'])
    expect(tags()).toEqual(['ADV'])
    expect(game()).toMatchObject({ cover_file: 'covers/2.jpg' })
  })
})

describe('applyManual：手动填写', () => {
  it('写名称和封面，来源记成 manual', () => {
    applyManual(db, id, '  自己填的  ', 'covers/1.png')
    expect(game()).toMatchObject({ title: '自己填的', cover_file: 'covers/1.png', source_kind: 'manual', source_ref: null })
  })
})

describe('listGames', () => {
  it('列出全部游戏（已卸载的也在，单独标出），新加的在前；带上启动文件、是否待补资料、标签', () => {
    const b = addGame(db, { folderName: 'B', launchFile: 'b.exe', members: [] }, '2026-11-04T00:00:00Z')
    applyDlsite(db, id, detail, 'covers/1.jpg', ['ADV', 'RPG'])
    setLaunchFile(db, id, 'Game.exe')
    db.prepare("UPDATE games SET uninstalled_at = ? WHERE id = ?").run(T, id)
    const base = { coverSource: null, version: null, circle: null, playStatus: 'wishlist', uninstalled: false, useLocaleEmulator: false, tags: [], playSeconds: 0, lastPlayedAt: null }
    expect(listGames(db)).toEqual([
      { ...base, id: b, title: 'B', folderName: 'B', coverFile: null, launchFile: 'b.exe', needsMetadata: true, addedAt: '2026-11-04T00:00:00Z' },
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
        uninstalled: true,
        tags: ['ADV', 'RPG'],
        addedAt: T
      }
    ])
  })
})
