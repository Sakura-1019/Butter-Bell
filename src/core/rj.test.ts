import { describe, expect, it } from 'vitest'
import { extractWorkCode } from './rj'

describe('extractWorkCode', () => {
  it.each([
    ['RJ00079745.part1.rar', 'RJ00079745'],
    ['RJ00472666', 'RJ00472666'],
    ['[RJ123456] 何か', 'RJ123456'],
    ['game_rj654321_v1.0', 'RJ654321'],
    ['ＲＪ０１２３４５６７', 'RJ01234567'],
    ['VJ01000123 体験版', 'VJ01000123'],
    ['BJ123456', 'BJ123456']
  ])('%s → %s', (name, code) => {
    expect(extractWorkCode(name)).toBe(code)
  })

  it.each(['A760888', '110', 'LAMPRPG2', 'RJ12345', 'XRJ123456', 'RJ1234567'])('%s 里没有作品号', (name) => {
    expect(extractWorkCode(name)).toBeNull()
  })
})
