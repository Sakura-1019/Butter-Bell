// 密码框。不用 type="password"：Chromium 在这种框里会关掉输入法，中文密码打不进去（实测）。
// 改用普通文本框加 CSS 圆点；masked 时不让复制、剪切，也不做拼写检查和自动填充。
import type { InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { masked?: boolean }

export default function PasswordInput({ masked = true, className = 'input', ...rest }: Props) {
  const block = masked ? (e: React.ClipboardEvent) => e.preventDefault() : undefined
  return (
    <input
      {...rest}
      type="text"
      className={masked ? `${className} masked` : className}
      autoComplete="off"
      spellCheck={false}
      onCopy={block}
      onCut={block}
    />
  )
}
