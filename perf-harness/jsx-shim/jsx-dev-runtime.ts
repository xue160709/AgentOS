import { Fragment, jsxDEV as reactJsxDev } from 'react/jsx-dev-runtime'
import { bumpRenderCount } from './counter'

export { Fragment }

export const jsxDEV: typeof reactJsxDev = (type, props, key, isStatic, source, self) => {
  bumpRenderCount(type)
  return reactJsxDev(type, props, key, isStatic, source, self)
}
