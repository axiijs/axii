// Site version source: this repository's package.json (per the design doc's
// "axii 对外信息" background fact — the local package.json is the canonical
// version for the site, not the npm latest, since the site ships with the
// library version it documents).
import libraryPackage from '../../package.json' with { type: 'json' }

export const siteVersion: string = libraryPackage.version
