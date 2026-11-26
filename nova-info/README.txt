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

Onglet « Voix » (réécrire ce que dit la voix)
- Le projet contient dans voix/ la voix phrase par phrase, le lit musical et les bruitages SANS ducking (créés par export_project.py).
- On colle SA clé ElevenLabs (champ en haut de l'onglet) : elle reste dans le navigateur, n'est envoyée qu'à api.elevenlabs.io,
  et n'est mémorisée (localStorage) que si on coche « Mémoriser ». Conseil : une clé dédiée, limitée à « Text to Speech ».
- On réécrit une phrase, « Régénérer la voix » : l'Atelier appelle l'API (ElevenLabs, voix et réglages du projet, avec le contexte des phrases voisines),
  recale sous-titres, plans, mode dark et durée, puis refait le mixage dans le navigateur (ducking, niveaux, limiteur) ; l'export vidéo utilise ce son.
- « Version d'origine » restaure la phrase ; annuler / rétablir fonctionnent aussi. Les nouvelles prises sont enregistrées dans voix/edit_*.wav.
- Non fait par l'Atelier : vérification des mots sautés (écouter la phrase avant d'exporter), normalisation fine du volume (le mixage vise le niveau de la phrase
  d'origine et plafonne à -1 dBFS) ; un allongement de phrase fait répéter la fin du lit musical, un raccourcissement le tronque.

Onglet « Publier » (pack de publication)
- Le projet peut contenir un pack de publication (créé par tools/publish_pack.py, exporté avec le projet) : titre YouTube Short, description,
  légende TikTok, commentaire à épingler, hashtags, sources, mention « voix de synthèse », couverture.
- L'onglet affiche chaque champ (modifiable, compteur de caractères), un bouton « Copier » par champ, « Télécharger publication.md » et la couverture.
- Aucune publication automatique : on colle les textes dans YouTube Studio / TikTok Studio. Les modifications sont enregistrées avec le projet.

Limites
- La voix et la musique d'origine sont celles de audio.mp3 ; seul l'onglet « Voix » les refait.
- Les plans « carte », « anneau » et « courbe » sont des clips pré-rendus : leurs textes d'habillage sont modifiables, pas leur contenu graphique
  (on peut les remplacer par une image).
- L'étalonnage et les effets de l'aperçu approchent le rendu de la chaîne Python sans être identiques pixel pour pixel.

Licences
- mp4-muxer 5.2.2 (Vanilagy) - MIT - voir mp4-muxer.LICENSE.txt.
- Les polices (Inter, Liberation Serif) sont chargées depuis le dossier du projet.
