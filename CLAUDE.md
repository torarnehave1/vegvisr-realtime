# vegvisr-realtime — Claude working notes
# Universal rules live in ~/.claude/CLAUDE.md — do not duplicate them here.

## MANDATORY — read `_project/lessons_learned.md` BEFORE EVERY RESPONSE

## Read order
1. `_project/lessons_learned.md`
2. `_project/STATUS.md`
3. `_project/TODO.md`
4. `_project/PLAN.md`
5. `_project/TEST_PLAN.md`

## Stack
- React 18 + TypeScript + Vite
- Tailwind CSS v3
- Cloudflare RealtimeKit (`@cloudflare/realtimekit`, `-react`, `-react-ui`, `-ui`, `-ui-addons`)
- `vegvisr-ui-kit` — AuthBar, EcosystemNav, shared components
- `lucide-react` icons, `motion` animations, `clsx` + `tailwind-merge`

## Commands
| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server — port **3001** |
| `npm run build` | TypeScript check + Vite build |
| `npm run lint` | ESLint |
| `npm run preview` | Preview production build |

## Dev-only auto-login (`.env.local`)
If this project uses vegvisr auth, add:
- `VITE_DEV_USER_EMAIL`
- `VITE_DEV_USER_TOKEN` — `emailVerificationToken` from D1
- `VITE_DEV_USER_ROLE`

`.env.local` is gitignored. Never commit credentials.

## Usage logging
Stop hook is wired to `_project/log-usage.py` via `.claude/settings.local.json` (gitignored).
Every response appends a row to `_project/usage.jsonl`.
Summarise with: `python3 _project/usage-summary.py`
