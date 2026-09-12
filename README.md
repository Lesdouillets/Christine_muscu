# Carnet de musculation - phase 1

Ce que contient cette version : le journal, la création manuelle d'une séance, l'écran séance avec cartes dépliables (poids et ressenti par tour), la recherche par exercice, et l'export JSON. Tout est stocké uniquement sur ton téléphone (IndexedDB), rien n'est envoyé sur un serveur.

Pas encore construit (phases suivantes du plan) : import de photo WhatsApp, lecture IA, bibliothèque de gifs, correspondance automatique d'exercice inconnu, écran progrès.

## Mettre en ligne sur GitHub Pages

1. Crée un nouveau dépôt GitHub (public - Pages gratuit demande un dépôt public, sauf si tu as GitHub Pro).
2. Mets tout le contenu de ce dossier (`index.html`, `manifest.json`, `sw.js`, `css/`, `js/`, `icons/`) à la racine du dépôt.
3. Dans les réglages du dépôt (Settings → Pages), choisis la branche principale et le dossier racine (`/`) comme source.
4. GitHub te donne une adresse du type `https://<ton-nom-utilisateur>.github.io/<nom-du-depot>/` - c'est cette adresse que tu ouvres sur ton téléphone.

## Installer sur ton téléphone Android

1. Ouvre l'adresse ci-dessus dans Chrome sur ton téléphone.
2. Menu Chrome (⋮) → "Ajouter à l'écran d'accueil" (ou une bannière d'installation peut apparaître automatiquement).
3. L'icône orange avec la barre apparaît sur ton écran d'accueil, l'application s'ouvre en plein écran comme une app normale.

## Tester

- Crée une séance à la main (bouton "ajouter" en bas), ajoute un ou deux exercices, règle un poids et un ressenti, reviens au journal : la séance doit apparaître avec le bon nombre d'exercices.
- Essaie la recherche du journal avec le nom d'un exercice que tu as ajouté.
- Essaie l'export : un fichier `.json` doit se télécharger avec tes séances.

## Partage de photo depuis une autre appli (WhatsApp...)

`manifest.json` déclare "Carnet de muscu" comme destination de partage (`share_target`) : sur Android (pas iOS, l'API n'existe pas là-bas), l'app installée apparaît dans le menu de partage du téléphone quand on partage une photo. Comme GitHub Pages est un hébergement statique qui ne peut jamais répondre à un POST, `sw.js` intercepte lui-même cet envoi (voir `handleSharedPhoto`) avant qu'il n'atteigne le serveur - sinon c'est une erreur 405 garantie, constatée par Christine le 13/09/2026. La photo est mise de côté dans un cache le temps que l'appli se recharge, puis `checkForSharedPhoto` (js/app.js) la récupère et ouvre directement l'import IA avec.
