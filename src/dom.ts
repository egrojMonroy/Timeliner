type Props = Record<string, string | number | boolean | EventListener | undefined>

/** Small helper to build DOM trees. Props starting with `on` become listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key in node && key !== 'list') Reflect.set(node, key, value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children) if (child != null) node.append(child)
  return node
}
