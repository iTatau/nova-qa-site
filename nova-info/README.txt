Atelier Nova-Info (onglet « Nova-Info » du site)
================================================

Éditeur de vidéos « Et si… ? » qui tourne dans le navigateur. Fichiers : atelier.js, atelier.css, mp4-muxer.js.
Le module est chargé à la demande quand on ouvre l'onglet ; index.html ne contient que le bouton, la section et le chargeur.

Fonctionnement
- On ouvre le DOSSIER d'un projet créé par la chaîne de production Nova-Info (project.nova.json, audio.mp3, images/, clips/, fonts/).
  Les projets (images, voix, musique) ne sont PAS dans ce dépôt public : ils restent sur l'ordinateur de l'utilisateur.
- On peut remplacer une image, régler cadrage / étalonnage / effets / transition, modifier étiquettes, textes à l'écran
  (cartes, grands mots, tampons, listes) et sous-titres mot à mot, annuler / rétablir (Ctrl+Z / Ctrl+Y), enregistrer (Ctrl+S).
- Avec Chrome ou Edge, le dossier est ouvert en lecture/écriture (File System Access API) : « Enregistrer » écrit dedans.
  Sinon (« Choisir les fichiers… »), « Enregistrer » télécharge un project.nova.json qui embarque les images remplacées.
- Export : image par image avec WebCodecs (H.264 + AAC si le navigateur les propose, sinon VP9 + Opus), via mp4-muxer ;
  en secours, enregistrement du canvas en temps réel (MediaRecorder).

Limites
- La voix et la musique sont figées (audio.mp3). Modifier un texte ne les resynchronise pas.
- Les plans « carte », « anneau » et « courbe » sont des clips pré-rendus : leurs textes d'habillage sont modifiables, pas leur contenu graphique
  (on peut les remplacer par une image).
- L'étalonnage et les effets de l'aperçu approchent le rendu de la chaîne Python sans être identiques pixel pour pixel.

Licences
- mp4-muxer 5.2.2 (Vanilagy) - MIT - voir mp4-muxer.LICENSE.txt.
- Les polices (Inter, Liberation Serif) sont chargées depuis le dossier du projet.
