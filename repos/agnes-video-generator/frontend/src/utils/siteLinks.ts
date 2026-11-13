/**
 * 官网（营销站 video.lichuanyang.top）链接工具（v7.6 外部素材模式 / 即梦协作）。
 *
 * 官网采用 next-intl `localePrefix: 'always'`，即 **URL 永远带语言前缀**
 * （`/zh/...`、`/en/...`），无前缀路径只会 302 到 `/zh`。因此这里统一由
 * 「页面路径 + 当前 UI 语言」拼绝对地址，避免把中文页塞给英文用户。
 *
 * 页面路径由后端工具注册表下发（`core/providers.py` 的 `guide_path` /
 * `faq_path`，只存路径不存域名），未下发时回退下面即梦的默认值——
 * 保证 `/api/providers` 拉取失败时链接仍可用。
 */

import { currentLang, LANGS } from '@/i18n'

/** 官网域名（与全站其它硬链保持一致） */
export const SITE_BASE = 'https://video.lichuanyang.top'

/** 官网支持的 locale（与本项目 LANGS 一一对应，22 种） */
const SITE_LOCALES = LANGS.map((l) => l.code)

/** 即梦（外部素材模式首期唯一工具）的官网说明页路径 — 兜底值 */
export const JIMENG_GUIDE_PATH = '/guides/jimeng-workflow'
/** 即梦工作流常见问题（含 Agnes 503 / queue is full 处理办法）— 兜底值 */
export const JIMENG_FAQ_PATH = '/faq/jimeng'

/**
 * 把官网页面路径拼成带语言前缀的绝对地址。
 *
 * @param path 页面路径（如 `/guides/jimeng-workflow`）；空串返回官网首页。
 * @returns 形如 `https://video.lichuanyang.top/zh/guides/jimeng-workflow`。
 */
export function siteUrl(path: string): string {
  const lang = SITE_LOCALES.includes(currentLang.value) ? currentLang.value : 'zh'
  if (!path) return `${SITE_BASE}/${lang}`
  return `${SITE_BASE}/${lang}${path.startsWith('/') ? path : '/' + path}`
}

/**
 * 工具注册表给的路径优先，缺失时用即梦默认路径兜底。
 *
 * @param path 后端下发的 `guide_path` / `faq_path`。
 * @param fallback 兜底路径（默认即梦说明页）。
 */
export function providerDocUrl(path?: string, fallback: string = JIMENG_GUIDE_PATH): string {
  return siteUrl(path || fallback)
}
