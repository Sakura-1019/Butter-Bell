import { describe, expect, it } from 'vitest'
import { isNewer, latestRelease, parseRepo, releasesApi, repoUrl } from './update'

describe('parseRepo', () => {
  it.each([
    ['owner/repo', 'owner/repo'],
    ['github:owner/repo', 'owner/repo'],
    ['https://github.com/owner/butter-bell', 'owner/butter-bell'],
    ['https://github.com/owner/butter-bell.git', 'owner/butter-bell'],
    ['git+https://github.com/Owner_1/butter.bell.git', 'Owner_1/butter.bell'],
    [{ type: 'git', url: 'https://github.com/owner/repo.git' }, 'owner/repo']
  ])('%j → %s', (input, repo) => {
    expect(parseRepo(input)).toBe(repo)
  })

  it.each([undefined, null, '', 'https://gitlab.com/owner/repo', 'owner', 'owner/repo/extra', { url: '' }])('%j 不算配置了', (input) => {
    expect(parseRepo(input)).toBeNull()
  })
})

describe('releasesApi', () => {
  it('只查最新的正式版（GitHub 的 latest 不含测试版和草稿）', () => {
    expect(releasesApi('owner/repo')).toBe('https://api.github.com/repos/owner/repo/releases/latest')
  })
})

describe('isNewer', () => {
  it.each([
    ['0.2.0', '0.1.0', true],
    ['v0.1.1', '0.1.0', true],
    ['0.10.0', '0.9.9', true],
    ['1.0.0', '0.99.0', true],
    ['0.1.0', '0.1.0', false],
    ['v0.1.0', '0.1.0', false],
    ['0.0.9', '0.1.0', false],
    ['0.2', '0.1.0', true],
    ['0.1', '0.1.0', false],
    ['nightly', '0.1.0', false]
  ])('%s 比 %s 新：%s', (latest, current, newer) => {
    expect(isNewer(latest, current)).toBe(newer)
  })
})

describe('latestRelease', () => {
  const json = { tag_name: 'v0.2.0', html_url: 'https://github.com/owner/repo/releases/tag/v0.2.0', draft: false, prerelease: false }

  it('读出版本号和下载页', () => {
    expect(latestRelease(json, 'owner/repo')).toEqual({ version: '0.2.0', url: 'https://github.com/owner/repo/releases/tag/v0.2.0' })
  })

  it('下载页不在这个仓库的 releases 下面时，换成仓库自己的 releases 页', () => {
    expect(latestRelease({ ...json, html_url: 'https://evil.example/x' }, 'owner/repo')?.url).toBe('https://github.com/owner/repo/releases')
  })

  it.each([
    ['测试版', { ...json, prerelease: true }],
    ['草稿', { ...json, draft: true }],
    ['没有版本号', { ...json, tag_name: 'latest' }],
    ['不是对象', []],
    ['空', null]
  ])('%s → null', (_name, input) => {
    expect(latestRelease(input, 'owner/repo')).toBeNull()
  })
})

describe('repoUrl', () => {
  it('拼出仓库页面', () => expect(repoUrl('owner/repo')).toBe('https://github.com/owner/repo'))
})
