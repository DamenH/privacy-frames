import { build as bundle, type BuildOptions, type BuildResult } from 'esbuild';
import { trustedPolicyPlugin } from '../scripts/trusted-policy.ts';

const policy = trustedPolicyPlugin(process.cwd());

/** Browser fixtures use the same private-policy source loader as production. */
export async function build<T extends BuildOptions>(options: T): Promise<BuildResult<T>> {
  return bundle({ ...options, plugins: [await policy, ...(options.plugins || [])] });
}
