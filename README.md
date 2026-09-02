# Heiðrún

A standalone browser instrument: a blank canvas of physics-driven objects (bouncers, triggers, spawners, peg fields) whose collisions and math/randomization generators drive WebAudio synthesis. A populated, switched-on canvas plays itself — a self-running generative patch you arrange by hand instead of by patch cables. Optional hardware CV/gate output to an Expert Sleepers ES-9 Eurorack interface.

No build step — plain ES modules, no bundler, no dependencies.

Hardware CV/gate output is currently wired for an [Expert Sleepers ES-9](https://www.expert-sleepers.co.uk/es9.html) USB audio interface — feel free to tweak, adjust, expand, or refactor `src/es9/` to talk to whatever modules or instruments you've got instead.

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

- [`architecture.md`](architecture.md) — what this is, how it feels to use, and how it's built: module layout, data flow, object model, coding principles.
- [`NOTES.md`](NOTES.md) — known limitations, deliberate trade-offs, open design questions.

## License

MIT — see [`LICENSE`](LICENSE).
