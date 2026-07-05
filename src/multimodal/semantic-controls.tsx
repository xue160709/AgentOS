import {
  forwardRef,
  useCallback,
  type ButtonHTMLAttributes,
  type Ref,
} from 'react'
import {
  useInteractionNode,
  type UseInteractionNodeOptions,
} from '@xue160709/omni-ui-react'

type Translate = (path: string, vars?: Record<string, string | number>) => string

export function semanticAliases(
  t: Translate,
  path: string,
  vars?: Record<string, string | number>,
): string[] {
  return t(path, vars)
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function useSemanticNodeRef<TElement extends HTMLElement>(
  options: UseInteractionNodeOptions,
  externalRef?: Ref<TElement>,
) {
  const semanticRef = useInteractionNode<TElement>(options)
  return useCallback(
    (node: TElement | null) => {
      semanticRef(node)
      assignRef(externalRef, node)
    },
    [externalRef, semanticRef],
  )
}

type SemanticButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  semantic: UseInteractionNodeOptions
}

export const SemanticButton = forwardRef<HTMLButtonElement, SemanticButtonProps>(function SemanticButton(
  { semantic, ...props },
  ref,
) {
  const semanticRef = useSemanticNodeRef<HTMLButtonElement>(semantic, ref)
  return <button {...props} ref={semanticRef} />
})

function assignRef<TValue>(ref: Ref<TValue> | undefined, value: TValue | null) {
  if (!ref) return
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  ;(ref as { current: TValue | null }).current = value
}
