# Heiðrún

A standalone browser instrument: a blank canvas of physics-driven objects (bouncers, triggers, spawners, peg fields) whose collisions and math/randomization generators drive WebAudio synthesis. A populated, switched-on canvas plays itself — a self-running generative patch you arrange by hand instead of by patch cables. Optional hardware CV/gate output to an Expert Sleepers ES-9 Eurorack interface.

No build step — plain ES modules, no bundler, no dependencies.

## Running it

```bash
python3 -m http.server 8934
```

Then open `http://localhost:8934/`.

## Testing

```bash
npm test
```

Runs the headless test suite (`node --test`) — generators/gate, state/undo/defaults/instrument-settings/limiter/key-override/piano logic, spawner-timing + object-cap logic, and the ES-9 routing's pure decision logic. No browser required.

## Documentation

- [`prototype.md`](prototype.md) — the concept: what this instrument is and how it's meant to feel to use.
- [`architecture.md`](architecture.md) — the technical plan: module layout, data flow, object model, coding principles.
- [`handoff.md`](handoff.md) — session-to-session status: what's built, what's not yet tested, open items.
- [`ES-9-user-manual.md`](ES-9-user-manual.md) — using the ES-9 hardware CV/gate output.

## License

MIT — see [`LICENSE`](LICENSE).
