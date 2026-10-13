/**
 * Cocktail Coast — interface du devis temps réel.
 * Usage : CCDevis.mount(document.getElementById('cc-devis'), config, { onValidate(quote, state) {} })
 * Dépend de CCQuoteEngine (quote-engine.js) et CCGeo (geo.js).
 */
(function (root) {
  'use strict';

  var E = root.CCQuoteEngine;
  var G = root.CCGeo;

  var eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  var num1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  function money(v) { return eur.format(v); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hhmm(m) { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function toMin(s) { var p = s.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
  function prettyTime(s) { return s.replace(':', 'h'); }
  function prettyHours(h) { var m = Math.round(h * 60); return Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : ''); }
  function prettyDate(iso) {
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return '';
    var s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function debounce(fn, ms) {
    var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); };
  }

  var MISSING_LABELS = {
    date: 'la date de l\'événement',
    guests: 'le nombre d\'invités',
    service1: 'les horaires de service',
    address: 'le lieu de l\'événement',
    beer_kegs: 'au moins un fût de bière (ou désactivez l\'option)'
  };

  // ==================================================================== Gabarit

  function timeOptions(cfg, selected) {
    var sc = cfg.services;
    var start = toMin(sc.earliestStart);
    var end = toMin(sc.latestEnd);
    if (end <= start) end += 1440;
    var html = '';
    for (var m = start; m <= end; m += sc.stepMinutes) {
      var v = hhmm(m);
      html += '<option value="' + v + '"' + (v === selected ? ' selected' : '') + '>' + prettyTime(v) + '</option>';
    }
    return html;
  }

  function serviceBlock(cfg, id, title, s) {
    return '' +
      '<div class="ccd-service" id="ccd-' + id + '">' +
        '<div class="ccd-service-head"><span>' + title + '</span><span class="ccd-badge" id="ccd-' + id + '-badge"></span></div>' +
        '<div class="ccd-row">' +
          '<div><label class="ccd-label" for="ccd-' + id + '-start">Début</label>' +
            '<select class="ccd-select" id="ccd-' + id + '-start" data-svc="' + id + '" data-k="start">' + timeOptions(cfg, s.start) + '</select></div>' +
          '<div><label class="ccd-label" for="ccd-' + id + '-end">Fin</label>' +
            '<select class="ccd-select" id="ccd-' + id + '-end" data-svc="' + id + '" data-k="end">' + timeOptions(cfg, s.end) + '</select></div>' +
        '</div>' +
      '</div>';
  }

  function stepper(id, value, min, max, label) {
    return '' +
      '<div class="ccd-stepper">' +
        '<button type="button" data-step="-1" data-for="' + id + '" aria-label="Diminuer">−</button>' +
        '<input type="number" inputmode="numeric" id="' + id + '" value="' + (value == null ? '' : value) + '" min="' + min + '" max="' + max + '" aria-label="' + esc(label) + '">' +
        '<button type="button" data-step="1" data-for="' + id + '" aria-label="Augmenter">+</button>' +
      '</div>';
  }

  function template(cfg, state) {
    var bc = cfg.beer;
    var tiersHtml = cfg.cocktails.tiers.map(function (t, i) {
      return '<div class="ccd-tier" data-tier="' + i + '"><b>' + money(E.ttc(t.unitHT, cfg)) + '</b>' + t.min + '–' + t.max + ' cocktails</div>';
    }).join('');

    var kegsHtml = Object.keys(bc.kegs).map(function (type) {
      var k = bc.kegs[type];
      return '<div class="ccd-keg"><div><div class="ccd-keg-name">' + esc(k.label) + '</div>' +
        '<div class="ccd-keg-price">' + money(k.priceHT) + ' HT · ' + money(E.ttc(k.priceHT, cfg)) + ' TTC</div></div>' +
        stepper('ccd-keg-' + type, state.beer.kegs[type] || 0, 0, bc.maxKegsPerType, k.label) + '</div>';
    }).join('');

    var glassHtml = Object.keys(bc.glassware).map(function (type) {
      var g = bc.glassware[type];
      return '<label class="ccd-radio"><input type="radio" name="ccd-glass" value="' + type + '"' + (state.beer.glassware === type ? ' checked' : '') + '>' +
        '<b>' + esc(g.label) + '</b><span>' + money(g.unitHT) + ' HT / pièce</span></label>';
    }).join('');

    function check(id, label, sub, priceHtml) {
      return '<label class="ccd-check"><input type="checkbox" id="' + id + '">' +
        '<span><span class="ccd-check-main">' + esc(label) + '</span>' + (sub ? '<span class="ccd-check-sub">' + sub + '</span>' : '') + '</span>' +
        '<span class="ccd-check-price" id="' + id + '-price">' + (priceHtml || '') + '</span></label>';
    }

    return '' +
    '<header class="ccd-head">' +
      '<h1>Votre bar à cocktails <span>sur mesure</span></h1>' +
      '<p>Composez votre prestation : le devis se met à jour en direct. Tous les prix sont indiqués HT et TTC.</p>' +
    '</header>' +
    '<div class="ccd-layout">' +
      '<form class="ccd-form" novalidate onsubmit="return false">' +

        // 1. Date
        '<section class="ccd-step" data-step-id="date">' +
          '<h2 class="ccd-step-title"><span class="ccd-num">1</span>Date de l\'événement</h2>' +
          '<label class="ccd-label" for="ccd-date">Date</label>' +
          '<input type="date" class="ccd-input" id="ccd-date" min="' + todayIso() + '" value="' + esc(state.date) + '">' +
          '<p class="ccd-hint" id="ccd-date-hint"></p>' +
        '</section>' +

        // 2. Invités
        '<section class="ccd-step" data-step-id="guests">' +
          '<h2 class="ccd-step-title"><span class="ccd-num">2</span>Nombre d\'invités</h2>' +
          stepper('ccd-guests', state.guests, 1, 2000, 'Nombre d\'invités') +
          '<div class="ccd-staff" id="ccd-staff"></div>' +
          '<p class="ccd-hint" id="ccd-staff-hint">Le dispositif humain est calculé selon le nombre d\'invités et inclus dans le prix des cocktails.</p>' +
        '</section>' +

        // 3. Horaires
        '<section class="ccd-step" data-step-id="service1">' +
          '<h2 class="ccd-step-title"><span class="ccd-num">3</span>Horaires de service</h2>' +
          serviceBlock(cfg, 's1', 'Service 1', state.service1) +
          '<label class="ccd-check"><input type="checkbox" id="ccd-s2-on"><span><span class="ccd-check-main">Ajouter un 2<sup>e</sup> service</span>' +
            '<span class="ccd-check-sub">Ex. : vin d\'honneur puis soirée. ' + cfg.services.minDurationHours + 'h minimum chacun, coupure de ' + cfg.services.maxPauseHours + 'h maximum incluse.</span></span></label>' +
          '<div id="ccd-s2-wrap" hidden>' + serviceBlock(cfg, 's2', 'Service 2', state.service2) + '</div>' +
          '<div class="ccd-infobox" id="ccd-pause-box" hidden></div>' +
          '<div id="ccd-sched-alert"></div>' +
        '</section>' +

        // 4. Cocktails
        '<section class="ccd-step" data-step-id="cocktails">' +
          '<h2 class="ccd-step-title"><span class="ccd-num">4</span>Nombre de cocktails</h2>' +
          '<p class="ccd-hint" id="ccd-ck-placeholder">Indiquez le nombre d\'invités et vos horaires : nous calculons le volume idéal.</p>' +
          '<div id="ccd-ck-widget" hidden>' +
            '<div class="ccd-cocktail-top">' +
              '<div><div class="ccd-cocktail-qty" id="ccd-ck-qty"></div><div class="ccd-cocktail-pp" id="ccd-ck-pp"></div></div>' +
              '<div class="ccd-stepper">' +
                '<button type="button" id="ccd-ck-minus" aria-label="Moins de cocktails" style="width:56px;font-size:16px">−' + cfg.cocktails.buttonStep + '</button>' +
                '<button type="button" id="ccd-ck-plus" aria-label="Plus de cocktails" style="width:56px;font-size:16px">+' + cfg.cocktails.buttonStep + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="ccd-range-wrap">' +
              '<input type="range" class="ccd-range" id="ccd-ck-range" step="' + cfg.cocktails.sliderStep + '" aria-label="Nombre de cocktails">' +
              '<div class="ccd-marks" id="ccd-ck-marks"></div>' +
            '</div>' +
            '<div class="ccd-tiers">' + tiersHtml + '</div>' +
            '<div class="ccd-nudge" id="ccd-ck-nudge" hidden></div>' +
            '<p class="ccd-hint"><button type="button" class="ccd-link-btn" id="ccd-ck-reset" hidden>Revenir à notre recommandation</button></p>' +
          '</div>' +
          '<div id="ccd-ck-alert"></div>' +
        '</section>' +

        // 5. Lieu
        '<section class="ccd-step" data-step-id="address">' +
          '<h2 class="ccd-step-title"><span class="ccd-num">5</span>Lieu de l\'événement</h2>' +
          '<label class="ccd-label" for="ccd-addr">Adresse ou nom du lieu</label>' +
          '<div class="ccd-ac">' +
            '<input type="text" class="ccd-input" id="ccd-addr" autocomplete="off" placeholder="Ex. : Château Pape Clément, Pessac" ' +
              'role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ccd-addr-list">' +
            '<ul class="ccd-ac-list" id="ccd-addr-list" role="listbox" hidden></ul>' +
          '</div>' +
          '<p class="ccd-hint" id="ccd-addr-status">Départ depuis notre local de Saint-Médard-en-Jalles. Déplacement offert à moins de ' + cfg.travel.freeUnderKmOneWay + ' km.</p>' +
          '<div id="ccd-addr-alert"></div>' +
        '</section>' +

        // 6. Bière
        '<section class="ccd-step" data-step-id="beer">' +
          '<label class="ccd-toggle-card"><span class="ccd-switch"><input type="checkbox" id="ccd-beer-on"><span></span></span>' +
            '<span class="ccd-step-title" style="margin:0"><span class="ccd-num">6</span>Ajouter l\'option bière</span></label>' +
          '<div class="ccd-beer-body" id="ccd-beer-body" hidden>' +
            '<div>' +
              '<p class="ccd-subtitle">Fûts de 30 L' +
                '<span class="ccd-tip"><button type="button" class="ccd-tip-btn" aria-describedby="ccd-tip-beer">i</button>' +
                '<span class="ccd-tip-bubble" role="tooltip" id="ccd-tip-beer">' + esc(bc.tooltip) + '</span></span></p>' +
              '<div class="ccd-kegs">' + kegsHtml + '</div>' +
              '<p class="ccd-hint" id="ccd-beer-reco"></p>' +
              '<p class="ccd-hint" id="ccd-tap-hint"></p>' +
            '</div>' +
            '<div><p class="ccd-subtitle">Verrerie</p><div class="ccd-radios">' + glassHtml + '</div>' +
              '<p class="ccd-hint" id="ccd-glass-hint"></p></div>' +
            '<div><p class="ccd-subtitle">Logistique</p>' +
              check('ccd-beer-service', bc.service.label, null, money(bc.service.priceHT) + ' HT') +
              check('ccd-beer-early', bc.earlyDelivery.label, 'Installation des fûts avant l\'arrivée de l\'équipe.') +
              check('ccd-beer-late', bc.latePickup.label, 'Récupération du matériel après la fin du service.') +
            '</div>' +
            '<p class="ccd-note">' + esc(bc.selfServiceNote) + '</p>' +
          '</div>' +
        '</section>' +
      '</form>' +

      // Récapitulatif
      '<aside class="ccd-recap" id="ccd-recap" aria-live="polite">' +
        '<div class="ccd-recap-head"><h2>Votre devis</h2><div class="ccd-recap-meta" id="ccd-meta">Complétez le formulaire</div>' +
          '<button type="button" class="ccd-recap-close" id="ccd-recap-close" aria-label="Fermer le détail">✕</button></div>' +
        '<div class="ccd-recap-body"><ul class="ccd-lines" id="ccd-lines"></ul></div>' +
        '<div class="ccd-totals" id="ccd-totals"></div>' +
        '<div class="ccd-recap-foot"><div class="ccd-status" id="ccd-status"></div><div id="ccd-cta-wrap"></div>' +
          '<p class="ccd-small">Devis indicatif. Une facture d\'acompte vous sera envoyée pour confirmer la réservation.</p></div>' +
      '</aside>' +
    '</div>' +

    '<div class="ccd-mbar" id="ccd-mbar"><div class="ccd-mbar-total"><small>Total TTC</small><strong id="ccd-mbar-total">—</strong></div>' +
      '<button type="button" id="ccd-mbar-open">Voir le devis</button></div>' +
    '<div class="ccd-backdrop" id="ccd-backdrop" hidden></div>';
  }

  // ==================================================================== Montage

  function mount(rootEl, cfg, opts) {
    opts = opts || {};
    var state = {
      date: '',
      guests: null,
      service1: { start: '19:00', end: '22:00' },
      service2: { enabled: false, start: '23:00', end: '01:00' },
      cocktails: null,
      distanceKm: null,
      address: null,
      beer: { enabled: false, kegs: {}, service: false, earlyDelivery: false, latePickup: false, glassware: cfg.beer.defaultGlassware }
    };
    Object.keys(cfg.beer.kegs).forEach(function (t) { state.beer.kegs[t] = 0; });

    var addr = { status: 'idle', controller: null }; // idle | routing | ok | error

    rootEl.classList.add('ccd');
    rootEl.innerHTML = template(cfg, state);
    var $ = function (id) { return rootEl.querySelector('#' + id); };
    var lastQuote = null;

    // ---------------------------------------------------------------- Rendu

    function update() {
      var q = E.computeQuote(state, cfg);
      lastQuote = q;
      renderDate();
      renderStaff(q);
      renderSchedule(q);
      renderCocktails(q);
      renderAddress(q);
      renderBeer(q);
      renderRecap(q);
      renderSteps(q);
    }

    function blockFor(q, field) {
      return q.blocks.filter(function (b) { return b.field === field; })[0];
    }

    function alertHtml(msg, link) {
      return '<div class="ccd-alert">' + msg + (link ? ' <a href="' + esc(link.href) + '" target="_blank" rel="noopener">' + esc(link.label) + ' →</a>' : '') + '</div>';
    }
    var calendlyLink = { href: cfg.calendlyUrl, label: 'Prendre rendez-vous' };

    function renderDate() {
      $('ccd-date-hint').textContent = E.isVanPaid(state.date, cfg) === null ? '' : prettyDate(state.date);
    }

    function staffChips(s) {
      var parts = [];
      if (s.chef) parts.push(s.chef + ' chef de bar');
      if (s.bartenders) parts.push(s.bartenders + ' bartender' + (s.bartenders > 1 ? 's' : ''));
      if (s.commis) parts.push(s.commis + ' commis');
      return parts;
    }

    function renderStaff(q) {
      $('ccd-staff').innerHTML = q.staff
        ? staffChips(q.staff).map(function (p) { return '<span class="ccd-chip">👤 ' + esc(p) + '</span>'; }).join('')
        : '';
    }

    function renderSchedule(q) {
      var sch = q.schedule;
      [['s1', sch.s1, 'service1_too_short'], ['s2', sch.s2, 'service2_too_short']].forEach(function (s) {
        var badge = $('ccd-' + s[0] + '-badge');
        if (!s[1]) { badge.textContent = ''; return; }
        var bad = q.blocks.some(function (b) { return b.code === s[2]; });
        badge.textContent = prettyHours(s[1].hours) + (bad ? ' — minimum ' + cfg.services.minDurationHours + 'h' : '');
        badge.classList.toggle('is-error', bad);
        rootEl.querySelectorAll('#ccd-' + s[0] + ' select').forEach(function (el) { el.classList.toggle('is-error', bad); });
      });

      var pauseBox = $('ccd-pause-box');
      var order = blockFor(q, 'service2') && blockFor(q, 'service2').code === 'service2_order';
      if (sch.s2 && !order) {
        var pauseLine = q.lines.filter(function (l) { return l.id === 'pause'; })[0];
        var row = function (k, v) { return '<div class="ccd-infobox-row"><span>' + k + '</span><b>' + v + '</b></div>'; };
        var html = row('Coupure entre les services', prettyHours(sch.pauseHours) + (pauseLine ? '' : ' · incluse'));
        if (pauseLine) {
          html += row('Dont incluse', prettyHours(cfg.services.maxPauseHours)) +
            row('Supplément : ' + prettyHours(pauseLine.extraHours) + ' × ' + pauseLine.staffTotal + ' pers. × ' +
              money(cfg.services.pauseSurchargePerStaffPerHourHT) + ' HT', money(pauseLine.totalHT) + ' HT');
        }
        html += row('Durée totale de service', prettyHours(sch.totalHours));
        pauseBox.innerHTML = html;
        pauseBox.className = 'ccd-infobox' + (pauseLine ? ' is-warn' : '');
        pauseBox.hidden = false;
      } else {
        pauseBox.hidden = true;
      }

      var msgs = q.blocks.filter(function (b) { return b.field === 'service1' || b.field === 'service2'; }).map(function (b) {
        if (b.code === 'service2_order') return alertHtml('Le 2<sup>e</sup> service doit commencer après la fin du 1<sup>er</sup>.');
        return alertHtml('Chaque service doit durer au moins ' + cfg.services.minDurationHours + 'h. Pour un format plus court, nous établissons un devis sur mesure.', calendlyLink);
      });
      $('ccd-sched-alert').innerHTML = msgs.join('');
    }

    function renderCocktails(q) {
      var c = q.cocktails;
      var widget = $('ccd-ck-widget');
      var alertEl = $('ccd-ck-alert');
      $('ccd-ck-placeholder').hidden = !!c;
      alertEl.innerHTML = '';
      if (!c || c.status !== 'ok') {
        widget.hidden = true;
        if (c && c.status === 'below_min') {
          alertEl.innerHTML = alertHtml('Notre prestation démarre à ' + cfg.cocktails.tiers[0].min + ' cocktails (votre besoin estimé : ' + c.rawRecommended + '). Parlons de votre projet pour un devis sur mesure.', calendlyLink);
        } else if (c && c.status === 'above_max') {
          alertEl.innerHTML = alertHtml('Au-delà de ' + cfg.cocktails.tiers[cfg.cocktails.tiers.length - 1].max + ' cocktails (votre besoin estimé : ' + c.rawRecommended + '), nous vous proposons un devis sur mesure.', calendlyLink);
        }
        return;
      }
      widget.hidden = false;

      var range = $('ccd-ck-range');
      range.min = c.min; range.max = c.max; range.value = c.quantity;
      var span = c.max - c.min || 1;
      var pct = function (v) { return ((v - c.min) / span) * 100; };
      range.style.setProperty('--fill', pct(c.quantity) + '%');

      $('ccd-ck-qty').innerHTML = c.quantity + '<small>cocktails</small>';
      $('ccd-ck-pp').textContent = 'soit ' + num1.format(c.quantity / state.guests) + ' cocktail(s) par personne · ' + money(E.ttc(c.unitHT, cfg)) + ' TTC le cocktail';
      $('ccd-ck-minus').disabled = c.quantity <= c.min;
      $('ccd-ck-plus').disabled = c.quantity >= c.max;

      var marks = '<span class="ccd-mark is-min" style="left:0"><b>' + c.min + '</b>Min</span>' +
        '<span class="ccd-mark is-max" style="left:100%"><b>' + c.max + '</b>Max</span>';
      if (c.recommended > c.min && c.recommended < c.max) {
        marks += '<span class="ccd-mark is-reco" style="left:' + pct(c.recommended) + '%"><b>' + c.recommended + '</b>Recommandé</span>';
      }
      cfg.cocktails.tiers.forEach(function (t) {
        if (t.min > c.min && t.min <= c.max) marks += '<span class="ccd-tick" style="left:' + pct(t.min) + '%"></span>';
      });
      $('ccd-ck-marks').innerHTML = marks;

      rootEl.querySelectorAll('.ccd-tier').forEach(function (el) {
        el.classList.toggle('is-active', Number(el.dataset.tier) === c.tierIndex);
      });

      var nudge = $('ccd-ck-nudge');
      if (c.nextTier) {
        var currentTTC = E.ttc(c.totalHT, cfg);
        var nextTTC = E.ttc(E.round2(c.nextTier.atQuantity * c.nextTier.unitHT), cfg);
        var diff = nextTTC - currentTTC;
        nudge.hidden = false;
        nudge.innerHTML = '🍹 Plus que ' + c.nextTier.missing + ' cocktail' + (c.nextTier.missing > 1 ? 's' : '') +
          ' pour passer à ' + money(E.ttc(c.nextTier.unitHT, cfg)) + ' TTC le cocktail' +
          (diff <= 0 ? ' — et payer ' + money(-diff) + ' de moins au total !' : ' (+' + money(diff) + ' TTC).') +
          ' <button type="button" data-goto="' + c.nextTier.atQuantity + '">Passer à ' + c.nextTier.atQuantity + '</button>';
      } else {
        nudge.hidden = true;
      }
      $('ccd-ck-reset').hidden = c.quantity === c.recommended;
    }

    function renderAddress(q) {
      var status = $('ccd-addr-status');
      var alertEl = $('ccd-addr-alert');
      alertEl.innerHTML = '';
      status.className = 'ccd-hint';
      if (addr.status === 'routing') {
        status.innerHTML = '<span class="ccd-spinner"></span>Calcul de la distance…';
      } else if (addr.status === 'error') {
        status.className = 'ccd-hint is-warn';
        status.textContent = 'Impossible de calculer la distance pour le moment. Réessayez ou choisissez une autre adresse.';
      } else if (addr.status === 'ok' && typeof state.distanceKm === 'number') {
        if (blockFor(q, 'address')) {
          status.textContent = '≈ ' + num1.format(state.distanceKm) + ' km de notre local.';
          alertEl.innerHTML = alertHtml('Votre événement se situe hors de notre zone géographique standard, veuillez nous contacter directement.', { href: cfg.contactUrl, label: 'Nous contacter' });
        } else {
          var fee = E.travelFeeHT(state.distanceKm, cfg);
          status.className = 'ccd-hint is-ok';
          status.textContent = '≈ ' + num1.format(state.distanceKm) + ' km de notre local — ' +
            (fee ? 'frais de déplacement : ' + money(fee) + ' HT (' + num1.format(state.distanceKm * 2) + ' km A/R).' : 'déplacement offert.');
        }
      }
    }

    function renderBeer(q) {
      var b = state.beer;
      var bc = cfg.beer;
      $('ccd-beer-body').hidden = !b.enabled;
      if (!b.enabled) return;

      var total = Object.keys(b.kegs).reduce(function (s, k) { return s + b.kegs[k]; }, 0);
      Object.keys(bc.kegs).forEach(function (type) {
        var input = $('ccd-keg-' + type);
        if (document.activeElement !== input) input.value = b.kegs[type];
      });

      var reco = state.guests ? Math.ceil(state.guests * 0.5 / 30) : null;
      $('ccd-beer-reco').textContent = reco ? 'Pour ' + state.guests + ' invités, nous recommandons environ ' + reco + ' fût' + (reco > 1 ? 's' : '') + ' au total.' : '';

      var tap = $('ccd-tap-hint');
      if (!total) {
        tap.className = 'ccd-hint is-warn';
        tap.textContent = 'Choisissez au moins un fût.';
      } else if (total >= bc.tap.freeFromKegs) {
        tap.className = 'ccd-hint is-ok';
        tap.textContent = '✓ ' + bc.tap.label + ' offerte à partir de ' + bc.tap.freeFromKegs + ' fûts.';
      } else {
        tap.className = 'ccd-hint';
        tap.textContent = bc.tap.label + ' : ' + money(bc.tap.priceHT) + ' HT — offerte à partir de ' + bc.tap.freeFromKegs + ' fûts.';
      }
      $('ccd-glass-hint').textContent = total ? (total * bc.glassesPerKeg) + ' verres de 33 cl prévus (' + bc.glassesPerKeg + ' par fût).' : '';

      var travel = E.travelFeeHT(state.distanceKm, cfg);
      ['earlyDelivery', 'latePickup'].forEach(function (k) {
        var id = k === 'earlyDelivery' ? 'ccd-beer-early' : 'ccd-beer-late';
        var o = bc[k];
        $(id + '-price').innerHTML = money(o.fixedHT) + ' HT' + (o.addTravelRoundTrip
          ? '<span class="ccd-check-sub">+ déplacement ' + (travel === null ? '(selon lieu)' : money(travel)) + '</span>' : '');
      });
    }

    function lineHtml(l) {
      var label = esc(l.label);
      var sub = '';
      var price;
      if (l.id === 'staff') {
        sub = staffChips(l.staff).join(' · ');
        price = 'Inclus';
      } else if (l.free) {
        price = '<span class="ccd-free">Offert</span>';
      } else {
        price = money(l.totalHT) + ' HT<small>' + money(E.ttc(l.totalHT, cfg)) + ' TTC</small>';
      }
      if (l.id === 'cocktails') sub = l.qty + ' × ' + money(E.ttc(l.unitHT, cfg)) + ' TTC';
      else if (l.detail) sub = esc(l.detail);
      else if (l.qty > 1 && !l.free) sub = l.qty + ' × ' + money(l.unitHT) + ' HT';
      if (l.pendingTravel) sub += (sub ? ' · ' : '') + 'déplacement à calculer';
      var details = l.description
        ? '<details class="ccd-details"><summary>Ce qui est inclus</summary>' +
            (l.intro ? '<p style="margin:6px 0 0">' + esc(l.intro) + '</p>' : '') + '<ul>' +
            l.description.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></details>'
        : '';
      var cls = 'ccd-line' + (l.info ? ' is-info' : '');
      return '<li class="' + cls + '"><span class="ccd-line-label">' + label + (sub ? '<small>' + sub + '</small>' : '') + details + '</span><span class="ccd-line-price">' + price + '</span></li>';
    }

    function renderRecap(q) {
      var meta = [];
      if (state.date) meta.push(prettyDate(state.date));
      if (state.guests) meta.push(state.guests + ' invités');
      if (q.schedule.s1) {
        var h = prettyTime(state.service1.start) + '–' + prettyTime(state.service1.end);
        if (q.schedule.s2) h += ' + ' + prettyTime(state.service2.start) + '–' + prettyTime(state.service2.end);
        meta.push(h);
      }
      $('ccd-meta').textContent = meta.length ? meta.join(' · ') : 'Complétez le formulaire';

      var html = q.lines.map(lineHtml).join('');
      if (q.missing.indexOf('address') !== -1 && !blockFor(q, 'address')) {
        html += '<li class="ccd-line is-pending"><span class="ccd-line-label">' + esc(cfg.travel.label) + '</span><span class="ccd-line-price">selon le lieu</span></li>';
      }
      var wasOpen = !!rootEl.querySelector('#ccd-lines details[open]');
      $('ccd-lines').innerHTML = html || '<li class="ccd-empty">Votre sélection apparaîtra ici.</li>';
      if (wasOpen) rootEl.querySelector('#ccd-lines details').open = true;

      var blocked = q.blocks.length > 0;
      var totals = $('ccd-totals');
      totals.classList.toggle('is-blocked', blocked);
      totals.innerHTML =
        '<div class="ccd-total-row"><span>Total HT</span><span>' + money(q.totals.ht) + '</span></div>' +
        '<div class="ccd-total-row"><span>TVA ' + Math.round(cfg.vatRate * 100) + ' %</span><span>' + money(q.totals.vat) + '</span></div>' +
        '<div class="ccd-total-row is-main"><span>Total TTC</span><strong>' + money(q.totals.ttc) + '</strong></div>';
      $('ccd-mbar-total').textContent = blocked ? 'Sur mesure' : money(q.totals.ttc);

      var statusEl = $('ccd-status');
      var cta = $('ccd-cta-wrap');
      if (blocked) {
        var b = q.blocks[0];
        var outOfZone = b.code === 'out_of_zone';
        statusEl.innerHTML = '<strong>' + (outOfZone ? 'Lieu hors zone standard' : 'Votre projet nécessite un devis sur mesure') + '</strong>';
        cta.innerHTML = '<a class="ccd-cta is-alt" href="' + esc(outOfZone ? cfg.contactUrl : cfg.calendlyUrl) + '" target="_blank" rel="noopener">' +
          (outOfZone ? 'Nous contacter' : 'Prendre rendez-vous') + '</a>';
      } else if (q.missing.length) {
        statusEl.innerHTML = 'Pour finaliser votre devis, indiquez :<ul>' +
          q.missing.map(function (m) { return '<li>' + esc(MISSING_LABELS[m] || m) + '</li>'; }).join('') + '</ul>';
        cta.innerHTML = '<button type="button" class="ccd-cta" disabled>Valider mon devis</button>';
      } else {
        statusEl.innerHTML = '';
        cta.innerHTML = '<button type="button" class="ccd-cta" id="ccd-validate">Valider mon devis</button>';
      }
    }

    function renderSteps(q) {
      var done = {
        date: !!state.date && q.missing.indexOf('date') === -1,
        guests: !!state.guests,
        service1: !!q.schedule.s1 && !q.schedule.errors.length,
        cocktails: !!(q.cocktails && q.cocktails.status === 'ok'),
        address: addr.status === 'ok' && !blockFor(q, 'address'),
        beer: state.beer.enabled && q.missing.indexOf('beer_kegs') === -1
      };
      rootEl.querySelectorAll('.ccd-step').forEach(function (el) {
        el.classList.toggle('is-done', !!done[el.dataset.stepId]);
      });
    }

    // ---------------------------------------------------------------- Événements

    function clampInt(v, min, max) {
      v = parseInt(v, 10);
      if (isNaN(v)) return null;
      return Math.min(max, Math.max(min, v));
    }

    $('ccd-date').addEventListener('input', function (e) { state.date = e.target.value; update(); });

    function setGuests(v) {
      state.guests = clampInt(v, 1, 2000);
      state.cocktails = null; // la reco change : on repart de la recommandation
      update();
    }
    $('ccd-guests').addEventListener('input', function (e) { setGuests(e.target.value); });
    $('ccd-guests').addEventListener('blur', function (e) { e.target.value = state.guests || ''; });

    // Boutons +/- génériques (invités, fûts)
    rootEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-step]');
      if (!btn) return;
      var input = $(btn.dataset.for);
      var delta = Number(btn.dataset.step);
      if (input.id === 'ccd-guests') {
        var cur = state.guests || 0;
        setGuests(delta > 0 ? Math.floor(cur / 5) * 5 + 5 : Math.ceil(cur / 5) * 5 - 5);
        input.value = state.guests || '';
      } else {
        input.value = clampInt((Number(input.value) || 0) + delta, Number(input.min), Number(input.max));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // Horaires
    rootEl.querySelectorAll('select[data-svc]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var svc = sel.dataset.svc === 's1' ? state.service1 : state.service2;
        svc[sel.dataset.k] = sel.value;
        state.cocktails = null;
        update();
      });
    });
    $('ccd-s2-on').addEventListener('change', function (e) {
      state.service2.enabled = e.target.checked;
      $('ccd-s2-wrap').hidden = !e.target.checked;
      state.cocktails = null;
      update();
    });

    // Cocktails
    function setCocktails(v) {
      state.cocktails = Number(v);
      update();
    }
    $('ccd-ck-range').addEventListener('input', function (e) { setCocktails(e.target.value); });
    $('ccd-ck-minus').addEventListener('click', function () { setCocktails(lastQuote.cocktails.quantity - cfg.cocktails.buttonStep); });
    $('ccd-ck-plus').addEventListener('click', function () { setCocktails(lastQuote.cocktails.quantity + cfg.cocktails.buttonStep); });
    $('ccd-ck-reset').addEventListener('click', function () { state.cocktails = null; update(); });
    $('ccd-ck-nudge').addEventListener('click', function (e) {
      var b = e.target.closest('[data-goto]');
      if (b) setCocktails(b.dataset.goto);
    });

    // Bière
    $('ccd-beer-on').addEventListener('change', function (e) { state.beer.enabled = e.target.checked; update(); });
    Object.keys(cfg.beer.kegs).forEach(function (type) {
      $('ccd-keg-' + type).addEventListener('input', function (e) {
        state.beer.kegs[type] = clampInt(e.target.value, 0, cfg.beer.maxKegsPerType) || 0;
        update();
      });
    });
    rootEl.querySelectorAll('input[name="ccd-glass"]').forEach(function (r) {
      r.addEventListener('change', function () { state.beer.glassware = r.value; update(); });
    });
    [['ccd-beer-service', 'service'], ['ccd-beer-early', 'earlyDelivery'], ['ccd-beer-late', 'latePickup']].forEach(function (p) {
      $(p[0]).addEventListener('change', function (e) { state.beer[p[1]] = e.target.checked; update(); });
    });
    // Infobulle : ouverture au clic sur mobile
    rootEl.querySelectorAll('.ccd-tip-btn').forEach(function (b) {
      b.addEventListener('click', function () { b.parentNode.classList.toggle('is-open'); });
    });

    // Validation
    rootEl.addEventListener('click', function (e) {
      if (!e.target.closest('#ccd-validate')) return;
      if (opts.onValidate) opts.onValidate(lastQuote, JSON.parse(JSON.stringify(state)));
    });

    // Feuille récap mobile
    function sheet(open) {
      rootEl.classList.toggle('is-sheet-open', open);
      $('ccd-backdrop').hidden = !open;
    }
    $('ccd-mbar-open').addEventListener('click', function () { sheet(true); });
    $('ccd-recap-close').addEventListener('click', function () { sheet(false); });
    $('ccd-backdrop').addEventListener('click', function () { sheet(false); });

    // ---------------------------------------------------------------- Autocomplétion adresse

    var input = $('ccd-addr');
    var list = $('ccd-addr-list');
    var results = [];
    var active = -1;
    var searchCtl = null;

    function closeList() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }
    function renderList() {
      if (!results.length) {
        list.innerHTML = '<li class="ccd-ac-empty">Aucun résultat. Essayez d\'ajouter la ville.</li>';
      } else {
        list.innerHTML = results.map(function (r, i) {
          return '<li class="ccd-ac-item' + (r.isPlace ? ' is-place' : '') + '" role="option" id="ccd-opt-' + i + '" data-i="' + i + '" aria-selected="' + (i === active) + '">' +
            '<span class="ccd-ac-kind">' + (r.isPlace ? 'Lieu' : 'Adresse') + '</span><span>' + esc(r.label) + '</span></li>';
        }).join('');
      }
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (active >= 0) input.setAttribute('aria-activedescendant', 'ccd-opt-' + active);
    }

    var runSearch = debounce(function (text) {
      if (searchCtl) searchCtl.abort();
      searchCtl = new AbortController();
      G.search(text, searchCtl.signal).then(function (r) {
        results = r; active = -1; renderList();
      }).catch(function (err) {
        if (err.name !== 'AbortError') { results = []; closeList(); }
      });
    }, 250);

    function choose(r) {
      input.value = r.label;
      closeList();
      state.address = r;
      state.distanceKm = null;
      addr.status = 'routing';
      update();
      if (addr.controller) addr.controller.abort();
      addr.controller = new AbortController();
      G.distanceKm(cfg.company, r, addr.controller.signal).then(function (km) {
        state.distanceKm = km;
        addr.status = 'ok';
        update();
      }).catch(function (err) {
        if (err.name === 'AbortError') return;
        addr.status = 'error';
        update();
      });
    }

    input.addEventListener('input', function () {
      if (state.address || addr.status !== 'idle') {
        state.address = null; state.distanceKm = null; addr.status = 'idle';
        if (addr.controller) addr.controller.abort();
        update();
      }
      var text = input.value.trim();
      if (text.length < 3) { closeList(); return; }
      runSearch(text);
    });
    input.addEventListener('keydown', function (e) {
      if (list.hidden || !results.length) return;
      if (e.key === 'ArrowDown') { active = (active + 1) % results.length; renderList(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = (active - 1 + results.length) % results.length; renderList(); e.preventDefault(); }
      else if (e.key === 'Enter' && active >= 0) { choose(results[active]); e.preventDefault(); }
      else if (e.key === 'Escape') { closeList(); }
    });
    input.addEventListener('blur', function () { setTimeout(closeList, 150); });
    list.addEventListener('mousedown', function (e) {
      var li = e.target.closest('[data-i]');
      if (!li) return;
      e.preventDefault();
      choose(results[Number(li.dataset.i)]);
    });

    update();
    return { getState: function () { return state; }, getQuote: function () { return lastQuote; } };
  }

  root.CCDevis = { mount: mount };
})(typeof self !== 'undefined' ? self : this);
