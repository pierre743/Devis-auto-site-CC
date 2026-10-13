// Lancer : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const cfg = require('../config/pricing-config.json');
const E = require('../js/quote-engine.js');

const base = () => ({
  date: '2027-03-10', // mercredi hors saison
  guests: 80,
  service1: { start: '18:00', end: '21:00' },
  service2: { enabled: false },
  cocktails: null,
  distanceKm: 20,
  beer: { enabled: false }
});
const line = (q, id) => q.lines.find(l => l.id === id);

test('utilitaire : payant le samedi de mai à octobre seulement', () => {
  assert.equal(E.isVanPaid('2027-06-12', cfg), true);   // samedi juin
  assert.equal(E.isVanPaid('2027-10-30', cfg), true);   // samedi octobre
  assert.equal(E.isVanPaid('2027-11-06', cfg), false);  // samedi novembre
  assert.equal(E.isVanPaid('2027-04-24', cfg), false);  // samedi avril
  assert.equal(E.isVanPaid('2027-06-11', cfg), false);  // vendredi juin
  assert.equal(line(E.computeQuote({ ...base(), date: '2027-06-12' }, cfg), 'van').totalHT, 155);
});

test('staff selon la grille', () => {
  const s = g => { const r = E.computeStaff(g, cfg); return [r.chef, r.bartenders, r.commis]; };
  assert.deepEqual(s(60), [1, 0, 0]);
  assert.deepEqual(s(75), [1, 0, 1]);
  assert.deepEqual(s(76), [1, 1, 0]);
  assert.deepEqual(s(150), [1, 1, 1]);
  assert.deepEqual(s(151), [1, 2, 1]);
  assert.deepEqual(s(200), [1, 2, 1]);
  assert.deepEqual(s(201), [1, 2, 2]);
});

test('cocktails : reco, plage ±0,5/pers, paliers', () => {
  // 80 pers, 3h → 2/pers = 160, plage 120–200
  const c = E.computeCocktails(80, 3, null, cfg);
  assert.equal(c.recommended, 160);
  assert.equal(c.min, 120);
  assert.equal(c.max, 200);
  assert.equal(c.unitHT, 8.25);
  assert.equal(E.ttc(c.totalHT, cfg), 1584); // 160 × 9,90
  // Demande au-delà de la plage → bornée
  assert.equal(E.computeCocktails(80, 3, 999, cfg).quantity, 200);
  // Message palier suivant
  const c2 = E.computeCocktails(80, 3, 125, cfg);
  assert.deepEqual([c2.nextTier.missing, c2.nextTier.atQuantity], [25, 150]);
});

test('cocktails : TTC retombe pile sur la grille commerciale', () => {
  assert.equal(E.ttc(E.round2(149 * cfg.cocktails.tiers[0].unitHT), cfg), 1624.10);
  assert.equal(E.ttc(E.round2(299 * cfg.cocktails.tiers[2].unitHT), cfg), 2661.10);
  assert.equal(E.ttc(E.round2(300 * cfg.cocktails.tiers[3].unitHT), cfg), 2370.00);
  assert.equal(E.ttc(E.round2(399 * cfg.cocktails.tiers[3].unitHT), cfg), 3152.10);
});

test('cocktails : < 100 ou ≥ 400 → sur mesure', () => {
  assert.equal(E.computeCocktails(30, 3, null, cfg).status, 'below_min'); // max 75
  assert.equal(E.computeCocktails(45, 3, null, cfg).min, 100);            // reco 90 → relevée à 100
  assert.equal(E.computeCocktails(200, 6, null, cfg).status, 'above_max'); // min 700
  assert.equal(E.computeCocktails(120, 3, null, cfg).recommended, 240);
  assert.equal(E.computeCocktails(160, 3, null, cfg).unitHT, 6.583333);   // reco 320 → palier 7,90
  assert.equal(E.computeCocktails(160, 3, null, cfg).max, 399);            // 2,5 × 160 = 400 → plafonné
  const q = E.computeQuote({ ...base(), guests: 30 }, cfg);
  assert.equal(q.canSubmit, false);
  assert.equal(q.blocks[0].code, 'cocktails_below_min');
});

test('durée de service et reco cumulée', () => {
  const q = E.computeQuote({ ...base(),
    service1: { start: '12:00', end: '15:00' },
    service2: { enabled: true, start: '17:00', end: '20:00' } }, cfg);
  assert.equal(q.schedule.totalHours, 6);
  assert.equal(q.cocktails.perPerson, 4);
  assert.equal(line(q, 'pause'), undefined); // 2h de pause, pas de supplément
});

test('service < 2h → bloqué avec Calendly', () => {
  const q = E.computeQuote({ ...base(), service1: { start: '18:00', end: '19:30' } }, cfg);
  assert.equal(q.blocks[0].code, 'service1_too_short');
  assert.equal(q.blocks[0].calendly, true);
});

test('service qui passe minuit', () => {
  const s = E.computeSchedule({ service1: { start: '22:00', end: '01:00' } }, cfg);
  assert.equal(s.s1.hours, 3);
});

test('coupure > 3h : 50 € HT / staff / heure au-delà', () => {
  const q = E.computeQuote({ ...base(), // 80 pers → 2 staff
    service1: { start: '11:00', end: '13:00' },
    service2: { enabled: true, start: '18:00', end: '20:00' } }, cfg); // 5h de pause → 2h sup
  assert.equal(line(q, 'pause').totalHT, 2 * 2 * 50);
});

test('déplacement : gratuit < 30 km, sinon AR × 0,60, bloqué > 300 km', () => {
  assert.equal(E.travelFeeHT(29.9, cfg), 0);
  assert.equal(E.travelFeeHT(50, cfg), 60);
  const q = E.computeQuote({ ...base(), distanceKm: 310 }, cfg);
  assert.equal(q.blocks[0].code, 'out_of_zone');
  assert.equal(q.canSubmit, false);
});

test('bière : fûts, tireuse offerte dès 2 fûts, verrerie, options', () => {
  const q1 = E.computeQuote({ ...base(), distanceKm: 50,
    beer: { enabled: true, kegs: { blonde: 1, ipa: 0 }, glassware: 'verre' } }, cfg);
  assert.equal(line(q1, 'beer_tap').totalHT, 90);
  assert.equal(line(q1, 'beer_glass').qty, 90);
  assert.equal(line(q1, 'beer_glass').totalHT, 81);

  const q2 = E.computeQuote({ ...base(), distanceKm: 50,
    beer: { enabled: true, kegs: { blonde: 1, ipa: 1 }, service: true, earlyDelivery: true, latePickup: true } }, cfg);
  assert.equal(line(q2, 'beer_keg_ipa').totalHT, 145);
  assert.equal(line(q2, 'beer_tap').totalHT, 0);
  assert.equal(line(q2, 'beer_glass').totalHT, 63); // 180 × 0,35
  assert.equal(line(q2, 'beer_service').totalHT, 280);
  assert.equal(line(q2, 'beer_early').totalHT, 90 + 60);
  assert.equal(line(q2, 'beer_late').totalHT, 90 + 60);
});

test('devis complet : totaux HT / TVA / TTC', () => {
  const q = E.computeQuote({ ...base(), date: '2027-06-12', distanceKm: 50 }, cfg);
  // 175 gestion de projet + 155 utilitaire + 160 × 8,25 = 1320 + 60 déplacement
  assert.equal(q.totals.ht, 1710);
  assert.equal(q.totals.vat, 342);
  assert.equal(q.totals.ttc, 2052);
  assert.equal(q.lines[0].id, 'project');
  assert.equal(q.canSubmit, true);
});

test('formulaire vide → champs manquants, pas de crash', () => {
  const q = E.computeQuote({}, cfg);
  assert.deepEqual(q.missing.sort(), ['address', 'date', 'guests', 'service1']);
  assert.equal(q.totals.ttc, 210); // seule la gestion de projet
});
