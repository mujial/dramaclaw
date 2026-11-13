/**
 * 剪贴板公共工具（v6.1）。
 *
 * 统一「复制」实现：优先 Clipboard API（需安全上下文），不可用或失败时
 * 降级为隐藏 textarea + execCommand('copy')。收敛此前散落在
 * CheckpointDetail / ArtifactCard / PoetryForm 三处的内联实现。
 */

/**
 * 复制文本到剪贴板。
 *
 * @param text 要复制的文本（空串直接视为失败）
 * @returns 是否复制成功
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* Clipboard API 失败（如权限/非安全上下文），走下方降级路径 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      /* ignore */
    }
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
