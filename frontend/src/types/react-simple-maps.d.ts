declare module 'react-simple-maps' {
  import type { FC, ReactNode, SVGProps } from 'react'

  export const ComposableMap: FC<{
    projection?: string
    projectionConfig?: Record<string, unknown>
    width?: number
    height?: number
    style?: SVGProps<SVGSVGElement>['style']
    children?: ReactNode
  }>

  export const Geographies: FC<{
    geography: string | object
    children: (props: { geographies: any[] }) => ReactNode
  }>

  export const Geography: FC<{
    geography: any
    onMouseEnter?: () => void
    onMouseLeave?: () => void
    style?: Record<string, Record<string, unknown>>
  }>

  export const ZoomableGroup: FC<{
    center?: [number, number]
    zoom?: number
    minZoom?: number
    maxZoom?: number
    onMoveEnd?: (pos: { coordinates: [number, number]; zoom: number }) => void
    children?: ReactNode
  }>
}
