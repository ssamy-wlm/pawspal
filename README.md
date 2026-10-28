# PawsPal Dahab

A trusted home for every paw while you travel. Pet sitting and swapping for Dahab, Egypt.

| Start here | |
|---|---|
| **SETUP.md** | Put this on GitHub and start building (step by step) |
| **HANDOVER.md** | What the app does, decisions, open questions, fixes from v1 |
| **CLAUDE.md** | Rules Claude Code follows in this repo |
| `docs/build-plan.md` | Phases 0–9 with acceptance checks (`/phase N` in Claude Code) |
| `docs/design-system.md` · `docs/motion.md` | Light and navy themes, components, animations shared with social media |
| `docs/security.md` | Threat model and pre-launch checklist |
| `docs/legal/` | Privacy Policy, Terms of Service, Community Guidelines (drafts, shown in the app) |
| `docs/social-kit.md` | How the Instagram posts and videos connect to the app |

```
apps/mobile      Expo app (welcome, explore with search/swipe/both, legal screens, motion showcase)
apps/admin       Admin dashboard (built in phase 8)
supabase         Database migrations, security tests, edge functions
design           tokens.json (colours, type, spacing, motion) shared by app and social
assets           logo, illustrations (same files as the posts), original mockups
scripts          sync-shared.mjs, test-db.sh
.claude          Claude Code settings, /phase and review commands, reviewer agents
```

Proprietary. © [COMPANY LEGAL NAME]. All rights reserved.
