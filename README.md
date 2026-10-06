# my-mods — configuration Claude Code reproductible

Marketplace locale contenant le mod **side-dashboard** et les réglages associés.
Testé avec Claude Code **2.1.291** sous Windows 11.

## Ce que fait side-dashboard

- **Panneau de droite** (carte Contexte, Limites 5h / 7j, Session, Tâches), ouvert au premier message.
  Couleurs par clés de thème : il suit le thème de Claude Code.
- **Bandeau sous le prompt** : branche git, dossier, chemin (via `PromptHint`).
- **Réponses mises en forme** : titres avec icône, puces indentées, blocs Insight encadrés.
  Les messages avec tableau ou bloc de code restent au rendu natif.
- **Tes messages envoyés** dans une carte à bords arrondis (`UserMessage`).

## Installer sur une nouvelle machine

```powershell
# 1. Copier ce dossier (ex. C:\Users\<toi>\.claude\my-mods), puis :
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

Ou à la main :

```powershell
claude plugin marketplace add C:\Users\<toi>\.claude\my-mods
claude plugin install side-dashboard@my-mods --scope user
```

Depuis un dépôt GitHub (si ce dossier y est poussé, avec `.claude-plugin/marketplace.json` à la racine) :

```
/plugin install side-dashboard --marketplace <owner>/<repo>
```

Redémarrer Claude Code ensuite. Modifier le mod : éditer
`side-dashboard\hooks\register.tsx`, puis `/reload-plugins`.

## Conditions et limites connues

- Le panneau docké à droite demande le **mode plein écran** de Claude Code (le défaut sur 2.1.291) et un terminal d'au moins 110 colonnes ;
  ouvert sans action de la personne il exigerait 144 colonnes, c'est pourquoi le mod l'ouvre au premier message envoyé.
- Les limites 5h / 7j n'existent qu'avec un abonnement Claude.
- Les glyphes `◖ ▬ ◗` de la barre dépendent de la police du terminal (Cascadia les contient).
- Pas d'en-tête fixe en haut de la conversation, ni de forme arrondie pour la zone de saisie : les mods n'y ont pas accès.

## Réglages hors mod (voir settings-snippet.json)

- `theme` : `dark`.
- Plugins officiels activés : `code-simplifier`, `explanatory-output-style`, `data-engineering`.
- Plugin **mlflow désactivé** : son hook `UserPromptSubmit` lance un script `.py` avec `python3`,
  qui n'existe pas sous Windows (seul le raccourci du Microsoft Store répond, avec « Python was not found »).
  Pour le réactiver : `claude plugin enable mlflow@claude-plugins-official`, après avoir fourni un vrai `python3` dans le `PATH`.
