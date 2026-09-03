/**
 * The mark.
 *
 * A weight plate seen from the front: a band, a hairline gap, and the lip
 * inside it. Also the 0 in 0G, and the shape a token has always had.
 *
 * The lip is the whole idea. Without it this is a circle; with it, it is an
 * object with a rim, and the mark says something about the product rather than
 * just occupying space. An earlier version added the face and the centre hole
 * too, which is more faithful to a real plate and worse as a mark — four
 * concentric edges turn to mush at the sizes a phone actually renders. Three
 * edges survive; four do not.
 *
 * Inline SVG rather than an image so it takes `currentColor` — ink on paper,
 * paper on ink, ember where it is the action, from one drawing.
 */
const circle = (r) => `M${120 - r},120a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 -${2 * r},0`

/*
 * Band, gap, lip. The inner hairline is what separates a weight plate from a
 * plain circle, and it is the whole difference between a mark that means
 * something and a ring.
 */
const PLATE = [100, 70, 62, 58].map(circle).join(' ')
/* As a letter: the same object, band trimmed to the wordmark's stroke weight. */
const RING = [100, 74, 66, 62].map(circle).join(' ')

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
