# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Phaser 3 game built with React 19, TypeScript, and Vite. Uses the Phaser React TypeScript template with a bridge pattern for React-Phaser communication.

## Commands

- `npm run dev` — Start dev server on http://localhost:8080
- `npm run build` — Production build to `dist/`
- `npm run dev-nolog` / `npm run build-nolog` — Same without Phaser analytics

Vite configs live in `vite/config.dev.mjs` and `vite/config.prod.mjs`.

## Architecture

### React ↔ Phaser Bridge

- `src/PhaserGame.tsx` — React component that initializes the Phaser game instance via `forwardRef`. Exposes `game` and current `scene` via ref (`IRefPhaserGame`).
- `src/game/EventBus.ts` — Phaser `Events.EventEmitter` used to communicate between React components and Phaser scenes.
- React listens for `"current-scene-ready"` events; Phaser scenes must emit this event at the end of `create()` to be accessible from React.

### Game Entry & Scenes

- `src/game/main.ts` — Game config (1024×768, `AUTO` renderer). Exports `StartGame(parent)`.
- Scene flow: `Boot` → `Preloader` → `MainMenu` → `Game` → `GameOver` (all in `src/game/scenes/`).

### React Entry

- `src/main.tsx` → `src/App.tsx` → `<PhaserGame>` component.

## Key Conventions

- New Phaser scenes must emit `EventBus.emit('current-scene-ready', this)` in `create()` to be accessible from React.
- Static assets go in `public/assets/`; importable assets can be placed anywhere in `src/` and imported directly.
- TypeScript strict mode is enabled with `noUnusedLocals` and `noUnusedParameters`.
