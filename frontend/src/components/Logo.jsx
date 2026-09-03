/**
 * The mark.
 *
 * A weight plate, drawn as one even-odd path of concentric circles: the outer
 * band, a thin lip, the face, and the hole. It is three things at once and all
 * of them are the product — a plate is what gets lifted, the shape is the 0 in
 * 0G, and a disc with a hole is what a token has always looked like.
 *
 * Inline SVG rather than an image so it takes `currentColor`: ink on paper,
 * paper on ink, ember where it is the action. One drawing, no variants to keep
 * in step. `ring` is the same object hollowed for use as the O in the wordmark,
 * where a solid disc read as a bullet.
 */
const circle = (r) => `M${120 - r},120a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 -${2 * r},0`

const PLATE = [100, 86, 82, 23].map(circle).join(' ')
const RING = [100, 68, 60, 56].map(circle).join(' ')

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
