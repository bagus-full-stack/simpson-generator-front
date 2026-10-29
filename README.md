# 🍩 Simpsons Generator — Frontend

Interface Next.js du générateur d'images Simpsons : texte-vers-image,
img2img, structure (ControlNet Canny) et inpainting, avec galerie, caméra et
éditeur de masque.

C'est le frontend de [`simpsons-generator`](https://github.com/bagus-full-stack/simpsons-generator)
(API FastAPI + Stable Diffusion) — un dépôt Git séparé, à cloner à côté de
celui-ci. Voir son README pour lancer l'API.

## Stack

- **Next.js 16** (App Router)
- **Tailwind CSS**
- **Lucide React** (icônes)
- Canvas API + Pointer Events (éditeur de masque, souris et tactile), MediaDevices API (caméra)

## Démarrage

```bash
npm install
copy .env.local.example .env.local   # (Mac/Linux : cp .env.local.example .env.local)
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000). L'API doit tourner en
parallèle (par défaut sur `http://localhost:8000`, voir le dépôt backend).

### Variables d'environnement

| Variable | Description | Défaut |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | URL de base de l'API backend | `http://localhost:8000` |
| `NEXT_PUBLIC_API_KEY` | Clé API (header `X-API-Key`), si l'API en exige une. Visible par tout visiteur (variable `NEXT_PUBLIC_`) | *(vide)* |

## Fonctionnement

L'API ne renvoie plus l'image directement dans la réponse HTTP : chaque
génération dépose un job et répond tout de suite avec son `id` et son statut.
Le client interroge ensuite `GET /jobs/{id}` jusqu'à ce qu'il passe à
`done`/`failed`/`rejected` — voir `app/lib/api.ts` (fonction `pollJob`), qui
centralise tous les appels réseau.

- Limites : description de 200 caractères, image de 8 Mo (sinon le serveur refuse).
- Le client attend le résultat jusqu'à 5 minutes : un job peut patienter derrière d'autres, le serveur n'en traite qu'un à la fois.
- La galerie est partagée par tous les visiteurs et n'a pas de suppression (l'API n'expose pas de `DELETE`).
- Les suggestions sont en anglais : le modèle est entraîné sur des prompts anglais.

## Structure

```plaintext
app/
├── page.tsx        # Interface (4 modes, galerie paginée, caméra, éditeur de masque)
├── lib/api.ts       # Client API : soumission de job, polling, téléchargement
├── layout.tsx
└── globals.css
```

## Scripts

```bash
npm run dev      # serveur de dev
npm run build    # build de production
npm run start    # sert le build de production
npm run lint     # ESLint
```

## Licence

Projet réalisé à des fins éducatives. Style Simpsons : fan art, usage non
commercial recommandé.
