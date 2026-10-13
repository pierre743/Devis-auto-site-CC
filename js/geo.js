/**
 * Cocktail Coast — géocodage et distance routière via la Géoplateforme IGN.
 * Gratuit, sans clé, CORS ouvert : appelé directement depuis le navigateur.
 *  - Autocomplétion : https://data.geopf.fr/geocodage/completion (adresses + lieux nommés)
 *  - Itinéraire     : https://data.geopf.fr/navigation/itineraire (moteur OSRM sur la BD TOPO)
 */
(function (root) {
  'use strict';

  var COMPLETION_URL = 'https://data.geopf.fr/geocodage/completion/';
  var ROUTE_URL = 'https://data.geopf.fr/navigation/itineraire';
  var CACHE_PREFIX = 'ccd_route_';

  function cacheGet(key) {
    try { var v = sessionStorage.getItem(CACHE_PREFIX + key); return v === null ? null : Number(v); }
    catch (e) { return null; }
  }
  function cacheSet(key, value) {
    try { sessionStorage.setItem(CACHE_PREFIX + key, String(value)); } catch (e) { /* stockage indisponible */ }
  }

  /** Suggestions d'adresses / lieux. Renvoie [{ label, kind, isPlace, lon, lat }]. */
  function search(text, signal) {
    var url = COMPLETION_URL + '?' + new URLSearchParams({
      text: text,
      maximumResponses: '7',
      type: 'StreetAddress,PositionOfInterest'
    });
    return fetch(url, { signal: signal })
      .then(function (r) { if (!r.ok) throw new Error('completion ' + r.status); return r.json(); })
      .then(function (data) {
        return (data.results || []).map(function (r) {
          return {
            label: r.fulltext,
            kind: r.kind,
            isPlace: r.country === 'PositionOfInterest',
            lon: r.x,
            lat: r.y
          };
        });
      });
  }

  /** Distance routière ALLER en km, de `from` vers `to` ({lon, lat}). Résultat mis en cache pour la session. */
  function distanceKm(from, to, signal) {
    var key = [from.lon, from.lat, to.lon, to.lat].map(function (n) { return n.toFixed(5); }).join(',');
    var cached = cacheGet(key);
    if (cached !== null) return Promise.resolve(cached);

    var url = ROUTE_URL + '?' + new URLSearchParams({
      resource: 'bdtopo-osrm',
      profile: 'car',
      optimization: 'fastest',
      start: from.lon + ',' + from.lat,
      end: to.lon + ',' + to.lat,
      distanceUnit: 'kilometer',
      getSteps: 'false',
      getBbox: 'false'
    });
    return fetch(url, { signal: signal })
      .then(function (r) { if (!r.ok) throw new Error('itineraire ' + r.status); return r.json(); })
      .then(function (data) {
        var km = Math.round(Number(data.distance) * 10) / 10;
        if (!isFinite(km)) throw new Error('distance invalide');
        cacheSet(key, km);
        return km;
      });
  }

  root.CCGeo = { search: search, distanceKm: distanceKm };
})(typeof self !== 'undefined' ? self : this);
