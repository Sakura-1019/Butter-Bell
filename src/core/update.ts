// 检查更新：问 GitHub Releases 最新的正式版，比当前版本新就提示。只提示，不下载。
// 仓库写在 package.json 的 repository 里；没写就不检查、不发请求。

// "owner/repo"、"github:owner/repo"、GitHub 网址、{ url } 都认；别的网站不算
export function parseRepo(repository: unknown): string | null {
  const s = typeof repository === 'object' && repository ? (repository as { url?: unknown }).url : repository
  if (typeof s !== 'string') return null
  const m = s.trim().match(/^(?:github:|(?:git\+)?https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  return m ? `${m[1]}/${m[2]}` : null
}

export const releasesApi = (repo: string) => `https://api.github.com/repos/${repo}/releases/latest`

const parts = (v: string) => v.replace(/^v/i, '').match(/^\d+(?:\.\d+)*/)?.[0].split('.').map(Number) ?? null

// 只比数字部分：1.2.3；v 开头也行。认不出版本号的不算新
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest)
  const b = parts(current)
  if (!a || !b) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d > 0
  }
  return false
}

export interface Release {
  version: string
  url: string // 浏览器打开的下载页
}

// GitHub 的 releases/latest 返回的 JSON。下载页只认这个仓库自己的 releases 页面
export function latestRelease(json: unknown, repo: string): Release | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const r = json as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown }
  if (r.draft || r.prerelease || typeof r.tag_name !== 'string' || !parts(r.tag_name)) return null
  const home = `https://github.com/${repo}/releases`
  const url = typeof r.html_url === 'string' && r.html_url.startsWith(home + '/') ? r.html_url : home
  return { version: r.tag_name.replace(/^v/i, ''), url }
}
