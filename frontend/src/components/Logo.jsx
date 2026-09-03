/**
 * The mark.
 *
 * One ring. A weight plate seen from the front, the 0 in 0G, and the shape a
 * token has always had — and because it is a single closed band, it is the same
 * object at 110px and at 16px.
 *
 * The first version drew the plate properly: outer band, lip, face, hole. It
 * was more faithful and worse. At any size a phone actually renders it, four
 * concentric edges collapse into grey mush, and the wordmark's O read as a
 * bullet. Detail that only survives at 512px is decoration.
 *
 * Inline SVG rather than an image so it takes `currentColor` — ink on paper,
 * paper on ink, ember where it is the action, from one drawing.
 */
const circle = (r) => `M${120 - r},120a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 -${2 * r},0`

const PLATE = [100, 62].map(circle).join(' ')
/* Slightly thinner as a letter, so it sits at the wordmark's stroke weight. */
const RING = [100, 66].map(circle).join(' ')

export default function Logo({ size = 24, ring = false, className = '', ...rest }) {
  return (
    <svg
      viewBox="0 0 240 240"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path fill="currentColor" fillRule="evenodd" d={ring ? RING : PLATE} />
    </svg>
  )
}

/** LIFTWITHOG with the plate as its O. `size` is the font size in px. */
export function Wordmark({ size = 22, className = '' }) {
  return (
    <span className={'wordmark ' + className} style={{ fontSize: size }} aria-label="LIFTWITHOG">
      LIFTWITH<Logo ring size={size * 0.84} />G
    </span>
  )
}
