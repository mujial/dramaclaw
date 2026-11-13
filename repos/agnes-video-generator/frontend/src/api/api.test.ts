/**
 * frontend/src/api/api.test.ts — 保存模型请求的字段语义回归。
 *
 * 背景（issue）：文本供应商切回内置 agnes 时，前端把 ``models.text_provider``
 * 置为空串；API 层此前用 falsy 判断跳过该字段，后端视「字段缺席」为不修改，
 * 于是 config.json 里仍留着第三方供应商，文本调用继续打第三方端点。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { saveModels } from '@/api'

function stubFetchCapture() {
  const captured: { body?: FormData } = {}
  vi.stubGlobal('fetch', (_url: string, options: any = {}) => {
    captured.body = options.body
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })
  return captured
}

describe('saveModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('空 text_provider 必须发送显式的 agnes（空串在传输层会丢失）', async () => {
    const cap = stubFetchCapture()
    await saveModels({ text: 'agnes-model', text_provider: '' })
    expect(cap.body?.has('text_provider')).toBe(true)
    expect(cap.body?.get('text_provider')).toBe('agnes')
  })

  it('未传 text_provider 时不发送该字段（后端保持不修改）', async () => {
    const cap = stubFetchCapture()
    await saveModels({ text: 'agnes-model' })
    expect(cap.body?.has('text_provider')).toBe(false)
  })

  it('第三方供应商按原值发送', async () => {
    const cap = stubFetchCapture()
    await saveModels({ text: 'deepseek-chat', text_provider: 'p1' })
    expect(cap.body?.get('text_provider')).toBe('p1')
  })
})
