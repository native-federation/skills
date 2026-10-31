# Native Federation Skills

Agent Skills that help coding agents work with [Native Federation](https://native-federation.com): micro frontends built
on ESM and import maps (`@softarc/native-federation`, the native-federation orchestrator and
`@angular-architects/native-federation`). A skill bundles the instructions, references and small scripts an agent
needs for one kind of task, so it can help with a federated app without guessing.

## Available Skills

- **[`nf-debugging`](nf-debugging/)**: finds the cause of a Native Federation failure at runtime, in the browser or
  during SSR, for Native Federation v3 and v4. For example: `Failed to resolve module specifier`, a remote or
  `remoteEntry.json` that won't load, a framework running twice (NG0203, "Invalid hook call"), version or pooling
  warnings, or a deploy that doesn't show up. It walks the agent through a step-by-step investigation and ships
  console scripts and a headless capture script to collect the evidence.

## Using Agent Skills

Agent Skills work with agentic coding tools such as
[Claude Code](https://docs.claude.com/en/docs/claude-code/skills) and others that support the format. The agent
loads a skill on its own when your task matches its description.

Install them with the community [skills](https://github.com/vercel-labs/skills) CLI:

```bash
npx skills add https://github.com/native-federation/skills
```

Or copy a skill's folder (e.g. `nf-debugging/`) into your project's `.claude/skills/` folder, or into
`~/.claude/skills/` to use it in every project.

## Feedback & Issues

These skills are early versions, and real-world cases are how they get better. If a skill didn't trigger when it
should have, missed the cause, or said something incorrect for your version or setup, please
[open an issue](https://github.com/native-federation/skills/issues). Include your Native Federation and orchestrator
versions and, if you can share it, the agent's transcript. General feedback is also welcome in the
[announcement discussion](https://github.com/orgs/native-federation/discussions/222).

## Contributing

Pull requests are welcome. Skills in this repository follow a few rules:

- **Concise and timeless.** Explain Native Federation concepts and the failure modes that follow from them, not
  individual bugs, issue numbers or roadmap plans: installed skills aren't updated, so anything that can go stale
  will mislead agents later. Track open work as issues instead of TODO notes.
- **Version ranges only where behaviour differs by design** (for example orchestrator ≤ 4.7 vs ≥ 4.8).
- **Verify against the source.** Claims about behaviour, options, defaults and log text should match the released
  code of the package that owns them.
- **Keep `SKILL.md` lean.** It loads on every use; put details in `references/` and repeatable work in `scripts/`.

## License

MIT
