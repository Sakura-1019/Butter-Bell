import { describe, expect, it } from 'vitest'
import { groupArchives } from './volumes'

const f = (name: string, size = 100) => ({ name, size })

describe('groupArchives', () => {
  it('单个文件就是一个压缩包', () => {
    const [a] = groupArchives([f('Paper Garden.rar', 500)])
    expect(a).toEqual({
      firstVolumeName: 'Paper Garden.rar',
      stem: 'Paper Garden',
      format: 'rar',
      multiVolume: false,
      volumes: [f('Paper Garden.rar', 500)],
      totalSize: 500,
      missing: []
    })
  })

  it('.partN.rar 合成一个压缩包，按序号排，大小相加', () => {
    const out = groupArchives([f('StarlitFishing.part2.rar', 2), f('StarlitFishing.part1.rar', 1), f('StarlitFishing.part3.rar', 3)])
    expect(out).toHaveLength(1)
    expect(out[0].firstVolumeName).toBe('StarlitFishing.part1.rar')
    expect(out[0].volumes.map((v) => v.name)).toEqual([
      'StarlitFishing.part1.rar',
      'StarlitFishing.part2.rar',
      'StarlitFishing.part3.rar'
    ])
    expect(out[0]).toMatchObject({ format: 'rar', multiVolume: true, totalSize: 6, missing: [] })
  })

  it('.part01 (2).rar 这种重复下载的后缀也能合成一组，且不和不带后缀的混在一起', () => {
    const out = groupArchives([
      f('Clockwork.part01 (2).rar'),
      f('Clockwork.part02 (2).rar'),
      f('Clockwork.part01.rar')
    ])
    expect(out.map((a) => a.volumes.map((v) => v.name))).toEqual([
      ['Clockwork.part01 (2).rar', 'Clockwork.part02 (2).rar'],
      ['Clockwork.part01.rar']
    ])
  })

  it('_part1.rar 也算分卷', () => {
    const out = groupArchives([
      f('雪原の郵便配達～はじまりの冬～_part1.rar'),
      f('雪原の郵便配達～はじまりの冬～_part2.rar')
    ])
    expect(out).toHaveLength(1)
    expect(out[0].multiVolume).toBe(true)
  })

  it('.7z.001 / _7z.001 / .zip.001 / 纯 .001 都能识别', () => {
    const out = groupArchives([
      f('NeonKoiDrift-0.4.5-PC.7z.001'),
      f('NeonKoiDrift-0.4.5-PC.7z.002'),
      f('3D_SLG_HAKO_II_ハコニワ・テツドウII_ver1_0_d_DL官方中文_7z.001'),
      f('3D_SLG_HAKO_II_ハコニワ・テツドウII_ver1_0_d_DL官方中文_7z.002'),
      f('game.zip.001'),
      f('game.zip.002'),
      f('movie.001'),
      f('movie.002')
    ])
    expect(out.map((a) => [a.firstVolumeName, a.format, a.volumes.length])).toEqual([
      ['NeonKoiDrift-0.4.5-PC.7z.001', '7z', 2],
      ['3D_SLG_HAKO_II_ハコニワ・テツドウII_ver1_0_d_DL官方中文_7z.001', '7z', 2],
      ['game.zip.001', 'zip', 2],
      ['movie.001', '7z', 2]
    ])
    expect(out.map((a) => a.stem)).toEqual(['NeonKoiDrift-0.4.5-PC', '3D_SLG_HAKO_II_ハコニワ・テツドウII_ver1_0_d_DL官方中文', 'game', 'movie'])
  })

  it('报告中间缺的分卷；首卷缺了就用现有最小的那卷当首卷', () => {
    const [a] = groupArchives([
      f('星屑キャラバン！第二章！_魔法学園！_7z.002'),
      f('星屑キャラバン！第二章！_魔法学園！_7z.004')
    ])
    expect(a.missing).toEqual([1, 3])
    expect(a.firstVolumeName).toBe('星屑キャラバン！第二章！_魔法学園！_7z.002')
  })

  it('认得 7z、zip、zst，跳过不是压缩包的文件', () => {
    const out = groupArchives([
      f('ひだまり農園.7z'),
      f('Melody Ver1.05.zip'),
      f('星空的魔塔.tar.zst'),
      f('灯台守を目指す少年は今日も鍵をさがすのであった!_tar.zst'),
      f('からくりキャッスル!.tar.zst.rar'),
      f('cover.jpg'),
      f('攻略说明第2章.pdf')
    ])
    expect(out.map((a) => [a.format, a.stem])).toEqual([
      ['7z', 'ひだまり農園'],
      ['zip', 'Melody Ver1.05'],
      ['zst', '星空的魔塔'],
      ['zst', '灯台守を目指す少年は今日も鍵をさがすのであった!'],
      ['rar', 'からくりキャッスル!']
    ])
  })
})
