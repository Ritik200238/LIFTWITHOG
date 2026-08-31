/**
 * A browser stand-in for Node's `stream/promises`.
 *
 * The 0G compute SDK does `await import('stream/promises')` inside code paths
 * that read files from disk. Those paths never run in a browser, but the
 * bundler still has to resolve the specifier — and `stream-browserify`, which
 * the node polyfill plugin maps `stream` to, publishes no `/promises` subpath.
 * Without this the whole app fails to build, which is where it stood.
 *
 * Deliberately throwing rather than returning a no-op. If one of those paths
 * ever does execute in a browser, a loud failure names the cause; a silent
 * resolve would surface later as an upload that reported success and moved
 * nothing.
 */

function unavailable(name) {
  return () =>
    Promise.reject(
      new Error(
        `stream/promises.${name} is not available in the browser. ` +
          'This code path belongs on the server.',
      ),
    )
}

export const pipeline = unavailable('pipeline')
export const finished = unavailable('finished')

export default { pipeline, finished }
