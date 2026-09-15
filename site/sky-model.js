// Mean sidereal time: https://aa.usno.navy.mil/faq/GAST
// Stars in the existing catalogue use equatorial J2000 coordinates.
export const MOSCOW = Object.freeze({lat:55.7558, lon:37.6173, source:'moscow'});
const RAD = Math.PI / 180;
const clamp = x => Math.max(-1, Math.min(1, x));
const wrap = x => ((x % 360) + 360) % 360;

export function observer(coords) {
  if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)
    || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) return MOSCOW;
  return {lat:coords.latitude, lon:coords.longitude, source:'device'};
}

export function siderealDegrees(at, longitude) {
  const d = at / 86400000 + 2440587.5 - 2451545;
  const t = d / 36525;
  return wrap(280.46061837 + 360.98564736629 * d + .000387933 * t*t - t*t*t / 38710000 + longitude);
}

// Precession J2000 -> mean equator/equinox of date (IAU 1976, sufficient for this visual catalogue).
export function precess(ra, dec, at) {
  const t = (at / 86400000 + 2440587.5 - 2451545) / 36525;
  const zeta = (2306.2181*t + .30188*t*t + .017998*t*t*t) / 3600 * RAD;
  const z = (2306.2181*t + 1.09468*t*t + .018203*t*t*t) / 3600 * RAD;
  const theta = (2004.3109*t - .42665*t*t - .041833*t*t*t) / 3600 * RAD;
  const a = ra*15*RAD + zeta, d = dec*RAD;
  const A = Math.cos(d)*Math.sin(a);
  const B = Math.cos(theta)*Math.cos(d)*Math.cos(a) - Math.sin(theta)*Math.sin(d);
  const C = Math.sin(theta)*Math.cos(d)*Math.cos(a) + Math.cos(theta)*Math.sin(d);
  return {ra:wrap((Math.atan2(A,B)+z)/RAD)/15, dec:Math.asin(clamp(C))/RAD};
}

export function horizontal(ra, dec, place, at) {
  const eq = precess(ra, dec, at);
  const h = (siderealDegrees(at, place.lon) - eq.ra*15)*RAD, d = eq.dec*RAD, lat = place.lat*RAD;
  const altitude = Math.asin(clamp(Math.sin(d)*Math.sin(lat) + Math.cos(d)*Math.cos(lat)*Math.cos(h)));
  const azimuth = Math.atan2(-Math.cos(d)*Math.sin(h), Math.sin(d)*Math.cos(lat)-Math.cos(d)*Math.sin(lat)*Math.cos(h));
  return {altitude:altitude/RAD, azimuth:wrap(azimuth/RAD)};
}

export function visibleSky(catalogue, place, at) {
  return catalogue.map(c => ({name:c.n, edges:c.e,
    stars:c.s.map(([ra,dec,mag]) => {
      const point=horizontal(ra,dec,place,at);
      return point.altitude > 0 ? {...point,mag} : null;
    })
  })).filter(c => c.edges.some(([a,b]) => c.stars[a] && c.stars[b]));
}
