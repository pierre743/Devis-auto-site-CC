# PROGESS — Devis temps réel Cocktail Coast

## 2026-10-13 — Cadrage
- Projet démarré (dossier vide). Page "Devis sur mesure en temps réel" sur cocktail-coast.com (WordPress + Elementor / OVH), UX inspirée d'icefamily.fr/#commander.
- Architecture : plugin WP maison `cc-devis` + shortcode `[cc_devis]` (widget Shortcode Elementor), JS vanilla sans build. Moteur JS pur + recalcul PHP à la soumission.

## 2026-10-13 — Règles métier validées
- Tout stocké en HT, TVA 20 %, HT + TTC affichés au client.
- Déplacement : 0,60 € HT/km AR, gratuit si < 30 km aller, bloqué si > 300 km aller (pas de forfait minimum).
- Utilitaire : 155 € HT le samedi de mai à octobre.
- Cocktails : reco par durée totale (2h-3h=2/p, 3h30-4h=2,5, 4h30-5h=3, 5h30=3,5, 6h+=4), ajustement ±0,5/pers, min 100. Paliers TTC 10,90 / 9,90 / 8,90 (100-149 / 150-199 / 200-299). < 100 ou ≥ 300 → Calendly. Message "plus que N cocktails pour le palier suivant".
- Staff : grille chef/bartenders/commis (151+ : 1 commis par tranche de 50 pax au-delà de 150).
- Services : 2h minimum chacun, sinon en rouge + Calendly. Coupure max 3h, sinon 50 € HT / staff / heure.
- Bière : Blonde 90 €, IPA 145 €, choix libre (pas de pré-remplissage). Libre-service + astérisque.
- Validation : signature + prénom, nom, email, tél, adresse de facturation → facture d'acompte envoyée ensuite.

## 2026-10-13 — Étapes 1-2 faites
- `config/pricing-config.json` (source unique des prix), `js/quote-engine.js` (UMD, navigateur + Node), `tests/quote-engine.test.js` : 13/13 OK (`node --test tests/*.test.js`).
- Distance : API Géoplateforme IGN, gratuite, sans clé, CORS ouvert, testée le 13/10. Autocomplétion `data.geopf.fr/geocodage/completion` (trouve aussi les lieux nommés, ex. "Château Pape Clément") + itinéraire `data.geopf.fr/navigation/itineraire` (resource=bdtopo-osrm).
- Pièges :
  - `node --test tests/` échoue sous Node 24 → utiliser le glob `tests/*.test.js`.
  - Prix cocktails HT stockés avec 6 décimales (9,083333) pour retomber pile sur le TTC commercial.
  - Mode palier "global" : 149 cocktails (1 624,10 €) coûtent plus cher que 150 (1 485 €). Assumé, et sert d'argument commercial.
  - Coordonnées du local = centre de la rue Stendhal (le n° 2 n'est pas géocodé) → à affiner si besoin.
  - Hypothèses à confirmer : supplément de coupure calculé au prorata des demi-heures au-delà de 3h ; plus de 6h → 4/pers ; services jusqu'à 4h du matin.
- TODO : lien Calendly réel dans la config.

## 2026-10-13 — Étapes 3-5 faites (prototype)
- `prototype/index.html` + `css/devis.css` + `js/devis-ui.js` (rendu complet du formulaire en JS → le futur shortcode WP n'aura qu'un `<div id="cc-devis">`) + `js/geo.js` (Géoplateforme, cache sessionStorage).
- Charte reprise de cocktail-coast.com (Elementor) : orange #FF8401, bleu #65ADE0, encre #1E1E1C, Poppins + Anton. CSS scopé `.ccd`.
- Lancer : preview "prototype" (`.claude/launch.json`, serveur Node sur :8765). Python http.server refusé par macOS (accès au Bureau).
- Vérifié dans le navigateur : bureau + mobile 375px (barre total + volet), autocomplétion Château Pape Clément → 17,8 km → déplacement offert, bière, coupure, blocage Calendly (120 pers × 6h = 480 cocktails).
- Ajouts config : `contactUrl` (hors zone), `cocktails.buttonStep` (=5).
- UX : changer les invités ou les horaires remet les cocktails sur la reco. Message "Plus que N cocktails… et payer X € de moins" quand le palier suivant fait baisser le total.
- Piège : sur mobile, le volet récap s'anime en 0,3 s → faire la capture après l'animation.

## 2026-10-13 — Retours client intégrés
- Palier ajouté : 300-399 cocktails = 7,90 € TTC (6,583333 HT). Sur mesure (Calendly) désormais < 100 ou ≥ 400.
- Nouvelle ligne fixe sur chaque devis : "Gestion de projet - Cocktails & boissons" 175 € HT, avec "Ce qui est inclus" dépliable (`projectManagement` dans la config). Un devis vide = 210 € TTC.
- La raison utilitaire offert/payant s'affiche uniquement dans le récap (`reasonPaid` / `reasonFree`). Sous la date : juste le jour formaté.
- Coupure entre services : encadré tableau (coupure / dont incluse / supplément détaillé / durée totale) au lieu d'une phrase.
- Prochaine étape : étape 6, plugin WP `cc-devis` (shortcode, config PHP injectée) puis étape 7 (signature + coordonnées + email/webhook).
