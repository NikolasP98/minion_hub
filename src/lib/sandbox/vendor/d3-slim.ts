/**
 * Entry of the sandbox's d3 bundle (`static/vendor/d3-slim.min.js`, built by
 * `bun run vendor:d3`). Tree-shaking for the frame: elements load the library
 * whole, so the only lever is WHICH d3 modules go in. These are the ones a
 * bespoke chart, hierarchy or force layout needs; left out on purpose:
 * d3-geo (map data cannot be fetched — the frame has no network), d3-fetch /
 * d3-dsv (same), d3-brush / d3-contour / d3-delaunay / d3-chord (rare, add
 * when an element asks for them). Rebuild and commit the output after editing.
 */
import * as array from 'd3-array';
import * as axis from 'd3-axis';
import * as drag from 'd3-drag';
import * as force from 'd3-force';
import * as format from 'd3-format';
import * as hierarchy from 'd3-hierarchy';
import * as interpolate from 'd3-interpolate';
import * as scale from 'd3-scale';
import * as chromatic from 'd3-scale-chromatic';
import * as selection from 'd3-selection';
import * as shape from 'd3-shape';
import * as timeFormat from 'd3-time-format';
import * as transition from 'd3-transition';
import * as zoom from 'd3-zoom';

// The bridge resolves `minion.d3` to `window.d3`, like full d3's UMD global.
(window as unknown as { d3: object }).d3 = {
  ...array,
  ...axis,
  ...drag,
  ...force,
  ...format,
  ...hierarchy,
  ...interpolate,
  ...scale,
  ...chromatic,
  ...selection,
  ...shape,
  ...timeFormat,
  ...transition,
  ...zoom,
};
