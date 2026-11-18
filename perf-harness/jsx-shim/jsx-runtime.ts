import { Fragment, jsx as reactJsx, jsxs as reactJsxs } from 'react/jsx-runtime'
import { bumpRenderCount } from './counter'

export { Fragment }

export const jsx: typeof reactJsx = (type, props, key) => {
  bumpRenderCount(type)
  return reactJsx(type, props, key)
}

export const jsxs: typeof reactJsxs = (type, props, key) => {
  bumpRenderCount(type)
  return reactJsxs(type, props, key)
}
