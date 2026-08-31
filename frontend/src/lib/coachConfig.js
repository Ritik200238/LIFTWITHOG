/**
 * Where the coach contract lives, with nothing attached.
 *
 * Its own module so that a screen only needing to know *whether* a coach is
 * configured does not have to import `ogCoach.js`, which pulls in ethers and
 * the 0G storage SDK — roughly a megabyte of JavaScript to read one string.
 * The workout screen wants exactly that: hide the coach card on a build with
 * no contract, without paying for the chain to ask.
 */
export const COACH_ADDRESS = import.meta.env?.VITE_COACH_ADDRESS || ''
