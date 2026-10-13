# Devis temps réel — Cocktail Coast

Prototype de la page « Devis sur mesure » de cocktail-coast.com : formulaire à gauche, devis mis à jour en direct à droite (barre en bas sur mobile).

## Tester

Ouvrir le lien GitHub Pages du dépôt (Settings → Pages), puis `/prototype/`.

Scénario conseillé : une date un samedi de juin, 80 invités, 19h–22h, un lieu (ex. « Château Pape Clément »), puis activer l'option bière.

## Faire un retour

Onglet **Issues** → **New issue** : un retour par issue, avec une capture d'écran si possible.

## Contenu

| Fichier | Rôle |
|---|---|
| `config/pricing-config.json` | Tous les prix et règles (HT). Seul fichier à modifier pour changer un tarif. |
| `js/quote-engine.js` | Calcul du devis (testé : `node --test tests/*.test.js`). |
| `js/devis-ui.js` | Interface (formulaire + récapitulatif). |
| `js/geo.js` | Autocomplétion d'adresse et distance routière (Géoplateforme IGN, gratuite). |
| `css/devis.css` | Styles (charte Cocktail Coast). |
| `PROGESS.md` | Journal d'avancement et décisions. |
