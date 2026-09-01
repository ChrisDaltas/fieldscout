import { defineConfig } from 'vitest/config'

import { resolveAlias, sharedExclude, stackInclude } from './vitest.shared'

/**
 * TWO PROJECTS, ONE DELIBERATE SHAPE — the F52 suite-isolation design
 * (L.B7.1; the durable fix the F52 row's batch-17/18 extensions demanded):
 *
 *   - `unit` runs everything that never touches the stack, fully parallel
 *     (unchanged behavior).
 *   - `stack` runs the stack-backed suites (every *-db.test.ts + the
 *     m1-gate journey) SEQUENTIALLY (fileParallelism: false). Under the
 *     old fully-parallel scheduling every stack suite contended with every
 *     other for one Kong/PostgREST/Realtime, and the F52 family was the
 *     result: upstream-5xx beforeAll failures, 500-on-repeat,
 *     realtime-delivery timeouts, and cross-suite ADP-walk captures (R286:
 *     winner-take-all source-4 over the SHARED players pool means NO
 *     fixture band is safe by construction while suites co-schedule).
 *     Serializing the stack lane removes the co-scheduling itself — each
 *     suite meets the stack alone, exactly the condition under which every
 *     F52 member was reproducibly green. The live 5s cron remains a legal
 *     concurrent actor WITHIN a suite (the 022/068 rule); suites' own
 *     defenses (direct ticks, `status='live'`-conditional rewinds) still
 *     carry that.
 *
 * The unit lane may run beside the stack lane (units never touch the
 * stack, so there is nothing to contend for). The gate configs
 * (vitest.gate-m1/m2.config.ts) are FLAT configs over vitest.shared.ts —
 * a root config with `projects` ignores root-level `include`, so they must
 * not merge this one.
 */
/**
 * SE.9: the automatic-JSX transform override lets test files IMPORT .tsx
 * components (for `renderToStaticMarkup` render pins — the three-mount
 * Customize pin in scoring-template-picker.render.test.ts was the first).
 * tsconfig keeps Next's required `jsx: "preserve"`, which the test
 * runner's transform otherwise honors and then fails to parse ("make sure
 * to not set jsx to preserve" — measured before this override). This
 * vitest install runs rolldown-vite (see the MIXED_EXPORTS note in
 * vitest.shared.ts), whose transform is OXC — so the knob is `oxc.jsx`,
 * not `esbuild.jsx` (the esbuild spelling was tried first and does not
 * reach the transform here; also measured). Test-runner transform only;
 * the Next build is untouched. Applied per-project because a projects
 * entry is its own environment.
 */
const transformJsx = { jsx: { runtime: 'automatic' } } as const

export default defineConfig({
  resolve: { alias: resolveAlias },
  oxc: transformJsx,
  test: {
    exclude: sharedExclude,
    projects: [
      {
        resolve: { alias: resolveAlias },
        oxc: transformJsx,
        test: {
          name: 'unit',
          exclude: [...sharedExclude, ...stackInclude],
        },
      },
      {
        resolve: { alias: resolveAlias },
        oxc: transformJsx,
        test: {
          name: 'stack',
          include: stackInclude,
          exclude: sharedExclude,
          // One stack suite at a time — the serialization above. (Vitest 4:
          // fileParallelism is the per-project knob; poolOptions is gone.)
          fileParallelism: false,
        },
      },
    ],
  },
})
