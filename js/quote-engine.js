/**
 * Cocktail Coast — moteur de calcul du devis.
 *
 * Fonctions pures : (état du formulaire, config) -> devis. Aucun accès au DOM ni au réseau,
 * pour pouvoir être testé sous Node et réutilisé tel quel dans le navigateur.
 *
 * État attendu (toutes les clés sont facultatives tant que le formulaire est incomplet) :
 * {
 *   date: "2027-06-12",
 *   guests: 120,
 *   service1: { start: "18:00", end: "21:00" },
 *   service2: { enabled: false, start: "22:00", end: "00:00" },
 *   cocktails: null,            // null = suivre la recommandation
 *   distanceKm: 42.3,           // distance routière ALLER, null tant que l'adresse n'est pas choisie
 *   beer: {
 *     enabled: false,
 *     kegs: { blonde: 0, ipa: 0 },
 *     service: false, earlyDelivery: false, latePickup: false,
 *     glassware: "ecocup"
 *   }
 * }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CCQuoteEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_PER_DAY = 1440;

  function round2(x) {
    return Math.round((x + Number.EPSILON) * 100) / 100;
  }

  function toMinutes(hhmm) {
    if (typeof hhmm !== 'string' || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
    var p = hhmm.split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }

  /** Convertit un créneau "HH:MM"–"HH:MM" en minutes absolues ; la fin peut passer minuit. */
  function toSlot(service, notBefore) {
    if (!service) return null;
    var start = toMinutes(service.start);
    var end = toMinutes(service.end);
    if (start === null || end === null) return null;
    if (notBefore !== undefined) while (start < notBefore) start += MIN_PER_DAY;
    while (end <= start) end += MIN_PER_DAY;
    return { start: start, end: end, hours: (end - start) / 60 };
  }

  // ---------------------------------------------------------------- Horaires

  function computeSchedule(state, cfg) {
    var sc = cfg.services;
    var res = { s1: null, s2: null, totalHours: 0, pauseHours: 0, errors: [] };

    res.s1 = toSlot(state.service1);
    if (!res.s1) return res;
    if (res.s1.hours < sc.minDurationHours) {
      res.errors.push({ code: 'service1_too_short', field: 'service1' });
    }
    res.totalHours = res.s1.hours;

    if (state.service2 && state.service2.enabled) {
      res.s2 = toSlot(state.service2, res.s1.end);
      if (res.s2) {
        if (res.s2.hours < sc.minDurationHours) {
          res.errors.push({ code: 'service2_too_short', field: 'service2' });
        }
        res.pauseHours = (res.s2.start - res.s1.end) / 60;
        if (res.pauseHours >= 12) res.errors.push({ code: 'service2_order', field: 'service2' });
        res.totalHours += res.s2.hours;
      }
    }
    return res;
  }

  // ---------------------------------------------------------------- Staff

  function computeStaff(guests, cfg) {
    if (!guests || guests < 1) return null;
    var st = cfg.staff;
    for (var i = 0; i < st.table.length; i++) {
      var row = st.table[i];
      if (guests <= row.maxPax) {
        return withTotal({ chef: row.chef, bartenders: row.bartenders, commis: row.commis });
      }
    }
    var o = st.overflow;
    return withTotal({
      chef: o.chef,
      bartenders: o.bartenders,
      commis: Math.ceil((guests - o.abovePax) / o.commisPerPaxAbove)
    });

    function withTotal(s) {
      s.total = s.chef + s.bartenders + s.commis;
      return s;
    }
  }

  // ---------------------------------------------------------------- Cocktails

  function perPersonFor(totalHours, cfg) {
    var reco = cfg.cocktails.recommendation;
    for (var i = 0; i < reco.length; i++) {
      if (reco[i].upToHours === null || totalHours <= reco[i].upToHours) return reco[i].perPerson;
    }
    return reco[reco.length - 1].perPerson;
  }

  function findTier(qty, cfg) {
    var tiers = cfg.cocktails.tiers;
    for (var i = 0; i < tiers.length; i++) {
      if (qty >= tiers[i].min && qty <= tiers[i].max) return { index: i, tier: tiers[i] };
    }
    return null;
  }

  /**
   * Plage autorisée = reco ± adjustPerPerson par personne, bornée par les paliers de prix.
   * status : 'ok' | 'below_min' (< 100 → sur mesure) | 'above_max' (≥ 300 → sur mesure)
   */
  function computeCocktails(guests, totalHours, requested, cfg) {
    var cc = cfg.cocktails;
    var tiers = cc.tiers;
    var floor = tiers[0].min;
    var ceiling = tiers[tiers.length - 1].max;

    var pp = perPersonFor(totalHours, cfg);
    var rawReco = Math.ceil(guests * pp);
    var rawMin = Math.ceil(guests * Math.max(0, pp - cc.adjustPerPerson));
    var rawMax = Math.ceil(guests * (pp + cc.adjustPerPerson));

    var res = { perPerson: pp, rawRecommended: rawReco, status: 'ok' };
    if (rawMax < floor) res.status = 'below_min';
    else if (rawMin > ceiling) res.status = 'above_max';
    if (res.status !== 'ok') return res;

    res.min = Math.max(rawMin, floor);
    res.max = Math.min(rawMax, ceiling);
    res.recommended = Math.min(Math.max(rawReco, res.min), res.max);

    var qty = typeof requested === 'number' && isFinite(requested) ? Math.round(requested) : res.recommended;
    res.quantity = Math.min(Math.max(qty, res.min), res.max);

    var found = findTier(res.quantity, cfg);
    res.tierIndex = found.index;
    res.unitHT = found.tier.unitHT;
    res.totalHT = round2(res.quantity * res.unitHT);

    // "Plus que N cocktails pour atteindre le palier suivant" — seulement si atteignable dans la plage.
    var next = tiers[found.index + 1];
    if (next && next.min <= res.max) {
      res.nextTier = { missing: next.min - res.quantity, unitHT: next.unitHT, atQuantity: next.min };
    }
    return res;
  }

  // ---------------------------------------------------------------- Date / déplacement

  function parseDate(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var p = iso.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  function isVanPaid(iso, cfg) {
    var d = parseDate(iso);
    if (!d) return null;
    var v = cfg.utilityVan;
    var month = d.getUTCMonth() + 1;
    return v.paidWeekdays.indexOf(d.getUTCDay()) !== -1 && month >= v.paidMonthFrom && month <= v.paidMonthTo;
  }

  /** Frais AR. null si distance inconnue. */
  function travelFeeHT(distanceKm, cfg) {
    if (typeof distanceKm !== 'number' || !isFinite(distanceKm)) return null;
    var t = cfg.travel;
    if (distanceKm < t.freeUnderKmOneWay) return 0;
    return round2(distanceKm * 2 * t.pricePerKmHT);
  }

  // ---------------------------------------------------------------- Devis complet

  function computeQuote(state, cfg) {
    state = state || {};
    var lines = [];
    var blocks = [];   // empêchent la validation (sur mesure, hors zone…)
    var missing = [];  // champs encore à remplir
    var guests = Number(state.guests) || 0;

    function addLine(id, label, qty, unitHT, extra) {
      var line = { id: id, label: label, qty: qty, unitHT: unitHT, totalHT: round2(qty * unitHT) };
      for (var k in extra || {}) line[k] = extra[k];
      lines.push(line);
      return line;
    }

    // Gestion de projet : ligne fixe sur chaque devis
    var pm = cfg.projectManagement;
    if (pm) addLine('project', pm.label, 1, pm.priceHT, { intro: pm.intro, description: pm.description });

    // Date → utilitaire
    var vanPaid = isVanPaid(state.date, cfg);
    if (vanPaid === null) missing.push('date');
    else addLine('van', cfg.utilityVan.label, 1, vanPaid ? cfg.utilityVan.priceHT : 0, {
      free: !vanPaid,
      detail: vanPaid ? cfg.utilityVan.reasonPaid : cfg.utilityVan.reasonFree
    });

    // Invités → staff
    if (guests < 1) missing.push('guests');
    var staff = computeStaff(guests, cfg);
    if (staff) addLine('staff', cfg.staff.label, 1, 0, { info: true, staff: staff });

    // Horaires
    var schedule = computeSchedule(state, cfg);
    if (!schedule.s1) missing.push('service1');
    schedule.errors.forEach(function (e) {
      blocks.push({ code: e.code, field: e.field, calendly: e.code !== 'service2_order' });
    });

    // Cocktails
    var cocktails = null;
    if (guests >= 1 && schedule.s1 && !schedule.errors.length) {
      cocktails = computeCocktails(guests, schedule.totalHours, state.cocktails, cfg);
      if (cocktails.status === 'ok') {
        addLine('cocktails', cfg.cocktails.label, cocktails.quantity, cocktails.unitHT);
      } else {
        blocks.push({ code: 'cocktails_' + cocktails.status, field: 'cocktails', calendly: true });
      }
    }

    // Coupure entre services
    if (schedule.s2 && staff) {
      var extraPause = Math.max(0, schedule.pauseHours - cfg.services.maxPauseHours);
      if (extraPause > 0 && schedule.pauseHours < 12) {
        addLine('pause', cfg.services.pauseSurchargeLabel, extraPause * staff.total,
          cfg.services.pauseSurchargePerStaffPerHourHT,
          { detail: String(extraPause).replace('.', ',') + ' h au-delà des ' + cfg.services.maxPauseHours +
              ' h incluses × ' + staff.total + ' pers. × ' + cfg.services.pauseSurchargePerStaffPerHourHT + ' € HT',
            extraHours: extraPause, staffTotal: staff.total });
      }
    }

    // Déplacement
    var travel = travelFeeHT(state.distanceKm, cfg);
    if (travel === null) {
      missing.push('address');
    } else if (state.distanceKm > cfg.travel.maxKmOneWay) {
      blocks.push({ code: 'out_of_zone', field: 'address', calendly: false });
    } else {
      addLine('travel', cfg.travel.label, 1, travel, {
        free: travel === 0,
        detail: round2(state.distanceKm * 2) + ' km A/R'
      });
    }

    // Bière
    var beer = state.beer;
    if (beer && beer.enabled) {
      var bc = cfg.beer;
      var kegs = beer.kegs || {};
      var totalKegs = 0;
      Object.keys(bc.kegs).forEach(function (type) {
        var n = Math.max(0, Math.min(bc.maxKegsPerType, Math.round(Number(kegs[type]) || 0)));
        totalKegs += n;
        if (n > 0) addLine('beer_keg_' + type, bc.kegs[type].label, n, bc.kegs[type].priceHT);
      });

      if (totalKegs === 0) {
        missing.push('beer_kegs');
      } else {
        var tapFree = totalKegs >= bc.tap.freeFromKegs;
        addLine('beer_tap', bc.tap.label, 1, tapFree ? 0 : bc.tap.priceHT, { free: tapFree });

        var glassType = bc.glassware[beer.glassware] ? beer.glassware : bc.defaultGlassware;
        var glass = bc.glassware[glassType];
        addLine('beer_glass', glass.label, totalKegs * bc.glassesPerKeg, glass.unitHT);
      }

      if (beer.service) addLine('beer_service', bc.service.label, 1, bc.service.priceHT);

      [['earlyDelivery', 'beer_early'], ['latePickup', 'beer_late']].forEach(function (opt) {
        if (!beer[opt[0]]) return;
        var o = bc[opt[0]];
        var travelPart = o.addTravelRoundTrip ? (travel || 0) : 0;
        addLine(opt[1], o.label, 1, round2(o.fixedHT + travelPart),
          { detail: travelPart ? 'dont ' + travelPart.toFixed(2) + ' € HT de déplacement' : null,
            pendingTravel: o.addTravelRoundTrip && travel === null });
      });
    }

    // Totaux
    var totalHT = round2(lines.reduce(function (s, l) { return s + l.totalHT; }, 0));
    var vat = round2(totalHT * cfg.vatRate);

    return {
      lines: lines,
      totals: { ht: totalHT, vat: vat, ttc: round2(totalHT + vat) },
      cocktails: cocktails,
      staff: staff,
      schedule: schedule,
      blocks: blocks,
      missing: missing,
      canSubmit: blocks.length === 0 && missing.length === 0
    };
  }

  function ttc(ht, cfg) {
    return round2(ht * (1 + cfg.vatRate));
  }

  return {
    computeQuote: computeQuote,
    computeCocktails: computeCocktails,
    computeStaff: computeStaff,
    computeSchedule: computeSchedule,
    isVanPaid: isVanPaid,
    travelFeeHT: travelFeeHT,
    ttc: ttc,
    round2: round2
  };
});
